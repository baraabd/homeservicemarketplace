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

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.23 — V2 Task 6, against real Postgres.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// Every acceptance criterion of this sprint is a statement about what the
// SERVER does under adversarial timing, so they are asserted here rather than
// in a unit test:
//
//   a blocked submission always names the exact next action;
//   consent is versioned, and a change between view and submit is caught;
//   submitting grants no marketplace capability;
//   duplicate requests cannot create duplicate cases or audit rows.
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

d('Onboarding review and submission (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('reviewsubmit');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  const CONSENT_KEY = 'provider_consent_policy_version';

  const getReview = (q = '') => request(http).get(`/v1/me/provider/onboarding/review${q}`);
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);
  const postWithdraw = () => request(http).post('/v1/me/provider/onboarding/withdraw');
  const getHub = () => request(http).get('/v1/me/provider/onboarding/hub');
  const patchProfile = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/PROFILE').send(body);

  /** Everything the completeness policy asks for, so the only remaining
   *  variable in a test is the one that test is about. */
  async function makeComplete(over: Record<string, unknown> = {}): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        displayName: 'Layla Mansour',
        headline: 'Certified electrician',
        bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete and useful.',
        phoneNumber: '+963900000444',
        serviceAreaCity: 'ReviewTestCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 20,
        // The policy asks for these too; a fixture that satisfies most of it
        // makes every 'complete' assertion below pass for the wrong reason.
        providerType: 'INDIVIDUAL',
        yearsOfExperience: 5,
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

  async function acceptCurrentTerms(): Promise<void> {
    const row = await prisma.platformSetting.findUnique({ where: { key: CONSENT_KEY } });
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        acceptedConsentVersion: (row?.value as string) ?? 'v1',
        consentAcceptedAt: new Date(),
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
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
    await prisma.platformSetting.deleteMany({ where: { key: CONSENT_KEY } });
  }

  beforeAll(async () => {
    // SHARED, matching every other suite that writes ProviderProfile: this one
    // must not overlap the lifecycle backfill, which rewrites that table
    // wholesale and asserts on whole-table totals. It creates no ServiceRequest,
    // so it does not take the serviceRequests lock.
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

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: 'review-submit-test-secret',
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        ProviderOnboardingWizardService,
        ProviderAvatarService,
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
    // The same pipe main.ts installs. Without it the harness would accept
    // payloads the real application rejects, and every DTO rule below would be
    // asserting against an app that does not exist.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    await prisma.user.create({
      data: {
        id: USER,
        email: `${USER}@rs.test`,
        firstName: 'Layla',
        lastName: 'Mansour',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    await prisma.serviceCategory.create({
      data: { id: CATEGORY, slug: CATEGORY, labelEn: 'Plumbing', labelAr: 'سباكة', icon: 'bolt' },
    });
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: USER,
        displayName: 'Layla Mansour',
        initials: 'LM',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
    await prisma.providerProfileServiceCategory.create({
      data: { providerProfileId: PP, serviceCategoryId: CATEGORY },
    });
    // AVAILABILITY is satisfied by a row, not a column: the policy counts
    // intervals. One Sunday 09:00-17:00 window is enough to make the step
    // complete without making this suite a test of the schedule editor.
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
    // DELIBERATELY NOT creating `provider_consent_policy_version`.
    //
    // It is a GLOBAL settings row, and `requiredConsentVersion()` treats an
    // absent row as "no terms requirement at all". Creating it here imposed a
    // requirement on every OTHER suite's providers — none of whom accept
    // terms — so their verification submits started failing
    // TERMS_NOT_ACCEPTED. Sprint 9B.26 caught it: three deterministic failures
    // in verification-case-workflow that appeared only when this suite ran
    // beside it, and vanished when it did not.
    //
    // The wizard defaults the version to 'v1' when the row is missing, so
    // every assertion here still has a version to read. Nothing needs the row
    // to exist; something else needs it NOT to.
    await prisma.providerOnboardingSubmission.deleteMany({ where: { providerProfileId: PP } });
    await prisma.auditEvent.deleteMany({ where: { userId: USER } });
    await prisma.providerProfile.update({
      where: { id: PP },
      data: { acceptedConsentVersion: null, consentAcceptedAt: null },
    });
    await makeComplete();
    // Re-seeded per test, not once in beforeAll: the legacy-draft cases delete
    // it on purpose, and without this every later test inherits a draft that is
    // missing its weekly schedule — which looks like a hub defect and is not.
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

  // ── a blocked submission always explains the next action ─────────────────

  describe('a blocked application names the exact next action', () => {
    it('refuses to submit and points at the task that fixes it', async () => {
      await makeComplete({ bio: null });
      const res = await getReview();

      expect(res.status).toBe(200);
      expect(res.body.canSubmit).toBe(false);
      expect(res.body.blockedReason).not.toBeNull();
      expect(res.body.blockedReason.taskId).toBeTruthy();
    });

    it('never leaves the provider with a refusal and nowhere to go', async () => {
      await makeComplete({ bio: null, serviceAreaCity: null });
      const res = await getReview();
      const blocking = res.body.groups.find((g: { kind: string }) => g.kind === 'BLOCKING');
      expect(blocking.items.length).toBeGreaterThan(0);
      for (const item of blocking.items) expect(item.taskId).toBeTruthy();
    });

    it('the server refuses the submit too, not merely the button', async () => {
      // A disabled button is a courtesy. The refusal has to be real.
      await makeComplete({ bio: null });
      await acceptCurrentTerms();
      const review = await getReview();
      const res = await postSubmit({ version: review.body.draftVersion });
      expect(res.status).toBe(422);
    });
  });

  // ── versioned, auditable consent ─────────────────────────────────────────

  describe('terms consent is versioned', () => {
    it('serves the ACTIVE version and reports it unaccepted', async () => {
      const res = await getReview();
      expect(res.body.terms.version).toBe('v1');
      expect(res.body.terms.accepted).toBe(false);
      expect(res.body.canSubmit).toBe(false);
    });

    it('accepting the current version unblocks the submission', async () => {
      await acceptCurrentTerms();
      const res = await getReview();
      expect(res.body.terms.accepted).toBe(true);
      expect(res.body.canSubmit).toBe(true);
    });

    it('an OLD acceptance does not count once the document moves', async () => {
      // The version change between viewing and submitting: the provider agreed
      // to one document, a newer one is live, and the tick must not survive it.
      //
      // STALENESS IS SIMULATED ON THE PROFILE, NOT BY MOVING THE PLATFORM
      // SETTING.
      //
      // `provider_consent_policy_version` is a GLOBAL row. Publishing "v2" from
      // here made every other suite's provider — who had accepted v1 — fail
      // `assessSubmissionReadiness` with TERMS_NOT_ACCEPTED, and their
      // verification submits were refused mid-run. Sprint 9B.26 caught it:
      // three failures in verification-case-workflow that reproduced only when
      // this suite ran beside it.
      //
      // The rule under test is `accepted === (acceptedVersion === current)`,
      // and rewinding the PROFILE exercises exactly that comparison while
      // touching nothing another suite can see.
      await acceptCurrentTerms();
      expect((await getReview()).body.terms.accepted).toBe(true);

      await prisma.providerProfile.update({
        where: { id: PP },
        data: { acceptedConsentVersion: 'v0-superseded' },
      });

      const after = await getReview();
      expect(after.body.terms.version).toBe('v1');
      expect(after.body.terms.acceptedVersion).toBe('v0-superseded');
      expect(after.body.terms.accepted).toBe(false);
      expect(after.body.canSubmit).toBe(false);
      expect(after.body.blockedReason.code).toBe('STALE_VERSION');
    });

    it('records what was accepted, so the trail can be read back', async () => {
      await acceptCurrentTerms();
      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.acceptedConsentVersion).toBe('v1');
      expect(profile.consentAcceptedAt).toBeInstanceOf(Date);
    });

    it('serves Arabic wording when asked, without changing the version', async () => {
      const res = await getReview('?locale=ar');
      expect(res.body.terms.locale).toBe('ar');
      expect(res.body.terms.version).toBe('v1');
    });

    it('refuses a locale it does not publish', async () => {
      expect((await getReview('?locale=fr')).status).toBe(400);
    });
  });

  // ── submission grants nothing ────────────────────────────────────────────

  describe('submitting grants no marketplace capability', () => {
    it('leaves the badge, the verification axis and work access untouched', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      expect((await postSubmit({ version: review.body.draftVersion })).status).toBe(200);

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.verified).toBe(false);
      expect(profile.verificationState).toBe('UNVERIFIED');
      // NOT ACTIVE. A submitted application is queued, not approved.
      expect(profile.status).toBe('PENDING_REVIEW');
      expect(profile.onboardingState).toBe('DOCUMENTS_REQUIRED');

      const grants = await prisma.providerWorkAccessGrant.count({
        where: { providerProfileId: PP },
      });
      expect(grants).toBe(0);
    });

    it('says so in the audit trail rather than leaving it to be inferred', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      await postSubmit({ version: review.body.draftVersion });

      const events = await prisma.auditEvent.findMany({ where: { userId: USER } });
      const submitted = events.find(
        (e: { type: string }) => e.type === 'PROVIDER_ONBOARDING_SUBMITTED',
      );
      expect(submitted).toBeDefined();
      expect(submitted.metadata.grantsWorkAccess).toBe(false);
      expect(submitted.metadata.grantsVerifiedBadge).toBe(false);
    });
  });

  // ── duplicate submission ─────────────────────────────────────────────────

  describe('duplicate requests cannot create duplicate cases or audits', () => {
    it('two SIMULTANEOUS submits leave exactly one submission row', async () => {
      // The real race: a double tap, or a retry after a dropped response. Both
      // requests read DRAFT before either writes.
      await acceptCurrentTerms();
      const review = await getReview();
      const v = review.body.draftVersion;

      const results = await Promise.allSettled([
        postSubmit({ version: v }),
        postSubmit({ version: v }),
      ]);
      const ok = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 200,
      );
      expect(ok.length).toBeGreaterThanOrEqual(1);

      const rows = await prisma.providerOnboardingSubmission.count({
        where: { providerProfileId: PP },
      });
      expect(rows).toBe(1);
    });

    it('two SIMULTANEOUS submits leave exactly one audit event', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      const v = review.body.draftVersion;

      await Promise.allSettled([postSubmit({ version: v }), postSubmit({ version: v })]);

      const submitted = await prisma.auditEvent.count({
        where: { userId: USER, type: 'PROVIDER_ONBOARDING_SUBMITTED' },
      });
      expect(submitted).toBe(1);
    });

    it('a SEQUENTIAL retry is idempotent rather than a second application', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      const v = review.body.draftVersion;

      expect((await postSubmit({ version: v })).status).toBe(200);
      // The retry a client makes after a timeout it never saw the answer to.
      expect((await postSubmit({ version: v })).status).toBe(200);

      expect(
        await prisma.providerOnboardingSubmission.count({ where: { providerProfileId: PP } }),
      ).toBe(1);
    });

    it('keeps the policy snapshot of the ONE submission that happened', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      await postSubmit({ version: review.body.draftVersion });

      const rows = await prisma.providerOnboardingSubmission.findMany({
        where: { providerProfileId: PP },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].policyVersion).toBeTruthy();
      expect(rows[0].snapshot).toBeTruthy();
      expect(rows[0].submittedByUserId).toBe(USER);
    });
  });

  // ── stale draft recovery ─────────────────────────────────────────────────

  describe('stale draft recovery', () => {
    it('reports the version the client must echo', async () => {
      const res = await getReview();
      expect(typeof res.body.draftVersion).toBe('number');
    });

    it('reports the lifecycle state, so a submitted application stops offering a button', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      await postSubmit({ version: review.body.draftVersion });

      const after = await getReview();
      expect(after.body.lifecycleState).toBe('DOCUMENTS_REQUIRED');
    });
  });

  // ── Sprint 9B.24 — withdrawal, and the axes that must not collapse ───────

  describe('withdraw for editing', () => {
    async function submitIt(): Promise<void> {
      await acceptCurrentTerms();
      const review = await getReview();
      expect((await postSubmit({ version: review.body.draftVersion })).status).toBe(200);
    }

    it('is offered only from the states the command actually accepts', async () => {
      // The offer and the command read the same list, so a button can never
      // appear for a state the server would answer with a 409.
      expect((await getReview()).body.canWithdraw).toBe(false); // DRAFT
      await submitIt();
      expect((await getReview()).body.canWithdraw).toBe(true); // DOCUMENTS_REQUIRED
    });

    it('returns the application to an editable state', async () => {
      await submitIt();
      expect((await postWithdraw()).status).toBe(200);

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.onboardingState).toBe('DRAFT');
      expect(profile.submittedForReviewAt).toBeNull();
    });

    it('PRESERVES the draft data — withdrawing is not deleting', async () => {
      // The copy must never call this a reset, and neither may the command.
      await submitIt();
      const before = await prisma.providerProfile.findUnique({ where: { id: PP } });

      await postWithdraw();

      const after = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(after.displayName).toBe(before.displayName);
      expect(after.bio).toBe(before.bio);
      expect(after.headline).toBe(before.headline);
      expect(after.serviceAreaCity).toBe(before.serviceAreaCity);
      expect(after.yearsOfExperience).toBe(before.yearsOfExperience);
      // And the consent they already gave still stands.
      expect(after.acceptedConsentVersion).toBe(before.acceptedConsentVersion);
    });

    it('PRESERVES the immutable submission history', async () => {
      // The application was handed in. Withdrawing it is a later fact, not a
      // reason to forget the first one.
      await submitIt();
      expect(
        await prisma.providerOnboardingSubmission.count({ where: { providerProfileId: PP } }),
      ).toBe(1);

      await postWithdraw();

      expect(
        await prisma.providerOnboardingSubmission.count({ where: { providerProfileId: PP } }),
      ).toBe(1);
    });

    it('is auditable in both directions', async () => {
      await submitIt();
      await postWithdraw();

      const events = await prisma.auditEvent.findMany({
        where: { userId: USER },
        select: { type: true, metadata: true },
      });

      // Both facts survive as separate rows. NOTE: they share the event TYPE —
      // withdrawal is recorded as PROVIDER_ONBOARDING_SUBMITTED with
      // outcome 'withdrawn' rather than under a type of its own, because the
      // AuditEventType enum has no member for it. Distinguishable, but only by
      // reading metadata; see the sprint doc.
      const withdrawn = events.filter(
        (e: { metadata: { outcome?: string } }) => e.metadata?.outcome === 'withdrawn',
      );
      expect(withdrawn).toHaveLength(1);
      // And the state it was pulled back FROM is recorded, not dropped.
      expect((withdrawn[0].metadata as { previousState?: string }).previousState).toBeTruthy();
      expect(events.length).toBeGreaterThanOrEqual(2);
    });

    it('requires a NEW submission afterwards rather than resuming the old one', async () => {
      await submitIt();
      await postWithdraw();

      const review = await getReview();
      expect(review.body.lifecycleState).toBe('DRAFT');
      expect((await postSubmit({ version: review.body.draftVersion })).status).toBe(200);

      // A second, distinct submission row — the history now has two entries.
      expect(
        await prisma.providerOnboardingSubmission.count({ where: { providerProfileId: PP } }),
      ).toBe(2);
    });

    it('refuses once a reviewer has already accepted — the decision wins', async () => {
      // THE RACE. The reviewer’s write lands first; the withdrawal must not
      // silently undo an acceptance. Deterministic, because the pre-withdrawal
      // states are in the command’s WHERE clause rather than in a prior read.
      await submitIt();
      await prisma.providerProfile.update({
        where: { id: PP },
        data: { onboardingState: 'ACCEPTED' },
      });

      const res = await postWithdraw();
      expect(res.status).toBe(409);

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.onboardingState).toBe('ACCEPTED');
    });

    it('two concurrent withdrawals leave ONE transition', async () => {
      await submitIt();

      const results = await Promise.allSettled([postWithdraw(), postWithdraw()]);
      const ok = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as { status: number }).status === 200,
      );
      expect(ok).toHaveLength(1);

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.onboardingState).toBe('DRAFT');
    });
  });

  describe('a profile write can never grant verification or access', () => {
    it('refuses a patch that carries the verification axis', async () => {
      const review = await getReview();
      const res = await patchProfile({
        version: review.body.draftVersion,
        verified: true,
        verificationState: 'VERIFIED',
      });

      // forbidNonWhitelisted: the fields are not merely ignored, they are
      // refused. Silently dropping them would let a client believe it had
      // succeeded.
      expect(res.status).toBe(400);
    });

    it('leaves the verification axis untouched after such an attempt', async () => {
      const review = await getReview();
      await patchProfile({
        version: review.body.draftVersion,
        verified: true,
        verificationState: 'VERIFIED',
      });

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.verified).toBe(false);
      expect(profile.verificationState).toBe('UNVERIFIED');
    });

    it('grants no work access, even on a legitimate profile write', async () => {
      const review = await getReview();
      const ok = await patchProfile({ version: review.body.draftVersion, bio: 'A'.repeat(120) });
      expect([200, 409]).toContain(ok.status);

      expect(await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: PP } })).toBe(
        0,
      );
    });

    it('a full submission still grants nothing on either axis', async () => {
      // Restated here beside the profile-write cases so the whole
      // non-escalation story is readable in one place.
      await acceptCurrentTerms();
      const review = await getReview();
      await postSubmit({ version: review.body.draftVersion });

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.verified).toBe(false);
      expect(profile.verificationState).toBe('UNVERIFIED');
      expect(await prisma.providerWorkAccessGrant.count({ where: { providerProfileId: PP } })).toBe(
        0,
      );
    });
  });

  // ── Sprint 9B.26 — a draft written before V2 existed ─────────────────────

  describe('a legacy V1 draft opens in V2 without losing anything', () => {
    /**
     * A profile as the Sprint 8 wizard left it.
     *
     * Everything V2 later added is NULL: provider type, years of experience,
     * the weekly schedule, the snapped coordinates. This is the shape sitting
     * in production right now for every provider who started onboarding before
     * the V2 screens existed, and the release gate turns on whether V2 can
     * read it.
     */
    async function makeLegacyDraft(): Promise<void> {
      await prisma.providerAvailabilityInterval.deleteMany({
        where: { providerProfileId: PP },
      });
      await prisma.providerProfile.update({
        where: { id: PP },
        data: {
          // What V1 collected.
          displayName: 'Layla Mansour',
          headline: 'Certified electrician',
          bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete and useful.',
          phoneNumber: '+963900000444',
          serviceAreaCity: 'ReviewTestCity',
          serviceAreaCountry: 'SY',
          serviceAreaRadiusKm: 20,
          // What V2 added, and a legacy row cannot have.
          providerType: null,
          yearsOfExperience: null,
          serviceAreaLat: null,
          serviceAreaLng: null,
          status: 'DRAFT',
          onboardingState: 'DRAFT',
        },
      });
    }

    it('serves the review rather than failing on the missing fields', async () => {
      await makeLegacyDraft();
      const res = await getReview();

      // The whole compatibility question in one assertion: a read-model built
      // for V2 must not throw on a row that predates it.
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.groups)).toBe(true);
    });

    it('names the newly-required fields as blockers, each with somewhere to go', async () => {
      // Not "your application is broken" — a list of things to finish, and a
      // task id for each. A legacy provider is mid-application, not stuck.
      await makeLegacyDraft();
      const res = await getReview();

      const blocking = res.body.groups.find((g: { kind: string }) => g.kind === 'BLOCKING');
      const fields = blocking.items.map((i: { field: string }) => i.field);
      expect(fields).toContain('providerType');
      expect(fields).toContain('yearsOfExperience');
      expect(fields).toContain('availability');
      for (const item of blocking.items) expect(item.taskId).toBeTruthy();
    });

    it('KEEPS every field V1 already collected', async () => {
      // The data-loss question. Opening the new surface must not blank a
      // headline someone wrote a month ago.
      await makeLegacyDraft();
      await getReview();

      const profile = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(profile.displayName).toBe('Layla Mansour');
      expect(profile.headline).toBe('Certified electrician');
      expect(profile.bio).toContain('sufficiently long biography');
      expect(profile.phoneNumber).toBe('+963900000444');
      expect(profile.serviceAreaCity).toBe('ReviewTestCity');
      expect(profile.serviceAreaRadiusKm).toBe(20);
    });

    it('refuses to submit a legacy draft until the new requirements are met', async () => {
      // A legacy draft must not slip through the newer policy simply because
      // it was created under an older one.
      await makeLegacyDraft();
      await acceptCurrentTerms();
      const review = await getReview();

      expect(review.body.canSubmit).toBe(false);
      const res = await postSubmit({ version: review.body.draftVersion });
      expect(res.status).toBe(422);
    });

    it('a V2 write completes the legacy draft rather than replacing it', async () => {
      // Filling in the V2 fields must leave the V1 ones untouched — the two
      // vocabularies describe one application, not two.
      await makeLegacyDraft();
      const before = await prisma.providerProfile.findUnique({ where: { id: PP } });

      await prisma.providerProfile.update({
        where: { id: PP },
        data: { providerType: 'INDIVIDUAL', yearsOfExperience: 5 },
      });

      const after = await prisma.providerProfile.findUnique({ where: { id: PP } });
      expect(after.displayName).toBe(before.displayName);
      expect(after.headline).toBe(before.headline);
      expect(after.bio).toBe(before.bio);
      expect(after.providerType).toBe('INDIVIDUAL');

      const res = await getReview();
      const fields = res.body.groups
        .find((g: { kind: string }) => g.kind === 'BLOCKING')
        .items.map((i: { field: string }) => i.field);
      expect(fields).not.toContain('providerType');
      expect(fields).not.toContain('yearsOfExperience');
    });

    it('reports the SAME draft version V1 would have, so a rollback can resume it', async () => {
      // Rollback to V1 is a flag flip, not a migration. Both surfaces write
      // through the same versioned draft, so a provider bounced back to the
      // wizard picks up exactly where V2 left them.
      await makeLegacyDraft();
      const review = await getReview();

      const draft = await prisma.providerOnboardingDraft.findFirst({
        where: { providerProfileId: PP },
      });
      expect(review.body.draftVersion).toBe(draft ? draft.version : 0);
    });
  });

  // ── Sprint 9B.15 (late) — the hub endpoint, over real HTTP ───────────────

  describe('the hub the V2 shell opens on', () => {
    it('is SERVED — the endpoint the client has called since 9B.16 now exists', async () => {
      const res = await getHub();
      expect(res.status).toBe(200);
    });

    it('returns the six tasks, and the hub is not one of them', async () => {
      const res = await getHub();
      expect(res.body.tasks.map((t: { id: string }) => t.id)).toEqual([
        'BASICS_IDENTITY',
        'SERVICES_EXPERIENCE',
        'WORK_AREA',
        'WORKING_HOURS',
        'PORTFOLIO',
        'REVIEW_SUBMISSION',
      ]);
      expect(res.body.progress.total).toBe(6);
    });

    it('agrees with the REVIEW endpoint about readiness', async () => {
      // The reason both read one policy. A hub that said "done" while the
      // review refused to submit would be two answers to one question.
      await makeComplete({ bio: null });
      const hub = await getHub();
      const review = await getReview();

      const hubBlocked = hub.body.tasks.find((t: { id: string }) => t.id === 'PORTFOLIO').status;
      expect(hubBlocked).toBe('AVAILABLE');
      expect(review.body.canSubmit).toBe(false);
    });

    it('counts progress from the real draft, not from a fixture', async () => {
      await makeComplete({ bio: null, serviceAreaCity: null });
      const two = await getHub();
      await makeComplete();
      const none = await getHub();

      // Completing real columns in Postgres moves the count.
      expect(none.body.progress.complete).toBeGreaterThan(two.body.progress.complete);
    });

    it('points at the first outstanding task', async () => {
      await makeComplete({ bio: null });
      const res = await getHub();
      expect(res.body.nextAction).toEqual({ kind: 'COMPLETE_TASK', taskId: 'PORTFOLIO' });
    });

    it('lets the provider INTO review when only the terms are outstanding', async () => {
      // `consent` is a completeness field owned by the CONSENT step, which maps
      // to REVIEW_SUBMISSION — and the terms are accepted ON the review screen.
      //
      // This test used to assert BLOCKED / nextAction NONE, which is the
      // deadlock the Sprint 9B.27 browser journey walked into: five green
      // tasks, a locked sixth reading "Finish the tasks above first", and no
      // task above left to finish. The application was unsubmittable and the
      // hub offered no way forward.
      //
      // Enterable, and honest about why: there is still something to do on the
      // review task, so the next action is to complete it rather than to
      // Submit. Submit stays disabled on the screen itself, with the server's
      // own blockedReason next to it.
      await makeComplete();
      const res = await getHub();

      const review = res.body.tasks.find((t: { id: string }) => t.id === 'REVIEW_SUBMISSION');
      expect(review.status).toBe('AVAILABLE');
      expect(res.body.nextAction).toEqual({
        kind: 'COMPLETE_TASK',
        taskId: 'REVIEW_SUBMISSION',
      });
      // And the server still refuses the submission itself — the gate moved to
      // where it belongs, it did not disappear.
      const blocked = await postSubmit({ version: (await getReview()).body.draftVersion });
      expect(blocked.status).toBe(422);
    });

    it('offers SUBMIT once the draft is genuinely complete, consent included', async () => {
      await makeComplete();
      await acceptCurrentTerms();

      const res = await getHub();
      expect(res.body.status).toBe('DRAFT');
      const review = res.body.tasks.find((t: { id: string }) => t.id === 'REVIEW_SUBMISSION');
      expect(review.status).toBe('AVAILABLE');
      expect(res.body.progress.complete).toBe(5);
      expect(res.body.nextAction).toEqual({ kind: 'SUBMIT' });
    });

    it('turns every task to WAITING after a real submission', async () => {
      await acceptCurrentTerms();
      const review = await getReview();
      expect((await postSubmit({ version: review.body.draftVersion })).status).toBe(200);

      const res = await getHub();
      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.nextAction).toEqual({ kind: 'AWAIT_REVIEW' });
      for (const t of res.body.tasks) expect(t.status).toBe('WAITING');
    });

    it('carries no capability, grant or verification fact', async () => {
      // The hub is the onboarding axis. Collapsing it with access is the
      // confusion ADR 0005 exists to prevent.
      const raw = JSON.stringify((await getHub()).body);
      expect(raw).not.toMatch(/capabilit/i);
      expect(raw).not.toMatch(/grant/i);
      expect(raw).not.toMatch(/workAccess/i);
    });

    it('refuses an unauthenticated caller', async () => {
      currentUser = null;
      try {
        expect((await getHub()).status).toBe(403);
      } finally {
        currentUser = { id: USER };
      }
    });

    it('refuses a user with no provider profile at the guard, not the service', async () => {
      // 403, not 404: ProviderCapabilityGuard answers first, because someone
      // with no provider profile holds no provider capability. The service is
      // never reached, so there is no hub to leak the existence of.
      currentUser = { id: `${P}ghost` };
      try {
        expect((await getHub()).status).toBe(403);
      } finally {
        currentUser = { id: USER };
      }
    });
  });

  // ── the response boundary ────────────────────────────────────────────────

  describe('what reaches the wire', () => {
    it('carries codes, never prose — the client owns the sentence', async () => {
      await makeComplete({ bio: null });
      const raw = JSON.stringify((await getReview()).body);
      expect(raw).not.toMatch(/please /i);
      expect(raw).not.toMatch(/you must/i);
    });
  });
});
