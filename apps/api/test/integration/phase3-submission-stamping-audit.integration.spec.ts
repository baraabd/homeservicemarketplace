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
  UnauthorizedException,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { ADMIN_PROVIDER_TRANSITIONS } from '@homeservicemarketplace/contracts';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-stamping');

// Sprint 09B.29 Phase 3 — SEMANTIC AUDIT of the Journey D production change.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.10
//
// §3.8.8 changed three things to un-deadlock a rejected application:
//
//   · ONBOARDING_AXIS_FOR      — status → onboarding axis mapping
//   · decideIfInStatus         — now writes the onboarding axis too
//   · stampSubmissionDecision  — stamps decidedAt/By/decision on a submission
//
// The first two are constrained by a conditional UPDATE and were exercised by
// Journey D. The THIRD is not: it is an `updateMany` over "every undecided
// submission", driven by a mapping that answers non-null for `suspend` and
// `reactivate` as well as for `approve` and `reject`. That combination is worth
// auditing rather than assuming, because both halves can be wrong quietly:
//
//   · MORE THAN ONE undecided submission is reachable — submit, withdraw,
//     submit — and an `updateMany` stamps them all with one decision.
//   · SUSPEND and REACTIVATE are CONDUCT decisions. If they stamp, an
//     application nobody reviewed acquires a reviewer, a date and a verdict
//     from an operator who was doing something else entirely.
//
// Every state below is reached through canonical endpoints; the database is
// read for assertions and written only for fixture preconditions and cleanup.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string; roles: string[] } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (!currentUser) throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    ctx.switchToHttp().getRequest().user = currentUser;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

interface SubmissionRow {
  id: string;
  submittedAt: Date;
  decidedAt: Date | null;
  decidedByUserId: string | null;
  decision: string | null;
}

