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

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-journey-d');

// Sprint 09B.29 Phase 3, JOURNEY D — a returned application must be correctable.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// THE CLAIM UNDER TEST
//
// A reviewer who sends an application back is asking the provider to fix
// something. That is only meaningful if the provider can then (a) see that it
// came back, (b) edit it, and (c) hand it in again. This journey drives that
// loop end to end through canonical endpoints: submit → admin reject → read →
// correct → resubmit → admin approve.
//
// WHY THIS IS THE SAME BUG CLASS AS THE PENDING-SPECIALTY DEADLOCK
//
// Phase 3 exists because a provider could reach a state where the product told
// them to wait for something that was never going to happen. `RETURNED` is the
// one lifecycle value the design says "puts work back in their hands"
// (`hubStatusOf` maps it to ACTION_REQUIRED, and the submit claim accepts it as
// a source state). If nothing ever WRITES that value, a rejected provider is
// left holding `DOCUMENTS_REQUIRED` — which `assertEditable` refuses to edit
// and the submit claim refuses to accept — and the loop above cannot close.
//
// These tests assert the INTENDED behaviour. Where the product does not yet do
// it, they fail, and that failure is the regression evidence required before
// any production change.
//
// WHAT IS REAL / NOT REAL: as Journey C. Only `JwtAuthGuard` and `CsrfGuard`
// are substituted; the admin's role claim is supplied by the harness because no
// in-scope canonical operation grants it.
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

