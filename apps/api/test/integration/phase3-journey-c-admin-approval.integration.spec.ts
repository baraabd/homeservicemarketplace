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

import { ProviderCapabilityDenialReason } from '@homeservicemarketplace/contracts';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-journey-c-approval');

// Sprint 09B.29 Phase 3, JOURNEY C — the canonical admin approval.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// Journey A proved submission opens with a specialty still in moderation.
// Journey B proved that submission does NOT open work. C is the decision that
// sits between them: it exercises the one canonical endpoint an operator uses,
// `POST /v1/admin/providers/:providerProfileId/approve`, and pins what that
// decision does — and, just as importantly, what it does NOT do.
//
// WHAT IS REAL, AND WHAT IS NOT
//
// REAL:
//   · `AdminVerificationService.transition` — the conditional UPDATE, the
//     audit write and the notification, all inside one transaction.
//   · `RolesGuard` — NOT overridden, so the admin-only refusals below are
//     produced by the real guard.
//   · `ProviderCapabilityGuard` / `ProviderCapabilityService` — still real, so
//     the "did approval open the marketplace?" assertions are answered by the
//     production ladder rather than by this file's opinion.
//   · `SecurityEventsBus` — the real in-process bus, with a recording handler
//     subscribed, so the post-commit fan-out is observed rather than mocked.
//   · Postgres and Redis.
//
// NOT REAL:
//   · Token validation (`JwtAuthGuard` → `StubJwtGuard`) and CSRF
//     (`CsrfGuard` → `PassGuard`), exactly as in Journey B.
//   · THE ADMIN'S ROLE CLAIM. `RolesGuard` reads `user.roles` off the request,
//     and this suite's stub supplies them. The provider's `provider` role in
//     Journey B could be traced to a real upgrade endpoint that assigns it;
//     there is no in-scope canonical operation that makes someone an admin, so
//     the `admin` claim here is asserted by the harness, not earned. What the
//     suite therefore proves is that the endpoint REQUIRES the admin role and
//     refuses without it — not how that role is granted.
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

interface StatusChangedEvent {
  userId: string | null;
  providerProfileId: string;
  status: string;
}

