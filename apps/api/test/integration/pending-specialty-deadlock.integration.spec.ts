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
const SECRET = makeTestSecret('pending-specialty');

/** One entry of a review group. Derived from the contract rather than
 *  redeclared, so it cannot drift from it. */
type ReviewItemLike = ProviderOnboardingReview['groups'][number]['items'][number];

// Sprint 09B.29, Phase 3 — the pending-specialty moderation deadlock, against
// real Postgres.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// THE DEADLOCK
//
// A provider selects a service. The platform does not grant it immediately: it
// records a PENDING `ProviderCategoryApplication` for an administrator to
// decide. `evaluateOnboarding` then reports `specialties: AWAITING_REVIEW` —
// correct, and deliberately distinct from REQUIRED so the copy stops telling
// someone who HAS chosen a specialty that they have not.
//
// Up to 9B.18 that issue still counted against completeness at five separate
// decision sites, so the provider could not reach final review and could not
// submit. The application therefore never arrived in the queue — and the
// approval that would have cleared the issue is prompted by exactly that
// arrival. Neither side can move: the provider cannot approve their own
// specialty, and the administrator has nothing to look at.
//
// WHAT THIS SUITE PINS
//
// The whole scenario end to end, on real rows, through the real controller:
// provider input is complete, moderation stays visibly pending on its own axis,
// the next action skips work that is already done, review is reachable,
// submission succeeds — and activation and work access remain shut until an
// administrator actually approves. It also pins the control case, so the repair
// cannot be mistaken for "pending applications are ignored".
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(180_000);

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