d('Phase 3 Journey D — a returned application is correctable (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3d');
  const USER = `${P}user`;
  /** An untouched second candidate, to prove a decision on one application
   *  cannot reach another's history. */
  const OTHER = `${P}other`;
  const ADMIN = `${P}admin`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  let lifecycleLock: HeldLock;
  let profileId: string;
  let otherProfileId: string;
  /** The id of the FIRST submission, captured before the rejection, so the
   *  history assertions can name the exact row rather than a count. */
  let firstSubmissionId: string;

  const asAdmin = () => {
    currentUser = { id: ADMIN, roles: ['admin'] };
  };
  const asProvider = (id = USER) => {
    currentUser = { id, roles: ['customer', 'provider'] };
  };

  const reject = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/reject`).send(body);
  const approve = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/approve`).send(body);

  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getHub = () => request(http).get('/v1/me/provider/onboarding/hub');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);
  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeOf = (res: any): unknown => res.body?.error?.code;

  const submissions = (id: string) =>
    prisma.providerOnboardingSubmission.findMany({
      where: { providerProfileId: id },
      orderBy: { submittedAt: 'asc' },
    });

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

  /** Fill every provider-owned input through the real step endpoints and hand
   *  the application in. Returns the profile id. */
  async function buildSubmittedProvider(userId: string, headline: string): Promise<string> {
    asProvider(userId);
    await upgrade().expect(200);
    const id = (await prisma.providerProfile.findFirst({ where: { userId } })).id as string;

    let v = (await getDraft().expect(200)).body.version as number;
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName: 'Dana Khoury', phoneNumber: '+963900000321' });
    await step('LOCATION', {
      serviceAreaCity: 'JourneyDCity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 15,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 5, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline,
      bio: 'Five years of residential electrical work across the city, including rewiring and emergency callouts.',
    });
    const review = await getReview().expect(200);
    await patchStep('CONSENT', {
      acceptedConsentVersion: review.body.terms.version,
      version: review.body.draftVersion,
    }).expect(200);
    const ready = await getReview().expect(200);
    expect(ready.body.canSubmit).toBe(true);
    await postSubmit({ version: ready.body.draftVersion }).expect(200);
    return id;
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
    const { AdminAuditService } = require('../../src/modules/admin/admin-audit.service');
    const { SecurityEventsBus } = require('../../src/shared/security-events/security-events.bus');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      AdminVerificationController,
    } = require('../../src/modules/admin/verification/admin-verification.controller');
    const {
      AdminVerificationService,
    } = require('../../src/modules/admin/verification/admin-verification.service');
    const {
      AdminVerificationCaseService,
    } = require('../../src/modules/admin/verification/admin-verification-case.service');
    const {
      ProviderCapabilitiesController,
    } = require('../../src/modules/provider/capability/provider-capabilities.controller');
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
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { STORAGE_PORT } = require('../../src/infrastructure/storage/storage.port');

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminVerificationController,
        ProviderCapabilitiesController,
        ProviderOnboardingWizardController,
        ProviderController,
      ],
      providers: [
        AdminVerificationService,
        AdminVerificationCaseService,
        AdminAuditService,
        SecurityEventsBus,
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
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
          useValue: {
            createForUser: async (input: { userId: string; title: string }) => {
              notifications.push(input);
              return { id: 'stub-notification' };
            },
          },
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

    for (const [id, first] of [
      [USER, 'Dana'],
      [OTHER, 'Fadi'],
      [ADMIN, 'Operator'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3d.test`,
          firstName: first,
          lastName: 'Khoury',
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

    profileId = await buildSubmittedProvider(USER, 'Electrician — first submission');
    otherProfileId = await buildSubmittedProvider(OTHER, 'Electrician — untouched neighbour');
    firstSubmissionId = (await submissions(profileId))[0].id;

    // THE DECISION THIS JOURNEY HANGS ON, through the canonical endpoint.
    asAdmin();
    await reject(profileId, { reason: 'Your headline does not describe the work you do.' }).expect(
      200,
    );
  });

  afterAll(async () => {
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  /** Notifications the services asked for, in order. */
  const notifications: Array<{ userId: string; title: string }> = [];

  // ── 1. the rejection is recorded ─────────────────────────────────────────

  describe('the reviewer’s decision', () => {
    it('marked the profile REJECTED and kept the reason', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('REJECTED');
      expect(p.rejectionReason).toBe('Your headline does not describe the work you do.');
    });

    it('audited the rejection once, naming both parties', async () => {
      const audits = (await prisma.auditEvent.findMany({
        where: { type: 'ADMIN_PROVIDER_REJECTED' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })) as Array<{ userId: string | null; metadata: any }>;
      const mine = audits.filter((a) => a.metadata?.providerProfileId === profileId);
      expect(mine).toHaveLength(1);
      expect(mine[0].userId).toBe(ADMIN);
      expect(mine[0].metadata).toMatchObject({
        targetUserId: USER,
        previousStatus: 'PENDING_REVIEW',
        newStatus: 'REJECTED',
      });
    });

    it('notified the provider', async () => {
      expect(notifications.filter((n) => n.userId === USER)).toHaveLength(1);
    });
  });

  // ── 2. the provider is told it came back ─────────────────────────────────

  describe('what the provider sees', () => {
    beforeEach(() => asProvider());

    it('puts the application back in the provider’s hands, not "under review"', async () => {
      // `hubStatusOf` maps RETURNED to ACTION_REQUIRED and both SUBMITTED and
      // DOCUMENTS_REQUIRED to SUBMITTED. A rejected application showing
      // SUBMITTED tells the provider to keep waiting for a decision that has
      // already been made.
      const res = await getHub().expect(200);
      expect(res.body.status).toBe('ACTION_REQUIRED');
    });

    it('moved the lifecycle axis to RETURNED, not left it at DOCUMENTS_REQUIRED', async () => {
      // The database-level statement of the same thing. `RETURNED` is the only
      // lifecycle value the submit claim accepts as a re-entry point, so if the
      // axis is not moved the provider cannot resubmit however the UI reads.
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.onboardingState).toBe('RETURNED');
    });

    it('offers something to do rather than a wait', async () => {
      const res = await getHub().expect(200);
      expect(res.body.nextAction?.kind).not.toBe('AWAIT_REVIEW');
      expect(res.body.tasks.length).toBeGreaterThan(0);
    });
  });

  // ── 3. the correction ────────────────────────────────────────────────────

  describe('correcting the application', () => {
    beforeEach(() => asProvider());

    it('lets the provider edit the field that was criticised', async () => {
      // The whole point of sending it back. `assertEditable` refuses SUBMITTED
      // and DOCUMENTS_REQUIRED; a returned application must not be either.
      const draft = await getDraft().expect(200);
      await patchStep('PROFILE', {
        headline: 'Licensed electrician — rewiring, faults and emergency callouts',
        bio: 'Five years of residential electrical work across the city, including rewiring and emergency callouts.',
        version: draft.body.version,
      }).expect(200);
    });

    it('persisted the correction', async () => {
      const draft = await getDraft().expect(200);
      expect(JSON.stringify(draft.body)).toContain('Licensed electrician');
    });

    it('lets the provider hand it in again', async () => {
      const ready = await getReview().expect(200);
      expect(ready.body.canSubmit).toBe(true);
      await postSubmit({ version: ready.body.draftVersion }).expect(200);
    });

    it('is queued for review once more', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('PENDING_REVIEW');
      expect(p.onboardingState).toBe('DOCUMENTS_REQUIRED');
    });

    it('clears the stale rejection reason once resubmitted or re-decided', async () => {
      // A provider who has fixed the problem and handed it back in must not
      // still be shown why they were turned down the first time.
      asAdmin();
      await approve(profileId).expect(200);
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('ACTIVE');
      expect(p.rejectionReason).toBeNull();
    });
  });

  // ── 4. history is preserved, not overwritten ─────────────────────────────

  describe('historical isolation', () => {
    it('kept the first submission as its own row', async () => {
      // Two hand-ins, two rows. Overwriting the first would destroy the record
      // of what was actually reviewed and rejected — the snapshot exists
      // precisely so a later policy change cannot rewrite history.
      const rows = await submissions(profileId);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].id).toBe(firstSubmissionId);
    });

    it('kept the first submission’s snapshot exactly as it was reviewed', async () => {
      const rows = await submissions(profileId);
      expect(JSON.stringify(rows[0].snapshot)).toContain('first submission');
      // And the correction is in the SECOND row, not retrofitted into the first.
      expect(JSON.stringify(rows[0].snapshot)).not.toContain('Licensed electrician');
      expect(JSON.stringify(rows[1].snapshot)).toContain('Licensed electrician');
    });

    it('recorded the reviewer’s decision against the submission it decided', async () => {
      // `ProviderOnboardingSubmission` carries `decidedAt`, `decidedByUserId`
      // and `decision` — "written once when a reviewer acts", per the schema.
      // Leaving them null means the submission history cannot answer "who
      // decided this, and how", which is the question an appeal asks.
      const rows = await submissions(profileId);
      expect(rows[0].decidedAt).toBeInstanceOf(Date);
      expect(rows[0].decidedByUserId).toBe(ADMIN);
      expect(rows[0].decision).toBe('RETURNED');
    });

    it('did not touch the untouched neighbour’s application', async () => {
      const other = await prisma.providerProfile.findUnique({ where: { id: otherProfileId } });
      expect(other.status).toBe('PENDING_REVIEW');
      expect(other.rejectionReason).toBeNull();
      const rows = await submissions(otherProfileId);
      expect(rows).toHaveLength(1);
      expect(rows[0].decidedAt).toBeNull();
    });
  });

  // ── 5. the decision cannot be replayed ───────────────────────────────────

  describe('replaying the rejection', () => {
    it('refuses to reject an already-approved application twice over', async () => {
      // The provider is ACTIVE by now. `reject` legitimately accepts ACTIVE —
      // a provider approved in error must be stoppable — so this asserts the
      // SECOND rejection is a real, audited transition and not a silent no-op.
      asAdmin();
      await reject(profileId, { reason: 'Approved in error.' }).expect(200);
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('REJECTED');

      // And a third, from REJECTED, is refused: REJECTED is not a legal source.
      expect(codeOf(await reject(profileId).expect(409))).toBe('CONFLICT');
    });
  });
});