d('Phase 3 Journey C — canonical admin approval (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3c');
  /** The provider who gets approved. */
  const USER = `${P}user`;
  /** A second, identically built provider. Two independent candidates are what
   *  make the ownership-isolation and concurrency cases honest: the race needs
   *  a fresh PENDING_REVIEW subject that was never reached by a direct write. */
  const USER2 = `${P}user2`;
  const ADMIN = `${P}admin`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;

  let lifecycleLock: HeldLock;
  let profileId: string;
  let profileId2: string;
  const statusEvents: StatusChangedEvent[] = [];
  /** Notifications the service asked for, in order. */
  const notifications: Array<{ userId: string; title: string }> = [];

  const anonymous = () => {
    currentUser = null;
  };
  const asAdmin = () => {
    currentUser = { id: ADMIN, roles: ['admin'] };
  };
  const asProvider = (id = USER) => {
    currentUser = { id, roles: ['customer', 'provider'] };
  };

  // ── the canonical admin surface ───────────────────────────────────────────
  const approve = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/approve`).send(body);
  const suspend = (id: string, body: Record<string, unknown> = {}) =>
    request(http).post(`/v1/admin/providers/${id}/suspend`).send(body);
  const adminDetail = (id: string) => request(http).get(`/v1/admin/providers/${id}`);

  // ── the provider-facing surfaces the decision is supposed to move ─────────
  const listWork = () => request(http).get('/v1/provider/bids');
  const capabilities = () => request(http).get('/v1/me/provider/capabilities');

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeOf = (res: any): unknown => res.body?.error?.code;

  /** Approval audits that name this profile. The audit row's `userId` is the
   *  ADMIN who acted, so the SUBJECT has to be read out of the metadata —
   *  filtering on `userId` would silently match nothing and make every
   *  "exactly one audit row" assertion below vacuous. */
  async function approvalAuditsFor(
    id: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<Array<{ id: string; userId: string | null; metadata: any }>> {
    const all = (await prisma.auditEvent.findMany({
      where: { type: 'ADMIN_PROVIDER_APPROVED' },
      orderBy: { createdAt: 'asc' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as Array<{ id: string; userId: string | null; metadata: any }>;
    return all.filter((r) => r.metadata?.providerProfileId === id);
  }

  const grantCount = (id: string): Promise<number> =>
    prisma.providerWorkAccessGrant.count({ where: { providerProfileId: id } });

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

  /** Drive one candidate from nothing to PENDING_REVIEW through canonical
   *  operations only, and return their profile id. */
  async function buildSubmittedProvider(userId: string, displayName: string): Promise<string> {
    asProvider(userId);
    await upgrade().expect(200);
    const id = (await prisma.providerProfile.findFirst({ where: { userId } })).id as string;

    let v = (await getDraft().expect(200)).body.version as number;
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName, phoneNumber: '+963900000789' });
    await step('LOCATION', {
      serviceAreaCity: 'JourneyCCity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 20,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 7, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: 'Experienced electrician for homes and small businesses',
      bio: 'Seven years of residential and light commercial electrical work, from fault finding to full rewires.',
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
    const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ServiceRequestEventRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
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
      ProviderBidsController,
    } = require('../../src/modules/provider/bids/provider-bids.controller');
    const {
      ProviderBidsService,
    } = require('../../src/modules/provider/bids/provider-bids.service');
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
    const { AppConfigService } = require('../../src/config/app-config.service');
    const { STORAGE_PORT } = require('../../src/infrastructure/storage/storage.port');

    // Both gates ARMED, as in Journey B — otherwise "did approval open work
    // access?" would be answered by a legacy fallback rather than by the rule
    // this sprint is shipping.
    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        AdminVerificationController,
        ProviderBidsController,
        ProviderCapabilitiesController,
        ProviderOnboardingWizardController,
        ProviderController,
      ],
      providers: [
        AdminVerificationService,
        AdminVerificationCaseService,
        AdminAuditService,
        SecurityEventsBus,
        ProviderBidsService,
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
        PublicMediaLedgerService,
        ProviderServiceAreaExpansionService,
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderProfileRepository,
        BidRepository,
        ServiceRequestRepository,
        ServiceRequestEventRepository,
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
        // The REAL notifications service would need a transport; what matters
        // here is that approval notifies the provider exactly once, so the
        // stub records rather than sends. See Journey B for why the method
        // name is load-bearing: `transition` calls `createForUser` inside its
        // transaction, and a stub missing it would roll the approval back.
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

    // The real bus, observed. Subscribing a recorder is how the post-commit
    // fan-out gets asserted without replacing the thing that performs it.
    moduleRef
      .get(SecurityEventsBus)
      .onProviderStatusChanged((e: StatusChangedEvent) => statusEvents.push(e));

    await cleanupFixtures();

    for (const [id, first] of [
      [USER, 'Karim'],
      [USER2, 'Yara'],
      [ADMIN, 'Operator'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3c.test`,
          firstName: first,
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

    profileId = await buildSubmittedProvider(USER, 'Karim Haddad');
    profileId2 = await buildSubmittedProvider(USER2, 'Yara Haddad');
  });

  afterAll(async () => {
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── 1. only an admin may decide ──────────────────────────────────────────

  describe('who may approve', () => {
    it('refuses an anonymous caller with 401', async () => {
      anonymous();
      expect(codeOf(await approve(profileId).expect(401))).toBe('UNAUTHORIZED');
    });

    it('refuses the provider approving themselves with 403', async () => {
      // The single most valuable negative case on this endpoint.
      asProvider(USER);
      expect(codeOf(await approve(profileId).expect(403))).toBe('FORBIDDEN');
    });

    it('refuses one provider approving another with 403', async () => {
      asProvider(USER2);
      expect(codeOf(await approve(profileId).expect(403))).toBe('FORBIDDEN');
    });

    it('left both candidates untouched after those refusals', async () => {
      for (const id of [profileId, profileId2]) {
        const p = await prisma.providerProfile.findUnique({ where: { id } });
        expect(p.status).toBe('PENDING_REVIEW');
        expect(p.reviewedByUserId).toBeNull();
      }
      expect(await approvalAuditsFor(profileId)).toHaveLength(0);
      expect(statusEvents).toEqual([]);
    });

    it('answers 404 for a profile that does not exist', async () => {
      asAdmin();
      expect(codeOf(await approve(`${P}ghost`).expect(404))).toBe('NOT_FOUND');
    });
  });

  // ── 2. the decision itself ───────────────────────────────────────────────

  describe('the approval', () => {
    it('succeeds for a submitted application', async () => {
      asAdmin();
      const res = await approve(profileId, { note: 'Documents check out.' }).expect(200);
      expect(res.body.provider.status).toBe('ACTIVE');
    });

    it('moved the profile to ACTIVE and recorded who decided it', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('ACTIVE');
      expect(p.reviewedByUserId).toBe(ADMIN);
      expect(p.reviewedAt).toBeInstanceOf(Date);
      // Approval must clear any stale rejection reason, or an approved
      // provider is shown why they were turned down.
      expect(p.rejectionReason).toBeNull();
    });

    it('wrote exactly one audit row, naming both parties and both states', async () => {
      const audits = await approvalAuditsFor(profileId);
      expect(audits).toHaveLength(1);
      expect(audits[0].userId).toBe(ADMIN);
      expect(audits[0].metadata).toMatchObject({
        providerProfileId: profileId,
        targetUserId: USER,
        previousStatus: 'PENDING_REVIEW',
        newStatus: 'ACTIVE',
        note: 'Documents check out.',
      });
    });

    it('notified the provider exactly once', async () => {
      const mine = notifications.filter((n) => n.userId === USER);
      expect(mine).toHaveLength(1);
    });

    it('published the status change on the real bus, post-commit', async () => {
      expect(statusEvents).toEqual([
        { userId: USER, providerProfileId: profileId, status: 'ACTIVE' },
      ]);
    });

    it('did not touch the other candidate', async () => {
      // Ownership isolation: one decision moves one provider.
      const other = await prisma.providerProfile.findUnique({ where: { id: profileId2 } });
      expect(other.status).toBe('PENDING_REVIEW');
      expect(other.reviewedByUserId).toBeNull();
      expect(await approvalAuditsFor(profileId2)).toHaveLength(0);
    });
  });

  // ── 3. approval is not moderation, and not verification ──────────────────

  describe('what approval deliberately does NOT do', () => {
    it('left the specialty application PENDING — approval is not moderation', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');
      // And no category was silently granted.
      expect(
        await prisma.providerProfileServiceCategory.count({
          where: { providerProfileId: profileId },
        }),
      ).toBe(0);
    });

    it('issued no work-access grant and set no verified flag', async () => {
      // `decideIfInStatus` writes status, reviewedAt, reviewedByUserId and
      // rejectionReason — and nothing else. It does not touch
      // `verificationState`, `onboardingState`, or the grant table.
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(await grantCount(profileId)).toBe(0);
      expect(p.verificationState).not.toBe('VERIFIED');
      expect(p.verified).toBe(false);
    });

    it('does NOT by itself open the marketplace while both gates are armed', async () => {
      // THE FINDING THIS JOURNEY EXISTS TO PIN.
      //
      // With WORK_ACCESS_ENFORCED and VERIFICATION_ENFORCED both on, the
      // capability ladder reaches rank 6 and stops: the provider is ACTIVE but
      // still not VERIFIED, so work stays shut. Legacy `status = ACTIVE` is no
      // longer sufficient on its own, which is exactly the axis separation
      // ADR 0005 asks for — approval, verification and work access are three
      // different decisions, and this endpoint makes only the first.
      //
      // Asserted rather than assumed, because the opposite result would mean
      // arming the flags had silently changed what an operator's approval
      // does.
      asProvider(USER);
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');

      const caps = await capabilities().expect(200);
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });
  });

  // ── 4. repeating the decision ────────────────────────────────────────────

  describe('a repeated approval', () => {
    it('answers 409, not a second success', async () => {
      asAdmin();
      const res = await approve(profileId).expect(409);
      expect(codeOf(res)).toBe('CONFLICT');
    });

    it('added no second audit row, no second notification, no second event', async () => {
      // The invariant a double-clicking operator depends on: the conditional
      // UPDATE matches nothing the second time, so the whole transaction —
      // audit and notification included — never happens.
      expect(await approvalAuditsFor(profileId)).toHaveLength(1);
      expect(notifications.filter((n) => n.userId === USER)).toHaveLength(1);
      expect(statusEvents.filter((e) => e.providerProfileId === profileId)).toHaveLength(1);
    });

    it('left the provider ACTIVE', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(p.status).toBe('ACTIVE');
    });
  });

  // ── 5. two reviewers at once ─────────────────────────────────────────────

  describe('concurrent approvals of the same application', () => {
    it('lets exactly one win', async () => {
      // Prisma's interactive transactions run at READ COMMITTED, so both
      // reviewers can read PENDING_REVIEW. The guarantee comes from the
      // UPDATE being scoped to the legal source statuses, not from the read.
      asAdmin();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => approve(profileId2).then((r) => r.status)),
      );
      expect(results.filter((s) => s === 200)).toHaveLength(1);
      expect(results.filter((s) => s === 409)).toHaveLength(5);
      // No third outcome: a 500 here would mean the race surfaced as a crash.
      expect(new Set(results)).toEqual(new Set([200, 409]));
    });

    it('produced exactly one audit row and one notification', async () => {
      expect(await approvalAuditsFor(profileId2)).toHaveLength(1);
      expect(notifications.filter((n) => n.userId === USER2)).toHaveLength(1);
      expect(statusEvents.filter((e) => e.providerProfileId === profileId2)).toHaveLength(1);
    });

    it('moved the provider exactly once', async () => {
      const p = await prisma.providerProfile.findUnique({ where: { id: profileId2 } });
      expect(p.status).toBe('ACTIVE');
    });
  });

  // ── 6. suspension outranks approval ──────────────────────────────────────

  describe('suspension after approval', () => {
    it('succeeds against an ACTIVE provider', async () => {
      asAdmin();
      const res = await suspend(profileId, { reason: 'Under investigation.' }).expect(200);
      expect(res.body.provider.status).toBe('SUSPENDED');
    });

    it('overrides everything the approval granted', async () => {
      asProvider(USER);
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      const caps = await capabilities().expect(200);
      // Rank 3 outranks the verification and work-access ranks, so the reason
      // CHANGES — proof the ladder is re-evaluated rather than cached.
      expect(caps.body.primaryReason).toBe(ProviderCapabilityDenialReason.ProviderSuspended);
      // A suspended provider keeps exactly one thing: the ability to appeal.
      expect(caps.body.allowed).toContain('APPEAL_DECISION');
      expect(caps.body.allowed).not.toContain('SUBMIT_BID');
    });

    it('is visible to the operator on the canonical detail endpoint', async () => {
      asAdmin();
      // NOTE the shape difference, which is real and not a typo here: the
      // mutation endpoints answer `{ provider: … }` (AdminProviderMutation-
      // Response) while `GET :id` answers the AdminProviderSummary directly.
      const res = await adminDetail(profileId).expect(200);
      expect(res.body.status).toBe('SUSPENDED');
      expect(res.body.id).toBe(profileId);
    });

    it('cannot be approved again from SUSPENDED', async () => {
      // `approve` accepts PENDING_REVIEW only. Reinstating a suspended
      // provider is `reactivate`, a distinct verb with its own audit trail —
      // so that "was approved for the first time" stays distinguishable from
      // "had a suspension lifted".
      asAdmin();
      expect(codeOf(await approve(profileId).expect(409))).toBe('CONFLICT');
    });
  });
});
