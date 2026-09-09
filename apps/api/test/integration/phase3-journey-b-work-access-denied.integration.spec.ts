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

import {
  ProviderCapability,
  ProviderCapabilityDenialReason,
} from '@homeservicemarketplace/contracts';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// Derived, never written: a literal here is indistinguishable from a real
// key to the CI secret scanner. See test/support/test-secrets.ts.
const SECRET = makeTestSecret('phase3-journey-b');

// Sprint 09B.29 Phase 3, JOURNEY B — submission is not work access.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// Journey A proved that a PENDING specialty no longer deadlocks submission.
// The cheapest way to have "fixed" that would have been to let the provider
// through everywhere, so this journey asserts the other half of the same rule:
// the provider whose moderation is still pending is refused actual work.
//
// WHAT IS REAL, AND WHAT IS NOT — READ THIS BEFORE TRUSTING THE RESULT
//
// REAL, and the whole point of the suite:
//   · `ProviderCapabilityGuard`   — deliberately NOT overridden. The 403 this
//                                   suite asserts is produced by that guard.
//   · `ProviderCapabilityService` — the rank ladder that decides the refusal.
//   · `RolesGuard`                — NOT overridden. The provider genuinely
//                                   holds the `provider` role, assigned by the
//                                   real upgrade endpoint, so the 403 is a
//                                   CAPABILITY refusal and not a role refusal.
//                                   A test below pins that distinction.
//   · `ProviderBidsService`, its repositories, and a REAL `OPEN_FOR_BIDS`
//     service request owned by a different user — so a guard that wrongly
//     allowed would not merely reach a handler, it would successfully create a
//     `Bid` row. That is what makes the bid-count assertions a control rather
//     than a formality.
//   · Postgres and Redis.
//
// NOT REAL:
//   · Token validation. `JwtAuthGuard` is replaced by a stub that throws
//     `UnauthorizedException` when no identity is set — which models what the
//     real guard does for a missing or invalid token, and is why the anonymous
//     case asserts 401. It does NOT prove signature, expiry or cookie
//     handling; `auth-cookies.spec.ts` and
//     `provider-upgrade-session.integration.spec.ts` drive the real guard, and
//     the browser journeys drive real sessions.
//   · CSRF. `CsrfGuard` is passed through: it is not this suite's subject and
//     `auth-cookies.spec.ts` covers it against a real browser.
//
// THE REFUSAL CONTRACT IS DELIBERATELY UNIFORM
//
// `ProviderCapabilityGuard` answers a bare `{ code: 'FORBIDDEN' }` with no
// reason, on purpose, so a caller cannot distinguish "no profile" from "not
// verified" from "grant expired" by probing a protected route. The REASON is
// available to the provider for their own account only, from
// `GET /v1/me/provider/capabilities` — so that is where this suite asserts it.
//
// BOTH ROUTE FAMILIES ARE EXERCISED
//
// `provider-bids.controller.ts` mounts the same handlers twice: canonical
// `/v1/provider/bids` and legacy `/v1/me/provider/bids`. Its own comment calls
// the shim "the one an attacker would find first", because a legacy twin that
// gates more weakly is a bypass rather than a shim. This journey therefore
// asserts the refusal on BOTH families.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string; roles: string[] } | null = null;

/** Models the real `JwtAuthGuard`'s two outcomes: an identity, or a 401. */
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

/** Both route families, as [label, path prefix]. */
const FAMILIES: ReadonlyArray<readonly [string, string]> = [
  ['canonical', ''],
  ['legacy', '/me'],
];