d('Pending specialty moderation does not deadlock onboarding (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('pendingspec');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  /** The leaf the provider applies for and nobody has approved. */
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  const getHub = () => request(http).get('/v1/me/provider/onboarding/hub');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);

  // Typed against the shared contracts rather than `any`: supertest hands back
  // an untyped body, and letting that spread through the assertions is how a
  // renamed field goes unnoticed in a suite that still passes.
  /** The named hub task, or a failure that says which one went missing.
   *
   *  Deliberately throws rather than returning `| undefined`: a hub that
   *  stopped emitting SERVICES_EXPERIENCE altogether would otherwise surface
   *  as `Cannot read properties of undefined`, or — worse, if the call sites
   *  used `?.` — as a silently passing assertion against `undefined`. */
  const task = (body: ProviderOnboardingHubView, id: string): ProviderOnboardingHubTask => {
    const found = body.tasks.find((t) => t.id === id);
    if (!found) {
      throw new Error(
        `Hub task ${id} is absent. Present: ${body.tasks.map((t) => t.id).join(', ')}`,
      );
    }
    return found;
  };
  const groupItems = (body: ProviderOnboardingReview, kind: string): ReviewItemLike[] =>
    body.groups.find((g) => g.kind === kind)?.items ?? [];

  /**
   * Everything the completeness policy asks of the PROVIDER, and nothing more.
   *
   * Note what is deliberately absent: no `providerProfileServiceCategory` row.
   * The provider holds no granted category — only the pending application
   * created in `beforeEach` — which is precisely the state under test.
   */
  async function makeProviderInputComplete(over: Record<string, unknown> = {}): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        displayName: 'Nadia Haddad',
        headline: 'Certified electrician for homes and small businesses',
        bio: 'Twelve years of residential and light commercial electrical work, including rewiring, fault finding and emergency callouts.',
        phoneNumber: '+963900000777',
        serviceAreaCity: 'DeadlockTestCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 20,
        providerType: 'INDIVIDUAL',
        yearsOfExperience: 12,
        acceptedConsentVersion: 'v1',
        consentAcceptedAt: new Date(),
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        submittedForReviewAt: null,
        verified: false,
        verificationState: 'UNVERIFIED',
        standingState: 'GOOD',
        ...over,
      },
    });
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
  }

  beforeAll(async () => {
    // SHARED, matching every other suite that writes ProviderProfile: this must
    // not overlap the lifecycle backfill, which rewrites that table wholesale
    // and asserts on whole-table totals.
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

    // WORK_ACCESS_ENFORCED on, deliberately: the point of this suite is that
    // submission opens while WORK ACCESS stays shut, and with the flag off the
    // gate falls back to the legacy status and would prove nothing.
    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        ProviderOnboardingWizardService,
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
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    await prisma.user.create({
      data: {
        id: USER,
        email: `${USER}@ps.test`,
        firstName: 'Nadia',
        lastName: 'Haddad',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    await prisma.serviceCategory.create({
      data: {
        id: CATEGORY,
        slug: CATEGORY,
        labelEn: 'Electrical',
        labelAr: 'كهرباء',
        icon: 'bolt',
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: USER,
        displayName: 'Nadia Haddad',
        initials: 'NH',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
    await prisma.providerAvailabilityInterval.create({
      data: {
        providerProfileId: PP,
        dayOfWeek: 0,
        startMinute: 540,
        endMinute: 1020,
        timezone: 'Asia/Damascus',
      },
    });
  });

  beforeEach(async () => {
    currentUser = { id: USER };
    await prisma.providerOnboardingSubmission.deleteMany({ where: { providerProfileId: PP } });
    await prisma.auditEvent.deleteMany({ where: { userId: USER } });
    await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId: PP } });
    await prisma.providerProfileServiceCategory.deleteMany({ where: { providerProfileId: PP } });
    await makeProviderInputComplete();

    // THE SCENARIO: a service was selected and nobody has decided on it.
    await prisma.providerCategoryApplication.create({
      data: { providerProfileId: PP, serviceCategoryId: CATEGORY, status: 'PENDING' },
    });

    const intervals = await prisma.providerAvailabilityInterval.count({
      where: { providerProfileId: PP },
    });
    if (intervals === 0) {
      await prisma.providerAvailabilityInterval.create({
        data: {
          providerProfileId: PP,
          dayOfWeek: 0,
          startMinute: 540,
          endMinute: 1020,
          timezone: 'Asia/Damascus',
        },
      });
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the hub, reloaded, tells the truth about both axes ───────────────────

  describe('the hub separates provider input from moderation', () => {
    it('reports the services task as WAITING — with us, not with them', async () => {
      const res = await getHub().expect(200);
      expect(task(res.body, 'SERVICES_EXPERIENCE').status).toBe('WAITING');
    });

    it('counts the provider input as done', async () => {
      // The number answers "how much of YOUR part is finished". Before the
      // repair this read 4 and told a provider who had finished that they had
      // not.
      const res = await getHub().expect(200);
      expect(res.body.progress).toEqual({ complete: 5, total: 6 });
    });

    it('opens REVIEW_SUBMISSION instead of barring it', async () => {
      const res = await getHub().expect(200);
      expect(task(res.body, 'REVIEW_SUBMISSION').status).toBe('AVAILABLE');
    });

    it('points the next action at SUBMIT, not back at the waiting task', async () => {
      // Sending them into SERVICES_EXPERIENCE would open a screen on which
      // every editable field is already filled in.
      const res = await getHub().expect(200);
      expect(res.body.nextAction).toEqual({ kind: 'SUBMIT' });
    });

    it('survives a reload — the state is read from the database, not a cache', async () => {
      await getHub().expect(200);
      const again = await getHub().expect(200);
      expect(task(again.body, 'SERVICES_EXPERIENCE').status).toBe('WAITING');
      expect(again.body.nextAction).toEqual({ kind: 'SUBMIT' });
    });

    it('still reports the moderation issue on the draft, on its own axis', async () => {
      // The policy is not weakened: the issue is still raised. What changed is
      // where it is reported. `missing` is what the PROVIDER must do, and the
      // wizard renders it as a list of amber "still to do" entries — putting a
      // specialty approval there told them to fix something they cannot touch.
      // It moved to `awaitingReview`, which is status rather than a task.
      const res = await getDraft().expect(200);
      expect(res.body.awaitingReview).toEqual(
        expect.arrayContaining([{ field: 'specialties', code: 'AWAITING_REVIEW' }]),
      );
      expect(res.body.missing.map((m: ProviderOnboardingIssue) => m.code)).not.toContain(
        'AWAITING_REVIEW',
      );
      // ...and the two halves agree: nothing for them to do, so complete.
      expect(res.body.complete).toBe(true);
    });
  });

  // ── review agrees with the hub ───────────────────────────────────────────

  describe('final review is reachable and submittable', () => {
    it('allows submission with no blocking reason', async () => {
      const res = await getReview().expect(200);
      expect(res.body.canSubmit).toBe(true);
      expect(res.body.blockedReason).toBeNull();
    });

    it('shows the pending specialty on the WAITING axis', async () => {
      const res = await getReview().expect(200);
      expect(groupItems(res.body, 'WAITING').map((i: ReviewItemLike) => i.code)).toContain(
        'SPECIALTY_REVIEW',
      );
    });

    it('lists no blocker the provider cannot act on', async () => {
      const res = await getReview().expect(200);
      expect(groupItems(res.body, 'BLOCKING').map((i: ReviewItemLike) => i.code)).not.toContain(
        'AWAITING_REVIEW',
      );
    });
  });

  // ── the submission actually happens ──────────────────────────────────────

  describe('submission succeeds and is recorded', () => {
    it('accepts the submit and moves the application out of DRAFT', async () => {
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      // Either handed-in state is a pass. This provider lands in
      // DOCUMENTS_REQUIRED because the verification flow wants evidence, which
      // is a downstream requirement and not this suite's subject; the two
      // states mean the same thing to a provider looking at a task list, and
      // `hubStatusOf` maps both to the hub's SUBMITTED. Asserting the exact
      // value would pin an unrelated policy and fail for the wrong reason.
      //
      // What matters here, and is asserted: it is no longer DRAFT. The
      // deadlock's signature was an application that could never leave it.
      expect(['SUBMITTED', 'DOCUMENTS_REQUIRED']).toContain(profile.onboardingState);
      expect(profile.onboardingState).not.toBe('DRAFT');
      expect(profile.submittedForReviewAt).not.toBeNull();
    });

    it('reports the hub as handed in afterwards', async () => {
      // The provider-facing half of the assertion above: whichever lifecycle
      // value the server chose, the hub must stop offering work to do.
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);

      const hub = await getHub().expect(200);
      expect(hub.body.status).toBe('SUBMITTED');
      expect(hub.body.nextAction).toEqual({ kind: 'AWAIT_REVIEW' });
    });

    it('writes exactly one submission row', async () => {
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);
      const rows = await prisma.providerOnboardingSubmission.count({
        where: { providerProfileId: PP },
      });
      expect(rows).toBe(1);
    });

    it('leaves the pending application PENDING — submitting approves nothing', async () => {
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: PP },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');
    });
  });

  // ── and the axes that must STAY shut, stay shut ──────────────────────────

  describe('activation and work access remain restricted', () => {
    it('grants no category, no verification and no activation on submit', async () => {
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);

      const profile = await prisma.providerProfile.findUnique({
        where: { id: PP },
        include: { serviceCategories: true },
      });
      // The whole point: the provider is in the queue, not in the marketplace.
      expect(profile.serviceCategories).toHaveLength(0);
      expect(profile.verified).toBe(false);
      expect(profile.verificationState).toBe('UNVERIFIED');
      expect(profile.status).not.toBe('ACTIVE');
    });

    it('holds no work-access grant', async () => {
      const review = await getReview().expect(200);
      await postSubmit({ version: review.body.draftVersion }).expect(200);
      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: PP, revokedAt: null },
      });
      expect(grants).toBe(0);
    });
  });

  // ── the control: the repair is not "ignore pending applications" ─────────

  describe('a provider who has chosen nothing is still blocked', () => {
    beforeEach(async () => {
      // Same profile, no pending application: the provider genuinely has not
      // picked a service. Without this case the repair could be mistaken for
      // dropping the requirement altogether.
      await prisma.providerCategoryApplication.deleteMany({ where: { providerProfileId: PP } });
    });

    it('reports the services task as the provider’s own outstanding work', async () => {
      const res = await getHub().expect(200);
      expect(task(res.body, 'SERVICES_EXPERIENCE').status).toBe('AVAILABLE');
      expect(task(res.body, 'REVIEW_SUBMISSION').status).toBe('BLOCKED');
    });

    it('refuses the submission, naming a field they can act on', async () => {
      const review = await getReview().expect(200);
      expect(review.body.canSubmit).toBe(false);
      const res = await postSubmit({ version: review.body.draftVersion }).expect(422);
      const codes = (res.body?.error?.details?.missing ?? res.body?.details?.missing ?? []).map(
        (m: ProviderOnboardingIssue) => m.code,
      );
      expect(codes).toContain('REQUIRED');
      expect(codes).not.toContain('AWAITING_REVIEW');
    });
  });

  // ── a real gap still blocks, pending application or not ──────────────────

  describe('a provider-actionable gap still blocks while moderation is pending', () => {
    beforeEach(async () => {
      await makeProviderInputComplete({ bio: null });
    });

    it('blocks the review and names the field, never the queue', async () => {
      const review = await getReview().expect(200);
      expect(review.body.canSubmit).toBe(false);
      expect(review.body.blockedReason.field).toBe('bio');
      expect(groupItems(review.body, 'BLOCKING').map((i: ReviewItemLike) => i.code)).not.toContain(
        'AWAITING_REVIEW',
      );
    });

    it('refuses the submit for the field the provider can fix', async () => {
      const review = await getReview().expect(200);
      const res = await postSubmit({ version: review.body.draftVersion }).expect(422);
      const missing = res.body?.error?.details?.missing ?? res.body?.details?.missing ?? [];
      expect(missing.map((m: ProviderOnboardingIssue) => m.field)).toContain('bio');
      expect(missing.map((m: ProviderOnboardingIssue) => m.code)).not.toContain('AWAITING_REVIEW');
    });
  });
});
