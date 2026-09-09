/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import type {
  ProviderOnboardingHubTask,
  ProviderOnboardingHubView,
  ProviderOnboardingIssue,
  ProviderOnboardingReview,
} from '@homeservicemarketplace/contracts';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-journey-a');

/** One entry of a review group, derived from the contract so it cannot drift. */
type ReviewItemLike = ProviderOnboardingReview['groups'][number]['items'][number];

// Sprint 09B.29 Phase 3, JOURNEY A — a pending specialty permits submission.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// HOW THIS DIFFERS FROM `pending-specialty-deadlock.integration.spec.ts`
//
// That suite seeds the PENDING `ProviderCategoryApplication` with a direct
// Prisma write, which is fine for pinning the resolvers but proves nothing
// about the operation that CREATES the state. This journey never writes the
// state under test: the provider profile is opened by the real
// `POST /v1/me/provider/upgrade`, every onboarding input is supplied through
// the real `PATCH /v1/me/provider/onboarding/steps/:step`, the specialty is
// chosen through the real SPECIALTIES step — which is what actually files the
// PENDING application — consent is accepted through the real CONSENT step
// against the live published version, and the application is handed in through
// the real `POST …/submit`.
//
// Direct database access appears only in ASSERTIONS, never as a substitute for
// an operation. Fixture preconditions (the User row and the service-category
// catalogue) are created directly because they are not what is under test.
//
// WHAT IS REAL HERE, AND WHAT IS NOT
//
// Real: the controllers, the wizard and onboarding services, the completeness
// policy, the hub and review resolvers, every repository, the transaction
// runner, the audit service, Postgres and Redis.
//
// NOT real: authentication. `JwtAuthGuard` is replaced by `StubJwtGuard`, and
// `CsrfGuard`, `RolesGuard` and `ProviderCapabilityGuard` by `PassGuard`, so
// this suite proves POLICY and SERVICE behaviour and says nothing about token
// validation, CSRF or capability enforcement. Those are covered where they can
// be exercised honestly: `provider-upgrade-session.integration.spec.ts` and
// `auth-cookies.spec.ts` drive the real guards, and the real-browser journeys
// drive real sessions and cookies. Journey B deliberately does NOT override
// `ProviderCapabilityGuard`, because the refusal it asserts is that guard's.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) return false;
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('Phase 3 Journey A — pending specialty permits submission (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3a');
  /** The V2 candidate. */
  const USER = `${P}user`;
  /** A separate deterministic candidate for the V1 half, so neither journey
   *  inherits the other's lifecycle. */
  const USER_V1 = `${P}v1user`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  let lifecycleLock: HeldLock;

  const asUser = (id: string) => {
    currentUser = { id };
  };

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getHub = () => request(http).get('/v1/me/provider/onboarding/hub');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const getV1Status = () => request(http).get('/v1/me/provider/onboarding');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);
  const postV1Submit = () => request(http).post('/v1/me/provider/submit-for-review');

  const task = (
    body: ProviderOnboardingHubView,
    id: string,
  ): ProviderOnboardingHubTask | undefined => body.tasks.find((t) => t.id === id);
  const groupItems = (body: ProviderOnboardingReview, kind: string): ReviewItemLike[] =>
    body.groups.find((g) => g.kind === kind)?.items ?? [];
  const codes = (issues: ProviderOnboardingIssue[]) => issues.map((i) => i.code);

  /** Profile id for a user, read back rather than assumed. */
  async function profileIdOf(userId: string): Promise<string> {
    const row = await prisma.providerProfile.findFirst({ where: { userId } });
    return row.id;
  }

  /**
   * Drive every provider-owned input through the real step endpoints.
   *
   * Returns the draft version after the last write, because the submit command
   * requires the caller to echo it.
   */
  async function completeProviderInputs(): Promise<number> {
    let v = (await getDraft().expect(200)).body.version as number;

    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };

    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName: 'Nour Haddad', phoneNumber: '+963900000123' });
    await step('LOCATION', {
      serviceAreaCity: 'JourneyACity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 20,
    });
    // THE OPERATION UNDER TEST: choosing a leaf the provider does not hold
    // files a PENDING application rather than granting it.
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 12, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: 'Certified electrician for homes and small businesses',
      bio: 'Twelve years of residential and light commercial electrical work, including rewiring and fault finding.',
    });

    return v;
  }

  async function cleanupFixtures(): Promise<void> {
    const ids = (await prisma.providerProfile.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const profileIds = ids.map((r) => r.id);

    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: profileIds } },
    });
    await prisma.providerProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [LEAF, ROOT] } } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const {
      ProviderOnboardingDraftRepository,
    } = require('../../src/infrastructure/persistence/provider/provider-onboarding-draft.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ProviderCategoryApplicationRepository,
    } = require('../../src/infrastructure/persistence/services/provider-category-application.repository');
    const { UserRepository } = require('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = require('../../src/infrastructure/persistence/iam/role.repository');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const {
      ProviderOnboardingWizardController,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.controller');
    const {
      ProviderOnboardingWizardService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.service');
    const {
      ProviderAvatarService,
    } = require('../../src/modules/provider/onboarding/avatar/provider-avatar.service');
    // Sprint 09B.29 Phase 4 — ProviderAvatarService claims and retires
    // reservations now, so its ledger has to exist here too. The REAL one:
    // this suite has a database, and a double would leave the claim's
    // ownership conditions untested in the one place they can be.
    const {
      PublicMediaLedgerService,
    } = require('../../src/modules/media/public-media-ledger.service');
    const {
      ProviderServiceAreaExpansionService,
    } = require('../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service');
    const { ProviderController } = require('../../src/modules/provider/provider.controller');
    const { ProviderService } = require('../../src/modules/provider/provider.service');
    const {
      ProviderOnboardingService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      ProviderCapabilityGuard,
    } = require('../../src/modules/provider/guards/provider-capability.guard');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { STORAGE_PORT } = require('../../src/infrastructure/storage/storage.port');

    // WORK_ACCESS_ENFORCED on: the journey asserts that submission opens while
    // work access stays shut, and with the flag off the gate falls back to the
    // legacy status and would prove nothing.
    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController, ProviderController],
      providers: [
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
        PublicMediaLedgerService,
        ProviderServiceAreaExpansionService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderProfileRepository,
        ProviderOnboardingDraftRepository,
        ServiceCategoryRepository,
        ProviderCategoryApplicationRepository,
        UserRepository,
        RoleRepository,
        PlatformSettingRepository,
        AuditService,
        AuditEventRepository,
        TransactionRunner,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: STORAGE_PORT, useValue: {} },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .overrideGuard(RolesGuard)
      .useClass(PassGuard)
      .overrideGuard(ProviderCapabilityGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();

    // Preconditions, not operations under test: the identities and the
    // catalogue the provider will choose from.
    for (const id of [USER, USER_V1]) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3a.test`,
          firstName: 'Nour',
          lastName: 'Haddad',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
    await prisma.serviceCategory.create({
      data: { id: ROOT, slug: ROOT, labelEn: 'Electrical', labelAr: 'كهرباء', icon: 'bolt' },
    });
    await prisma.serviceCategory.create({
      data: {
        id: LEAF,
        slug: LEAF,
        labelEn: 'Rewiring',
        labelAr: 'إعادة تمديد الأسلاك',
        icon: 'bolt',
        parentId: ROOT,
      },
    });
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the journey, in order, with the state proved at each step ────────────

  describe('the canonical journey', () => {
    let profileId: string;
    let version: number;

    it('1. opens a DRAFT provider profile through the real upgrade endpoint', async () => {
      asUser(USER);
      const res = await upgrade().expect(200);
      expect(res.body.profile).toBeDefined();

      profileId = await profileIdOf(USER);
      const row = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      // Upgrade opens a DRAFT. It is not an application and grants nothing.
      expect(row.status).toBe('DRAFT');
      expect(row.verified).toBe(false);
    });

    it('2. completes every provider-owned input through the real step endpoints', async () => {
      asUser(USER);
      version = await completeProviderInputs();
      expect(version).toBeGreaterThan(0);
    });

    it('3. filed a real PENDING moderation record — nothing was granted', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].serviceCategoryId).toBe(LEAF);
      expect(apps[0].status).toBe('PENDING');
      expect(apps[0].supersededAt).toBeNull();

      const granted = await prisma.providerProfileServiceCategory.count({
        where: { providerProfileId: profileId },
      });
      expect(granted).toBe(0);
    });

    it('4. has no work-access grant before submission', async () => {
      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: profileId, revokedAt: null },
      });
      expect(grants).toBe(0);
    });

    it('5. V2 draft separates the axes while a genuine provider item is outstanding', async () => {
      // Consent is deliberately NOT accepted yet — it is provider-owned work,
      // and leaving it outstanding here is the sharper proof: the two axes stay
      // separated even when the provider really does have something to do.
      //
      // So `complete` is false, and it is false for the RIGHT reason: `missing`
      // names consent and nothing else, while the queued approval sits on
      // `awaitingReview` where the provider is never asked to act on it.
      asUser(USER);
      const res = await getDraft().expect(200);
      expect(res.body.complete).toBe(false);
      expect(codes(res.body.missing)).not.toContain('AWAITING_REVIEW');
      expect(res.body.missing.map((m: ProviderOnboardingIssue) => m.field)).toEqual(['consent']);
      expect(codes(res.body.awaitingReview)).toContain('AWAITING_REVIEW');
    });

    it('5b. V2 draft keeps the SPECIALTIES step complete but still shows the moderation', async () => {
      asUser(USER);
      const res = await getDraft().expect(200);
      const step = res.body.steps.find((s: { step: string }) => s.step === 'SPECIALTIES') as {
        complete: boolean;
        issues: ProviderOnboardingIssue[];
      };
      expect(step.complete).toBe(true);
      expect(codes(step.issues)).toContain('AWAITING_REVIEW');
    });

    it('6. V1 status separates the axes identically', async () => {
      // V1 reports `complete: true` here where V2 reports false, and that is
      // correct rather than a disagreement: the legacy candidate does not carry
      // `acceptedConsentVersion`, so the policy treats consent as "not asked"
      // and does not judge it — the documented backward-compatibility rule for
      // every field the legacy surface never collected. What both surfaces
      // agree on is the thing under test: the moderation item is on
      // `awaitingReview` and never in `missing`.
      asUser(USER);
      const res = await getV1Status().expect(200);
      expect(codes(res.body.missing)).not.toContain('AWAITING_REVIEW');
      expect(codes(res.body.awaitingReview)).toContain('AWAITING_REVIEW');
      expect(res.body.complete).toBe(true);
      expect(res.body.missing).toEqual([]);
    });

    it('7. the hub marks services WAITING, counts it, and skips it in nextAction', async () => {
      asUser(USER);
      const res = await getHub().expect(200);
      expect(task(res.body, 'SERVICES_EXPERIENCE')?.status).toBe('WAITING');
      expect(task(res.body, 'REVIEW_SUBMISSION')?.status).toBe('AVAILABLE');
      expect(res.body.progress).toEqual({ complete: 5, total: 6 });
      expect(res.body.nextAction).not.toEqual({
        kind: 'COMPLETE_TASK',
        taskId: 'SERVICES_EXPERIENCE',
      });
    });

    it('8. review is reachable, with moderation on WAITING and never on BLOCKING', async () => {
      asUser(USER);
      const res = await getReview().expect(200);
      expect(groupItems(res.body, 'WAITING').map((i) => i.code)).toContain('SPECIALTY_REVIEW');
      expect(groupItems(res.body, 'BLOCKING').map((i) => i.code)).not.toContain('AWAITING_REVIEW');
    });

    it('9. canSubmit is false until consent, then true — terms are their own condition', async () => {
      asUser(USER);
      const before = await getReview().expect(200);
      expect(before.body.canSubmit).toBe(false);
      expect(before.body.blockedReason?.field).toBe('consent');

      // Accept the LIVE published version through the real CONSENT step.
      const live = before.body.terms.version as string;
      const res = await patchStep('CONSENT', {
        acceptedConsentVersion: live,
        version: before.body.draftVersion,
      }).expect(200);
      version = res.body.version as number;

      const after = await getReview().expect(200);
      expect(after.body.canSubmit).toBe(true);
      expect(after.body.blockedReason).toBeNull();
    });

    it('9b. with consent accepted, provider input is complete on BOTH surfaces', async () => {
      // The other half of test 5: once the genuine provider item is done, the
      // queued approval is the only thing outstanding — and it does not hold
      // completion back on either surface.
      asUser(USER);
      const v2 = await getDraft().expect(200);
      expect(v2.body.complete).toBe(true);
      expect(v2.body.missing).toEqual([]);
      expect(codes(v2.body.awaitingReview)).toContain('AWAITING_REVIEW');

      const v1 = await getV1Status().expect(200);
      expect(v1.body.complete).toBe(true);
      expect(v1.body.missing).toEqual([]);
      expect(codes(v1.body.awaitingReview)).toContain('AWAITING_REVIEW');
    });

    it('10. the real submit endpoint succeeds and the lifecycle leaves DRAFT', async () => {
      asUser(USER);
      const review = await getReview().expect(200);
      // The API's reported lifecycle, not the raw column: `upgrade` opens a
      // profile with `status: DRAFT` and leaves the Sprint 7 `onboardingState`
      // NULL, which the resolver reports as DRAFT and which `submit`'s claim
      // clause deliberately accepts. Asserting the column here would pin an
      // implementation detail and fail for the wrong reason.
      expect(review.body.lifecycleState).toBe('DRAFT');
      const before = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(before.submittedForReviewAt).toBeNull();

      await postSubmit({ version: review.body.draftVersion }).expect(200);

      // EXACT, not a permitted set. The canonical submit transaction writes
      // these two values unconditionally — there is no branch that could pick
      // 'SUBMITTED' instead — so accepting either would let a real change to
      // the transition pass unnoticed.
      const after = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(after.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(after.status).toBe('PENDING_REVIEW');
      expect(after.submittedForReviewAt).not.toBeNull();
    });

    it('10b. the submission audit records that it granted nothing', async () => {
      // The transaction writes this metadata itself. Asserting it here means a
      // future change that started granting work access on submission would
      // fail on its own recorded claim, not only on the row counts below.
      const event = await prisma.auditEvent.findFirst({
        where: { userId: USER, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(event).not.toBeNull();
      expect(event.metadata).toMatchObject({
        newState: 'DOCUMENTS_REQUIRED',
        grantsWorkAccess: false,
        grantsVerifiedBadge: false,
      });
    });

    it('10c. submission emits NO outbox event — that is the current contract', async () => {
      // Documented rather than invented: `provider-onboarding-wizard.service.ts`
      // contains no reference to the outbox at all, so onboarding submission
      // publishes nothing. The verification CASE workflow is what emits events
      // (see `verification-case-events.handler.ts`), and that is Journey C's
      // subject. This assertion pins the absence so a future addition is a
      // deliberate contract change rather than a silent one.
      //
      // Scoped to THIS provider's aggregates rather than counting the whole
      // table. A whole-table count says "nobody anywhere emitted anything",
      // which is a claim about the database rather than about submission, and
      // it breaks the moment a neighbouring suite legitimately emits an event
      // — which is exactly what Journey C's verification workflow does.
      const aggregates = [
        await profileIdOf(USER),
        ...(
          (await prisma.providerOnboardingSubmission.findMany({
            where: { providerProfile: { userId: USER } },
            select: { id: true },
          })) as Array<{ id: string }>
        ).map((s) => s.id),
      ];
      const outbox = await prisma.outboxEvent.count({
        where: { aggregateId: { in: aggregates } },
      });
      expect(outbox).toBe(0);
    });

    it('11. exactly one submission row and one submission audit event exist', async () => {
      const submissions = await prisma.providerOnboardingSubmission.count({
        where: { providerProfileId: profileId },
      });
      expect(submissions).toBe(1);

      // Exact enum value, not a `contains` filter: `type` is a Prisma enum and
      // string operators are not valid on it.
      const submitted = await prisma.auditEvent.count({
        where: { userId: USER, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(submitted).toBe(1);

      // The specialty choice earlier in the journey is audited too, and on its
      // own event type — the two are separate facts and must not be conflated.
      const applied = await prisma.auditEvent.count({
        where: { userId: USER, type: 'PROVIDER_CATEGORY_APPLIED' },
      });
      expect(applied).toBeGreaterThanOrEqual(1);
    });

    it('12. moderation is STILL pending — submission approved nothing', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');

      const granted = await prisma.providerProfileServiceCategory.count({
        where: { providerProfileId: profileId },
      });
      expect(granted).toBe(0);
    });

    it('13. submission created NO work-access grant', async () => {
      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: profileId, revokedAt: null },
      });
      expect(grants).toBe(0);

      const row = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(row.verified).toBe(false);
      // `verificationState` is NULL on a profile the canonical upgrade opened —
      // the column is set when a verification case exists. Asserting the
      // literal 'UNVERIFIED' would pin a value this path never writes; what
      // matters is that submission did not move it to a verified state.
      expect(row.verificationState).not.toBe('VERIFIED');
      expect(row.status).not.toBe('ACTIVE');
    });

    it('14. the hub reports the application as handed in after reload', async () => {
      asUser(USER);
      const res = await getHub().expect(200);
      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.nextAction).toEqual({ kind: 'AWAIT_REVIEW' });
    });

    it('15. repeated reads return the same separated contract and mutate nothing', async () => {
      asUser(USER);
      const before = await prisma.providerProfile.findUnique({ where: { id: profileId } });

      const a = await getDraft().expect(200);
      const b = await getDraft().expect(200);
      const v1a = await getV1Status().expect(200);
      const v1b = await getV1Status().expect(200);

      expect(a.body.missing).toEqual(b.body.missing);
      expect(a.body.awaitingReview).toEqual(b.body.awaitingReview);
      expect(v1a.body.missing).toEqual(v1b.body.missing);
      expect(v1a.body.awaitingReview).toEqual(v1b.body.awaitingReview);
      expect(codes(a.body.missing)).not.toContain('AWAITING_REVIEW');

      const after = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });
  });

  // ── the same proof through the V1 compatibility endpoint ─────────────────
  //
  // A SEPARATE candidate, so neither half inherits the other's lifecycle.

  describe('the V1 compatibility half, on its own candidate', () => {
    let v1ProfileId: string;

    it('completes the same canonical inputs and files a real PENDING application', async () => {
      asUser(USER_V1);
      await upgrade().expect(200);
      v1ProfileId = await profileIdOf(USER_V1);
      await completeProviderInputs();

      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: v1ProfileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');
    });

    it('reports provider input complete with the moderation on its own axis', async () => {
      asUser(USER_V1);
      const res = await getV1Status().expect(200);
      expect(res.body.complete).toBe(true);
      expect(res.body.missing).toEqual([]);
      expect(codes(res.body.awaitingReview)).toContain('AWAITING_REVIEW');
    });

    it('accepts the real V1 submit-for-review and grants nothing', async () => {
      asUser(USER_V1);
      await postV1Submit().expect(200);

      const row = await prisma.providerProfile.findUnique({ where: { id: v1ProfileId } });
      expect(row.status).toBe('PENDING_REVIEW');
      expect(row.submittedForReviewAt).not.toBeNull();

      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: v1ProfileId },
      });
      expect(apps[0].status).toBe('PENDING');

      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: v1ProfileId, revokedAt: null },
      });
      expect(grants).toBe(0);
    });
  });
});