d('Phase 3 Journey B — pending moderation denies work access (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('j3b');
  const USER = `${P}user`;
  /** A second identity that never upgrades: no provider role, no profile.
   *  Exists only to pin WHICH guard produced which refusal. */
  const OUTSIDER = `${P}outsider`;
  const SEEKER = `${P}seeker`;
  const ROOT = `${P}root`;
  const LEAF = `${P}leaf`;
  const REQUEST = `${P}request`;

  let lifecycleLock: HeldLock;
  let serviceRequestsLock: HeldLock;
  let profileId: string;
  /** Every `createForUser` the bid service reached. Must stay empty: it is
   *  written only AFTER the bid row is created, so a non-empty array means a
   *  refused caller executed the handler. */
  const notifiedSeekers: unknown[] = [];

  const anonymous = () => {
    currentUser = null;
  };
  const asProvider = () => {
    currentUser = { id: USER, roles: ['customer', 'provider'] };
  };
  const asOutsider = () => {
    currentUser = { id: OUTSIDER, roles: ['customer'] };
  };

  // The protected provider-work surfaces. `base` is '' for canonical and
  // '/me' for the legacy shim.
  const listWork = (base = '') => request(http).get(`/v1${base}/provider/bids`);
  const createBid = (base = '') =>
    request(http)
      .post(`/v1${base}/provider/bids`)
      // A VALID body against a REAL open request. If the guard let this
      // through, a Bid row would be created and the counts below would catch
      // it — the request cannot fail validation or lookup first.
      .send({
        requestId: REQUEST,
        amount: 25_000,
        pricingType: 'FIXED',
        note: 'I can help today.',
      });
  const withdrawBid = (base = '') =>
    request(http).post(`/v1${base}/provider/bids/${P}nonexistent/withdraw`);
  const capabilities = () => request(http).get('/v1/me/provider/capabilities');

  const upgrade = () => request(http).post('/v1/me/provider/upgrade').send({});
  const patchStep = (step: string, body: Record<string, unknown>) =>
    request(http).patch(`/v1/me/provider/onboarding/steps/${step}`).send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');
  const getReview = () => request(http).get('/v1/me/provider/onboarding/review');
  const postSubmit = (body: Record<string, unknown>) =>
    request(http).post('/v1/me/provider/onboarding/submit').send(body);

  /** The code the error envelope actually carries: `{success,error:{code}}`. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const codeOf = (res: any): unknown => res.body?.error?.code;

  const grantCount = (): Promise<number> =>
    prisma.providerWorkAccessGrant.count({ where: { providerProfileId: profileId } });
  /** NOTE: the Bid column is `providerId`, and it references
   *  `ProviderProfile.id` — not the user id. */
  const bidCount = (): Promise<number> => prisma.bid.count({ where: { providerId: profileId } });

  async function cleanupFixtures(): Promise<void> {
    const rows = (await prisma.providerProfile.findMany({
      where: { userId: { startsWith: P } },
      select: { id: true },
    })) as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);

    await prisma.bid.deleteMany({ where: { providerId: { in: ids } } });
    await prisma.serviceRequestEvent.deleteMany({ where: { requestId: REQUEST } });
    await prisma.serviceRequest.deleteMany({ where: { seekerUserId: { startsWith: P } } });
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

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    // Sprint 09B.29 Phase 3 — SHARED on ServiceRequest, acquired LAST.
    //
    // This journey creates a REAL `OPEN_FOR_BIDS` request, and the marketplace
    // preview is a GLOBAL reader: its query carries no ownership scope, so no
    // fixture namespace can hide this row from it. `marketplace-preview` holds
    // this lock EXCLUSIVE for its whole run and asserts that every open request
    // in the database snaps to ONE cell; one foreign row is one extra cell and
    // it fails on the inscrutable 'Expected 1, Received 2'. That is exactly how
    // it failed when this suite was added without the lock.
    //
    // Shared, so the other request-writing suites still run beside this one and
    // only the global reader excludes them. Last, because the canonical order
    // is providerLifecycle -> outbox -> workAccessGrants -> serviceRequests;
    // two suites taking two locks in opposite orders deadlock.
    serviceRequestsLock = await acquireAdvisoryLock('serviceRequests', 'shared');

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
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      ProviderBidsController,
      ProviderBidsLegacyController,
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

    // Both gates ARMED. With WORK_ACCESS_ENFORCED off, rank 7 falls back to the
    // legacy status column; with VERIFICATION_ENFORCED off, rank 6 does not
    // fire at all. Either way the suite would prove something other than the
    // rule it exists to protect.
    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: SECRET,
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ProviderBidsController,
        ProviderBidsLegacyController,
        ProviderCapabilitiesController,
        ProviderOnboardingWizardController,
        ProviderController,
      ],
      providers: [
        ProviderBidsService,
        ProviderOnboardingWizardService,
        ProviderOnboardingService,
        ProviderService,
        ProviderAvatarService,
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
        // Not a gate and not under test: notifying a seeker does not decide
        // access.
        //
        // THE SHAPE OF THIS STUB IS LOAD-BEARING. `ProviderBidsService.submit`
        // calls `createForUser` INSIDE its transaction, so a stub missing that
        // method throws, the transaction rolls back, and no `Bid` row is ever
        // written — which would make the "created no bid" assertion below pass
        // for the wrong reason and stop it detecting a guard bypass. A
        // mutation run (guard forced to allow) confirmed exactly that: the
        // POST answered 500 instead of 201 and the bid count stayed 0.
        //
        // It records its calls, so "the handler never ran" is asserted
        // directly rather than only inferred from the absence of rows.
        {
          provide: NotificationsService,
          useValue: {
            createForUser: async (input: unknown) => {
              notifiedSeekers.push(input);
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
      // ONLY authentication and CSRF are substituted. RolesGuard and
      // ProviderCapabilityGuard are the real classes — see the header.
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

    // ── preconditions, not operations under test ──────────────────────────
    for (const [id, first] of [
      [USER, 'Samir'],
      [OUTSIDER, 'Rania'],
      [SEEKER, 'Layla'],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@j3b.test`,
          firstName: first,
          lastName: 'Aziz',
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
    // A genuinely biddable request, so the SubmitBid refusal has something
    // real to refuse.
    await prisma.serviceRequest.create({
      data: {
        id: REQUEST,
        seekerUserId: SEEKER,
        categoryId: LEAF,
        description: 'Kitchen circuit keeps tripping.',
        status: 'OPEN_FOR_BIDS',
        scheduleType: 'ASAP',
        addressSnapshot: { label: 'Home', line1: '12 Baghdad St', country: 'SY' },
        locationCityKey: 'journeybcity',
      },
    });

    // ── build the state through canonical operations only ─────────────────
    asProvider();
    await upgrade().expect(200);
    profileId = (await prisma.providerProfile.findFirst({ where: { userId: USER } })).id;

    let v = (await getDraft().expect(200)).body.version as number;
    const step = async (name: string, body: Record<string, unknown>) => {
      const res = await patchStep(name, { ...body, version: v }).expect(200);
      v = res.body.version as number;
    };
    await step('PROVIDER_TYPE', { providerType: 'INDIVIDUAL' });
    await step('IDENTITY', { displayName: 'Samir Aziz', phoneNumber: '+963900000456' });
    await step('LOCATION', {
      serviceAreaCity: 'JourneyBCity',
      serviceAreaCountry: 'SY',
      serviceAreaRadiusKm: 20,
    });
    await step('SPECIALTIES', { specialtyLeafIds: [LEAF], primarySpecialtyId: LEAF });
    await step('EXPERIENCE', { yearsOfExperience: 9, transportModes: ['CAR'] });
    await step('AVAILABILITY', {
      availability: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020 }],
      timezone: 'Asia/Damascus',
    });
    await step('PROFILE', {
      headline: 'Certified electrician available across the city',
      bio: 'Nine years of residential electrical work, including rewiring, fault finding and emergency callouts.',
    });
    const review = await getReview().expect(200);
    await patchStep('CONSENT', {
      acceptedConsentVersion: review.body.terms.version,
      version: review.body.draftVersion,
    }).expect(200);
    const ready = await getReview().expect(200);
    expect(ready.body.canSubmit).toBe(true);
    await postSubmit({ version: ready.body.draftVersion }).expect(200);
  });

  afterAll(async () => {
    currentUser = null;
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await serviceRequestsLock.release();
    await lifecycleLock.release();
  });

  // ── the precondition this journey depends on ─────────────────────────────

  describe('the state under test', () => {
    it('is a submitted application with moderation still pending and no grant', async () => {
      const profile = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(profile.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(profile.status).toBe('PENDING_REVIEW');
      expect(profile.verificationState).not.toBe('VERIFIED');

      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');

      expect(await grantCount()).toBe(0);
      // No granted category either, so nothing could confer access indirectly.
      expect(
        await prisma.providerProfileServiceCategory.count({
          where: { providerProfileId: profileId },
        }),
      ).toBe(0);
    });

    it('holds the provider role genuinely, assigned by the real upgrade', async () => {
      // `RolesGuard` here is REAL, so this must be true for the 403s to be
      // capability refusals. Without it the suite would pass while proving
      // only that a non-provider is refused — a different, weaker claim.
      const roles = await prisma.userRole.findMany({
        where: { userId: USER },
        include: { role: true },
      });
      expect(roles.map((r: { role: { name: string } }) => r.role.name)).toContain('provider');
    });

    it('has a genuinely biddable request for the refusal to act on', async () => {
      const req = await prisma.serviceRequest.findUnique({ where: { id: REQUEST } });
      expect(req.status).toBe('OPEN_FOR_BIDS');
      // Not the provider's own request — that would be refused by the service
      // for an unrelated reason and would hide a guard regression.
      expect(req.seekerUserId).toBe(SEEKER);
      expect(req.seekerUserId).not.toBe(USER);
    });
  });

  // ── 1. anonymous ─────────────────────────────────────────────────────────

  describe('an anonymous caller', () => {
    beforeEach(anonymous);

    it.each(FAMILIES)('is refused 401 on the %s list endpoint', async (_label, base) => {
      const res = await listWork(base).expect(401);
      expect(codeOf(res)).toBe('UNAUTHORIZED');
    });

    it.each(FAMILIES)('is refused 401 on the %s bid endpoint', async (_label, base) => {
      const res = await createBid(base).expect(401);
      expect(codeOf(res)).toBe('UNAUTHORIZED');
    });
  });

  // ── 2. the authenticated, submitted, unapproved provider ─────────────────

  describe('the authenticated provider whose moderation is still pending', () => {
    beforeEach(asProvider);

    it.each(FAMILIES)(
      'is refused ViewMarketplace on the %s route with exactly FORBIDDEN',
      async (_label, base) => {
        const res = await listWork(base).expect(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
      },
    );

    it.each(FAMILIES)(
      'is refused SubmitBid on the %s route with exactly FORBIDDEN',
      async (_label, base) => {
        const res = await createBid(base).expect(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
      },
    );

    it.each(FAMILIES)(
      'is refused withdraw on the %s route before reaching the handler',
      async (_label, base) => {
        // The bid id does not exist. A 404 here would mean the guard let the
        // request through to the service — the distinction matters, because
        // "not found" would leak that the caller got past authorisation.
        const res = await withdrawBid(base).expect(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
      },
    );

    it('leaks no denial reason through the protected route', async () => {
      const res = await listWork().expect(403);
      const body = JSON.stringify(res.body);
      for (const reason of Object.values(ProviderCapabilityDenialReason)) {
        expect(body).not.toContain(reason);
      }
    });

    it('is still AUTHENTICATED — this is not a session problem', async () => {
      // The distinction the whole 401/403 separation exists for, and the one
      // the V2 rule forbids collapsing: the same identity that is refused work
      // reads its own capabilities perfectly well.
      const res = await capabilities().expect(200);
      expect(Array.isArray(res.body.capabilities)).toBe(true);
    });
  });

  // ── 3. the reason, and only on the provider's own endpoint ───────────────

  describe('the denial reason', () => {
    beforeEach(asProvider);

    it('is VERIFICATION_REQUIRED, exactly', async () => {
      // Asserted exactly rather than loosely. Submission moved the provider to
      // `DOCUMENTS_REQUIRED`, which matches none of rank 5's onboarding values
      // — so the ladder falls through to rank 6 and answers
      // VERIFICATION_REQUIRED, NOT the AWAITING_REVIEW that belongs to the
      // `SUBMITTED` lifecycle value this path does not write.
      const res = await capabilities().expect(200);
      expect(res.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });

    it('withholds every work capability and names the same reason on each', async () => {
      const res = await capabilities().expect(200);
      const allowed: string[] = res.body.allowed;
      for (const c of [
        ProviderCapability.ViewMarketplace,
        ProviderCapability.SubmitBid,
        ProviderCapability.ManageBookings,
        ProviderCapability.ViewEarnings,
      ]) {
        expect(allowed).not.toContain(c);
      }

      const decisions: Array<{ capability: string; allowed: boolean; reason?: string }> =
        res.body.capabilities;
      for (const c of [ProviderCapability.ViewMarketplace, ProviderCapability.SubmitBid]) {
        const decision = decisions.find((x) => x.capability === c);
        expect(decision?.allowed).toBe(false);
        expect(decision?.reason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
      }
    });

    it('is not a dead end — the provider keeps what they need to move forward', async () => {
      // THE CONTROL THAT MAKES EVERY 403 ABOVE MEANINGFUL. If the harness were
      // simply refusing everything, this would fail. The guard discriminates:
      // work is shut, self-service is open.
      const res = await capabilities().expect(200);
      const allowed: string[] = res.body.allowed;
      for (const c of [
        ProviderCapability.ViewOwnProfile,
        ProviderCapability.EditOwnProfile,
        ProviderCapability.CompleteOnboarding,
        ProviderCapability.ManageVerification,
      ]) {
        expect(allowed).toContain(c);
      }
      expect(res.body.nextActions.length).toBeGreaterThan(0);
    });
  });

  // ── 4. the 403 is the CAPABILITY guard's, not the role guard's ───────────

  describe('which guard refused', () => {
    it('refuses a user with no provider role, for a demonstrably different reason', async () => {
      // Same 403 envelope, deliberately — but the capabilities endpoint tells
      // the two apart, which is what proves the provider's own 403 came from
      // the capability ladder rather than merely from a missing role.
      asOutsider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');

      const res = await capabilities().expect(200);
      expect(res.body.primaryReason).toBe(ProviderCapabilityDenialReason.NoProviderProfile);
      expect(res.body.allowed).toEqual([]);
    });

    it('gives the role-holding provider a different reason on the same envelope', async () => {
      asProvider();
      expect(codeOf(await listWork().expect(403))).toBe('FORBIDDEN');
      const res = await capabilities().expect(200);
      expect(res.body.primaryReason).toBe(ProviderCapabilityDenialReason.VerificationRequired);
    });
  });

  // ── 5. bounded, deterministic, and free of side effects ──────────────────

  describe('the refusal is bounded and has no side effect', () => {
    it('stays 403 across repeated calls, on both route families', async () => {
      asProvider();
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) {
        for (const [, base] of FAMILIES) {
          codes.push((await listWork(base)).status);
          codes.push((await createBid(base)).status);
        }
      }
      expect(codes).toHaveLength(20);
      // A guard that softened after the first call, or a retry that eventually
      // succeeded, would show up as a mixed set.
      expect(new Set(codes)).toEqual(new Set([403]));
    });

    it('created no bid — the strongest evidence, since the request was biddable', async () => {
      expect(await bidCount()).toBe(0);
      expect(await prisma.bid.count({ where: { requestId: REQUEST } })).toBe(0);
    });

    it('never entered the bid handler at all', async () => {
      // Complements the row count. A row count of zero is also what a handler
      // that ran and then rolled back would leave behind; this distinguishes
      // "refused at the guard" from "attempted and failed", and the two are
      // very different security claims.
      expect(notifiedSeekers).toEqual([]);
    });

    it('created no work-access grant', async () => {
      expect(await grantCount()).toBe(0);
    });

    it('left the moderation application PENDING', async () => {
      const apps = await prisma.providerCategoryApplication.findMany({
        where: { providerProfileId: profileId },
      });
      expect(apps).toHaveLength(1);
      expect(apps[0].status).toBe('PENDING');
    });

    it('left the submission lifecycle exactly where submission put it', async () => {
      const profile = await prisma.providerProfile.findUnique({ where: { id: profileId } });
      expect(profile.onboardingState).toBe('DOCUMENTS_REQUIRED');
      expect(profile.status).toBe('PENDING_REVIEW');
      expect(profile.verified).toBe(false);
    });

    it('touched neither the request nor its timeline', async () => {
      const req = await prisma.serviceRequest.findUnique({ where: { id: REQUEST } });
      expect(req.status).toBe('OPEN_FOR_BIDS');
      expect(await prisma.serviceRequestEvent.count({ where: { requestId: REQUEST } })).toBe(0);
    });

    it('emitted no outbox event and wrote no further audit record', async () => {
      // A BEFORE/AFTER comparison rather than a hard-coded expected set.
      //
      // The property under test is "a refusal adds nothing", and pinning the
      // literal list of events that SUBMISSION writes would test something
      // else entirely — it would fail whenever onboarding legitimately gained
      // an audit event, and it would quietly stop testing this property if
      // someone then updated the literal to match. Snapshotting the rows the
      // setup left behind and re-reading them after a fresh burst of refusals
      // asserts the real invariant and cannot drift.
      const snapshot = async () => ({
        // Scoped to THIS provider's aggregate, not the whole table. The
        // delta is what matters here, and a whole-table count also fails
        // whenever a neighbouring suite legitimately emits an event —
        // Journey C's verification workflow does exactly that.
        outbox: await prisma.outboxEvent.count({ where: { aggregateId: profileId } }),
        audit: (
          (await prisma.auditEvent.findMany({
            where: { userId: USER },
            select: { id: true, type: true },
            orderBy: { id: 'asc' },
          })) as Array<{ id: string; type: string }>
        ).map((r) => `${r.type}:${r.id}`),
      });

      asProvider();
      const before = await snapshot();

      for (const [, base] of FAMILIES) {
        await listWork(base).expect(403);
        await createBid(base).expect(403);
        await withdrawBid(base).expect(403);
      }

      expect(await snapshot()).toEqual(before);
      // And separately: submission never wrote an outbox event either, which
      // Journey A documents. Stated here so a future outbox producer cannot
      // land unnoticed on this path.
      expect(before.outbox).toBe(0);
    });
  });
});
