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
  const patchProfile = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/PROFILE').send(body);

  async function setConsentVersion(value: string): Promise<void> {
    await prisma.platformSetting.upsert({
      where: { key: CONSENT_KEY },
      create: { key: CONSENT_KEY, value, updatedBy: USER },
      update: { value },
    });
  }

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
    await setConsentVersion('v1');
    await prisma.providerOnboardingSubmission.deleteMany({ where: { providerProfileId: PP } });
    await prisma.auditEvent.deleteMany({ where: { userId: USER } });
    await prisma.providerProfile.update({
      where: { id: PP },
      data: { acceptedConsentVersion: null, consentAcceptedAt: null },
    });
    await makeComplete();
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
      // to v1, the operator published v2, and the tick must not survive it.
      await acceptCurrentTerms();
      expect((await getReview()).body.terms.accepted).toBe(true);

      await setConsentVersion('v2');

      const after = await getReview();
      expect(after.body.terms.version).toBe('v2');
      expect(after.body.terms.acceptedVersion).toBe('v1');
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