d('Phase 3 — submission-stamping semantic audit (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3st');
  const ADMIN = `${P}admin`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  let lifecycleLock: HeldLock;

  const asAdmin = () => {
    currentUser = { id: ADMIN, roles: ['admin'] };
  };
  const asProvider = (id: string) => {
    currentUser = { id, roles: ['customer', 'provider'] };
  };

  const approve = (id: string) => request(http).post(`/v1/admin/providers/${id}/approve`).send({});
  const reject = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/reject`).send(body);
  const suspend = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/suspend`).send(body);
  const reactivate = (id: string) =>
    request(http).post(`/v1/admin/providers/${id}/reactivate`).send({});

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);
  const withdraw = () => request(http).post('/v1/me/provider/onboarding/withdraw').send({});

  const submissionsOf = (profileId: string): Promise<SubmissionRow[]> =>
    prisma.providerOnboardingSubmission.findMany({
      where: { providerProfileId: profileId },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        submittedAt: true,
        decidedAt: true,
        decidedByUserId: true,
        decision: true,
      },
    }) as Promise<SubmissionRow[]>;

  const undecided = (rows: SubmissionRow[]) => rows.filter((r) => r.decidedAt === null);
  const decided = (rows: SubmissionRow[]) => rows.filter((r) => r.decidedAt !== null);

  async function cleanupFixtures(): Promise<void> {
    const rows = (await prisma.providerProfile.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);

    await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingSubmission.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerCategoryApplication.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { in: ids } },
    });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: { in: ids } } });
    await prisma.providerProfile.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.userRole.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: { in: [LEAF, ROOT] } } });
  }

  /** A fresh provider, filled in but NOT yet submitted. Returns the profile id
   *  and the draft version the caller must echo to submit. */
  async function buildReadyProvider(userId: string): Promise<string> {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@j3st.test`,
        firstName: 'Test',
        lastName: 'Provider',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    asProvider(userId);
    await upgrade().expect(200);
    const id = (await prisma.providerProfile.findFirst({ where: { userId } })).id as string;

    let v = (await getDraft().expect(200)).body.version as number;
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName: 'Test Provider', phoneNumber: '+963900000010' });
    await step('LOCATION', {
      serviceAreaCity: 'StampCity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 12,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 4, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: 'Electrician available for residential work',
      bio: 'Four years of residential electrical work including rewiring and fault finding.',
    });
    const review = await getReview().expect(200);
    await patchStep('CONSENT', {
      acceptedConsentVersion: review.body.terms.version,
      version: review.body.draftVersion,
    }).expect(200);
    return id;
  }

  /** Hand the current provider's application in. */
  async function submitNow(): Promise<void> {
    const ready = await getReview().expect(200);
    expect(ready.body.canSubmit).toBe(true);
    await postSubmit({ version: ready.body.draftVersion }).expect(200);
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const r = (p: string) => require(p);
    const { PrismaService } = r('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = r('../../src/infrastructure/prisma/transaction.runner');
    const { ProviderProfileRepository } = r(
      '../../src/infrastructure/persistence/bids/provider-profile.repository',
    );
    const { ProviderOnboardingDraftRepository } = r(
      '../../src/infrastructure/persistence/provider/provider-onboarding-draft.repository',
    );
    const { ServiceCategoryRepository } = r(
      '../../src/infrastructure/persistence/services/service-category.repository',
    );
    const { ProviderCategoryApplicationRepository } = r(
      '../../src/infrastructure/persistence/services/provider-category-application.repository',
    );
    const { UserRepository } = r('../../src/infrastructure/persistence/iam/user.repository');
    const { RoleRepository } = r('../../src/infrastructure/persistence/iam/role.repository');
    const { PlatformSettingRepository } = r(
      '../../src/infrastructure/persistence/settings/platform-setting.repository',
    );
    const { AuditService } = r('../../src/modules/iam/audit/audit.service');
    const { AuditEventRepository } = r(
      '../../src/infrastructure/persistence/iam/audit-event.repository',
    );
    const { AdminAuditService } = r('../../src/modules/admin/admin-audit.service');
    const { SecurityEventsBus } = r('../../src/shared/security-events/security-events.bus');
    const { NotificationsService } = r('../../src/modules/notifications/notifications.service');
    const { AdminVerificationController } = r(
      '../../src/modules/admin/verification/admin-verification.controller',
    );
    const { AdminVerificationService } = r(
      '../../src/modules/admin/verification/admin-verification.service',
    );
    const { AdminVerificationCaseService } = r(
      '../../src/modules/admin/verification/admin-verification-case.service',
    );
    const { ProviderOnboardingWizardController } = r(
      '../../src/modules/provider/onboarding/provider-onboarding-wizard.controller',
    );
    const { ProviderOnboardingWizardService } = r(
      '../../src/modules/provider/onboarding/provider-onboarding-wizard.service',
    );
    // Sprint 09B.29 Phase 5 (C2) — the enabled-market registry. The REAL one:
    // these suites have a database and the seed writes SY/SE/SA, so the market
    // boundary is exercised rather than stubbed away.
    const { MarketRegistryService } = r(
      '../../src/modules/provider/onboarding/market/market-registry.service',
    );
    const { SupportedMarketsService } = r(
      '../../src/modules/provider/onboarding/market/supported-markets.service',
    );
    // Sprint 09B.29 Phase 5 — bound to the honest production adapter.
    const { MARKET_LOCATION_RESOLVER_PORT } = r(
      '../../src/modules/provider/onboarding/market/market-location-resolver.port',
    );
    const { UnavailableMarketLocationResolver } = r(
      '../../src/modules/provider/onboarding/market/unavailable-market-location-resolver.adapter',
    );
    // Sprint 09B.29 Phase 5 (C1) — the wizard now fills the two fields the
    // approved V2 screens no longer ask about. The REAL service: these suites
    // have a database, and the defaults are conditional writes whose whole
    // point is what Postgres does with them.
    const { ProviderOnboardingDefaultsService } = r(
      '../../src/modules/provider/onboarding/market/onboarding-defaults.service',
    );
    const { ProviderAvatarService } = r(
      '../../src/modules/provider/onboarding/avatar/provider-avatar.service',
    );
    // Sprint 09B.29 Phase 4 — ProviderAvatarService claims and retires
    // reservations now, so its ledger has to exist here too. The REAL one:
    // this suite has a database, and a double would leave the claim's
    // ownership conditions untested in the one place they can be.
    const { PublicMediaLedgerService } = r('../../src/modules/media/public-media-ledger.service');
    const { ProviderServiceAreaExpansionService } = r(
      '../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service',
    );
    const { ProviderController } = r('../../src/modules/provider/provider.controller');
    const { ProviderService } = r('../../src/modules/provider/provider.service');
    const { ProviderOnboardingService } = r(
      '../../src/modules/provider/onboarding/provider-onboarding.service',
    );
    const { ProviderCapabilityService } = r(
      '../../src/modules/provider/capability/provider-capability.service',
    );
    const { ProviderCapabilityGuard } = r(
      '../../src/modules/provider/guards/provider-capability.guard',
    );
    const { AllExceptionsFilter } = r('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = r('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = r('../../src/modules/iam/authentication/guards/csrf.guard');
    const { AppConfigService } = r('../../src/config/app-config.service');
    const { STORAGE_PORT } = r('../../src/infrastructure/storage/storage.port');

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminVerificationController,
        ProviderOnboardingWizardController,
        ProviderController,
      ],
      providers: [
        AdminVerificationService,
        AdminVerificationCaseService,
        AdminAuditService,
        SecurityEventsBus,
        ProviderOnboardingWizardService,
        MarketRegistryService,
        SupportedMarketsService,
        {
          provide: MARKET_LOCATION_RESOLVER_PORT,
          useClass: UnavailableMarketLocationResolver,
        },
        ProviderOnboardingDefaultsService,
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
        {
          provide: NotificationsService,
          useValue: { createForUser: async () => ({ id: 'stub-notification' }) },
        },
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
        id: ADMIN,
        email: `${ADMIN}@j3st.test`,
        firstName: 'Operator',
        lastName: 'Admin',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
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
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── 1. the ordinary decisions stamp exactly one row, correctly ───────────

  describe('an application decision stamps the submission it decided', () => {
    it('reject stamps the current undecided submission as RETURNED', async () => {
      const user = `${P}reject`;
      const id = await buildReadyProvider(user);
      await submitNow();

      asAdmin();
      await reject(id, { reason: 'Headline is too vague.' }).expect(200);

      const rows = await submissionsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('RETURNED');
      expect(rows[0].decidedByUserId).toBe(ADMIN);
      expect(rows[0].decidedAt).toBeInstanceOf(Date);
    });

    it('approve stamps the current undecided submission as ACCEPTED', async () => {
      const user = `${P}approve`;
      const id = await buildReadyProvider(user);
      await submitNow();

      asAdmin();
      await approve(id).expect(200);

      const rows = await submissionsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0].decision).toBe('ACCEPTED');
      expect(rows[0].decidedByUserId).toBe(ADMIN);
    });
  });

  // ── 2. history is immutable ──────────────────────────────────────────────

  describe('a decided submission is never rewritten', () => {
    it('keeps the first decision when a corrected application is approved', async () => {
      const user = `${P}history`;
      const id = await buildReadyProvider(user);
      await submitNow();

      asAdmin();
      await reject(id, { reason: 'Fix the headline.' }).expect(200);
      const afterReject = await submissionsOf(id);
      expect(afterReject).toHaveLength(1);
      const firstStamp = {
        decision: afterReject[0].decision,
        decidedAt: afterReject[0].decidedAt?.toISOString(),
        decidedByUserId: afterReject[0].decidedByUserId,
      };
      expect(firstStamp.decision).toBe('RETURNED');

      // The provider corrects and resubmits — a second submission row.
      asProvider(user);
      const draft = await getDraft().expect(200);
      await patchStep('PROFILE', {
        headline: 'Licensed electrician — rewiring and emergency callouts',
        bio: 'Four years of residential electrical work including rewiring and fault finding.',
        version: draft.body.version,
      }).expect(200);
      await submitNow();

      asAdmin();
      await approve(id).expect(200);

      const rows = await submissionsOf(id);
      expect(rows).toHaveLength(2);
      // Row 0 is untouched, to the millisecond.
      expect({
        decision: rows[0].decision,
        decidedAt: rows[0].decidedAt?.toISOString(),
        decidedByUserId: rows[0].decidedByUserId,
      }).toEqual(firstStamp);
      // Row 1 carries the new decision.
      expect(rows[1].decision).toBe('ACCEPTED');
    });
  });

  // ── 3. more than one UNDECIDED submission ────────────────────────────────

  describe('when more than one submission is undecided', () => {
    /** submit → withdraw → submit leaves TWO undecided rows, entirely through
     *  canonical endpoints. */
    async function twoUndecided(user: string): Promise<string> {
      const id = await buildReadyProvider(user);
      await submitNow();
      await withdraw().expect(200);
      await submitNow();

      const rows = await submissionsOf(id);
      expect(rows).toHaveLength(2);
      expect(undecided(rows)).toHaveLength(2);
      return id;
    }

    it('a decision stamps exactly ONE of them', async () => {
      // The withdrawn first attempt was never reviewed. Stamping it with the
      // verdict on a LATER application would put a decision in the record that
      // nobody made about it — and `updateMany` over "every undecided
      // submission" does precisely that.
      const id = await twoUndecided(`${P}multi`);

      asAdmin();
      await approve(id).expect(200);

      const rows = await submissionsOf(id);
      expect(decided(rows)).toHaveLength(1);
      expect(undecided(rows)).toHaveLength(1);
      // It is the LATEST submission that was decided — the one the reviewer
      // was actually looking at.
      expect(rows[1].decision).toBe('ACCEPTED');
      expect(rows[0].decision).toBeNull();
      expect(rows[0].decidedAt).toBeNull();
    });
  });

  // ── 4. conduct decisions must not decide applications ────────────────────

  describe('suspension and reactivation are conduct decisions', () => {
    /** An ACTIVE provider who still has an undecided submission — reachable
     *  through canonical endpoints alone via the withdraw/resubmit path, and
     *  also the shape every row predating the stamping change has. */
    async function activeWithUndecidedSubmission(user: string): Promise<string> {
      const id = await buildReadyProvider(user);
      await submitNow();
      await withdraw().expect(200);
      await submitNow();
      asAdmin();
      await approve(id).expect(200);
      return id;
    }

    it('suspension does not decide an undecided submission', async () => {
      const id = await activeWithUndecidedSubmission(`${P}suspend`);
      const before = await submissionsOf(id);
      const stillOpen = undecided(before);
      expect(stillOpen.length).toBeGreaterThan(0);

      asAdmin();
      await suspend(id, { reason: 'Under investigation.' }).expect(200);

      const after = await submissionsOf(id);
      // A suspension is about conduct. It must not hand an unreviewed
      // application a reviewer, a date and a verdict.
      expect(
        undecided(after)
          .map((r) => r.id)
          .sort(),
      ).toEqual(stillOpen.map((r) => r.id).sort());
    });

    it('suspension does not alter an already recorded onboarding decision', async () => {
      const id = await activeWithUndecidedSubmission(`${P}suspend2`);
      const before = await submissionsOf(id);
      const decidedBefore = decided(before).map((r) => ({
        id: r.id,
        decision: r.decision,
        decidedAt: r.decidedAt?.toISOString(),
        decidedByUserId: r.decidedByUserId,
      }));
      expect(decidedBefore.length).toBeGreaterThan(0);

      asAdmin();
      await suspend(id, { reason: 'Under investigation.' }).expect(200);

      const after = await submissionsOf(id);
      expect(
        decided(after).map((r) => ({
          id: r.id,
          decision: r.decision,
          decidedAt: r.decidedAt?.toISOString(),
          decidedByUserId: r.decidedByUserId,
        })),
      ).toEqual(decidedBefore);
    });

    it('reactivation does not decide an undecided submission either', async () => {
      const id = await activeWithUndecidedSubmission(`${P}reactivate`);
      asAdmin();
      await suspend(id, { reason: 'Under investigation.' }).expect(200);

      const before = undecided(await submissionsOf(id))
        .map((r) => r.id)
        .sort();
      expect(before.length).toBeGreaterThan(0);

      await reactivate(id).expect(200);

      const after = undecided(await submissionsOf(id))
        .map((r) => r.id)
        .sort();
      expect(after).toEqual(before);
    });

    it('still moves the onboarding axis to ACCEPTED, which is the point of the mapping', async () => {
      // The axis mapping and the submission stamp are separate concerns. This
      // pins that fixing the stamp did not undo the axis fix: a suspended
      // provider must not be sent back into the wizard.
      const id = await activeWithUndecidedSubmission(`${P}axis`);
      asAdmin();
      await suspend(id, { reason: 'Under investigation.' }).expect(200);
      const p = await prisma.providerProfile.findUnique({ where: { id } });
      expect(p.onboardingState).toBe('ACCEPTED');
      expect(p.status).toBe('SUSPENDED');
    });
  });

  // ── 5. concurrency ───────────────────────────────────────────────────────

  describe('concurrent decisions', () => {
    it('let exactly one of six simultaneous approvals through', async () => {
      const id = await buildReadyProvider(`${P}race`);
      await submitNow();

      asAdmin();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => approve(id).then((r) => r.status)),
      );
      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(new Set(results)).toEqual(new Set([200, 409]));

      const rows = await submissionsOf(id);
      expect(rows).toHaveLength(1);
      expect(decided(rows)).toHaveLength(1);
      expect(rows[0].decision).toBe('ACCEPTED');
    });

    it('never overwrites a verdict already recorded on a submission', async () => {
      // NOT a test that a second decision is refused — `reject` is legal from
      // ACTIVE by design (a provider approved in error must be stoppable), so
      // approve-then-reject is a legitimate sequence and BOTH return 200.
      //
      // What must hold is that the later decision does not rewrite the earlier
      // one: the application WAS accepted on the day it was accepted, and the
      // rejection that followed is a decision about the provider, not a
      // retroactive edit of the paperwork.
      const id = await buildReadyProvider(`${P}overwrite`);
      await submitNow();

      asAdmin();
      await approve(id).expect(200);
      const afterApprove = (await submissionsOf(id))[0];
      expect(afterApprove.decision).toBe('ACCEPTED');

      await reject(id, { reason: 'Approved in error.' }).expect(200);

      const afterReject = await submissionsOf(id);
      expect(afterReject).toHaveLength(1);
      expect({
        decision: afterReject[0].decision,
        decidedAt: afterReject[0].decidedAt?.toISOString(),
        decidedByUserId: afterReject[0].decidedByUserId,
      }).toEqual({
        decision: afterApprove.decision,
        decidedAt: afterApprove.decidedAt?.toISOString(),
        decidedByUserId: afterApprove.decidedByUserId,
      });

      // The PROFILE, which records current standing rather than the verdict on
      // a past application, does move.
      const profile = await prisma.providerProfile.findUnique({ where: { id } });
      expect(profile.status).toBe('REJECTED');
      expect(profile.onboardingState).toBe('RETURNED');
    });
  });

  // ── 6. the documented transition matrix IS the code ──────────────────────

  describe('the legal transition matrix matches the running endpoints', () => {
    it('exposes the contract the endpoints actually enforce', async () => {
      // Reconciles §3.8.8's ambiguous "reject-from-ACTIVE" wording with the
      // published table. `reject` is legal from ACTIVE by design — a provider
      // approved in error must be stoppable — so a second rejection after an
      // approval is a real, audited transition rather than a refusal.
      expect(ADMIN_PROVIDER_TRANSITIONS.approve).toEqual(['PENDING_REVIEW']);
      expect(ADMIN_PROVIDER_TRANSITIONS.reject).toEqual([
        'DRAFT',
        'PENDING_REVIEW',
        'ACTIVE',
        'SUSPENDED',
      ]);
      expect(ADMIN_PROVIDER_TRANSITIONS.suspend).toEqual(['ACTIVE']);
      expect(ADMIN_PROVIDER_TRANSITIONS.reactivate).toEqual(['SUSPENDED']);
    });

    it('refuses and permits exactly what the table says', async () => {
      const id = await buildReadyProvider(`${P}matrix`);
      asAdmin();

      // DRAFT: only reject is legal.
      expect((await approve(id)).status).toBe(409);
      expect((await suspend(id, { reason: 'x' })).status).toBe(409);
      expect((await reactivate(id)).status).toBe(409);

      // → PENDING_REVIEW
      asProvider(`${P}matrix`);
      await submitNow();
      asAdmin();
      expect((await suspend(id, { reason: 'x' })).status).toBe(409);
      expect((await reactivate(id)).status).toBe(409);
      expect((await approve(id)).status).toBe(200);

      // → ACTIVE: suspend and reject legal, approve and reactivate not.
      expect((await approve(id)).status).toBe(409);
      expect((await reactivate(id)).status).toBe(409);
      expect((await suspend(id, { reason: 'x' })).status).toBe(200);

      // → SUSPENDED: reactivate and reject legal.
      expect((await approve(id)).status).toBe(409);
      expect((await suspend(id, { reason: 'x' })).status).toBe(409);
      expect((await reactivate(id)).status).toBe(200);

      // → ACTIVE again; reject IS legal from here.
      expect((await reject(id, { reason: 'Approved in error.' })).status).toBe(200);

      // → REJECTED: nothing in the table lists REJECTED as a source.
      expect((await reject(id, { reason: 'again' })).status).toBe(409);
      expect((await approve(id)).status).toBe(409);
      expect((await suspend(id, { reason: 'x' })).status).toBe(409);
      expect((await reactivate(id)).status).toBe(409);
    });
  });
});
