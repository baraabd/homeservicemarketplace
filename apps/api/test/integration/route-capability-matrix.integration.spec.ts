/* eslint-disable @typescript-eslint/no-require-imports --
 * Lazy Prisma require: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { CanActivate, ExecutionContext, INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.8 — every protected provider route family, in every provider
// state, with both enforcement flags ON.
//
// docs/sprint-09b8/ROUTE_CAPABILITY_MATRIX.md
//
// WHAT IS REAL HERE AND WHAT IS NOT
//
// The GUARD is real, the capability service is real, and the provider state it
// reads comes from a real database. The handler SERVICES are stubbed, because
// what they return is not the question — every one of them already has its own
// suite. The question is whether the request reaches them at all.
//
// That split is what makes this table affordable. Wiring the genuine bids,
// bookings, wallet and conversations services would drag half the application
// into a test about authorization, and every unrelated failure in those
// subsystems would surface here as a phantom authorization bug.
//
// WHY IT IS A TABLE
//
// Sprint 9B.8 replaced one guard asking one question everywhere with per-route
// capabilities. The risk that introduces is not that a route is too strict —
// that fails loudly the first time someone uses it — but that a route ends up
// asking for a capability weaker than it should, or that a legacy twin drifts
// from its canonical partner. Only a table catches those: every family, every
// state, the expected answer written down.
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

d('Route/capability matrix (real guard, real Postgres, flags ON)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('route-matrix');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  const CATEGORY = `${P}cat`;

  let lifecycleLock: HeldLock;

  const FLAGS_ON: Record<string, unknown> = {
    WORK_ACCESS_ENFORCED: true,
    VERIFICATION_ENFORCED: true,
  };

  // ── the provider states under test ──────────────────────────────────────
  //
  // Each is a patch onto the base profile row plus whether a live work-access
  // grant exists. They mirror the rows in
  // provider-capability.matrix.spec.ts, which asserts the same states at the
  // resolver; here the same states are asserted at the HTTP boundary, because
  // "the resolver says no" and "the route returns 403" are different claims
  // and only the second one protects anything.
  const STATES = {
    draft: { profile: { status: 'DRAFT', onboardingState: 'DRAFT' }, grant: false },
    submitted: {
      profile: { status: 'PENDING_REVIEW', onboardingState: 'SUBMITTED' },
      grant: false,
    },
    unverified: {
      profile: { status: 'ACTIVE', onboardingState: 'ACCEPTED', verificationState: 'UNVERIFIED' },
      grant: false,
    },
    verifiedNoGrant: {
      profile: { status: 'ACTIVE', onboardingState: 'ACCEPTED', verificationState: 'VERIFIED' },
      grant: false,
    },
    working: {
      profile: { status: 'ACTIVE', onboardingState: 'ACCEPTED', verificationState: 'VERIFIED' },
      grant: true,
    },
    restricted: {
      profile: {
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        verificationState: 'VERIFIED',
        standingState: 'RESTRICTED',
      },
      grant: true,
    },
    suspended: {
      profile: { status: 'SUSPENDED', onboardingState: 'ACCEPTED', verificationState: 'VERIFIED' },
      grant: true,
    },
    terminated: {
      profile: {
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        verificationState: 'VERIFIED',
        standingState: 'TERMINATED',
      },
      grant: true,
    },
  } as const;
  type StateName = keyof typeof STATES;
  const ALL_STATES = Object.keys(STATES) as StateName[];

  // ── the route families ──────────────────────────────────────────────────
  //
  // `allow` lists the states that must reach the handler. Every other state
  // must get 403. Writing the ALLOWED set rather than the denied one is
  // deliberate: adding a state to STATES then defaults it to denied, which is
  // the safe direction for a forgotten update.
  interface Family {
    name: string;
    call: () => request.Test;
    allow: StateName[];
  }

  const FAMILIES = (): Family[] => [
    {
      name: 'feed — GET /me/provider/jobs/available',
      call: () => request(http).get('/v1/me/provider/jobs/available'),
      allow: ['working'],
    },
    {
      name: 'available requests — GET /provider/available-requests',
      call: () => request(http).get('/v1/provider/available-requests'),
      allow: ['working'],
    },
    {
      name: 'bids list — GET /provider/bids',
      call: () => request(http).get('/v1/provider/bids'),
      allow: ['working'],
    },
    {
      name: 'bid submit — POST /provider/bids',
      call: () => request(http).post('/v1/provider/bids').send({}),
      allow: ['working'],
    },
    {
      name: 'bids list (legacy twin) — GET /me/provider/bids',
      call: () => request(http).get('/v1/me/provider/bids'),
      allow: ['working'],
    },
    {
      name: 'bid submit (legacy twin) — POST /me/provider/bids',
      call: () => request(http).post('/v1/me/provider/bids').send({}),
      allow: ['working'],
    },
    {
      name: 'bookings — GET /me/provider/bookings',
      call: () => request(http).get('/v1/me/provider/bookings'),
      allow: ['working', 'restricted'],
    },
    {
      name: 'bookings (canonical twin) — GET /provider/bookings',
      call: () => request(http).get('/v1/provider/bookings'),
      allow: ['working', 'restricted'],
    },
    {
      name: 'earnings — GET /me/provider/earnings',
      call: () => request(http).get('/v1/me/provider/earnings'),
      allow: ['working', 'restricted'],
    },
    {
      name: 'earnings (canonical twin) — GET /provider/earnings/summary',
      call: () => request(http).get('/v1/provider/earnings/summary'),
      allow: ['working', 'restricted'],
    },
    {
      name: 'categories — GET /me/provider/categories/applications',
      call: () => request(http).get('/v1/me/provider/categories/applications'),
      allow: ['draft', 'submitted', 'unverified', 'verifiedNoGrant', 'working', 'restricted'],
    },
    {
      name: 'profile read — GET /me/provider/profile',
      call: () => request(http).get('/v1/me/provider/profile'),
      allow: [
        'draft',
        'submitted',
        'unverified',
        'verifiedNoGrant',
        'working',
        'restricted',
        'suspended',
        'terminated',
      ],
    },
    {
      name: 'profile write — PATCH /me/provider/profile',
      call: () => request(http).patch('/v1/me/provider/profile').send({}),
      allow: ['draft', 'submitted', 'unverified', 'verifiedNoGrant', 'working', 'restricted'],
    },
    {
      name: 'onboarding wizard — GET /me/provider/onboarding/draft',
      call: () => request(http).get('/v1/me/provider/onboarding/draft'),
      allow: ['draft', 'submitted', 'unverified', 'verifiedNoGrant', 'working', 'restricted'],
    },
    {
      name: 'verification case — GET /me/provider/verification/case',
      call: () => request(http).get('/v1/me/provider/verification/case'),
      allow: ['draft', 'submitted', 'unverified', 'verifiedNoGrant', 'working', 'restricted'],
    },
  ];

  /** The row every state starts from, so a previous state cannot leak into
   *  the next one through a field its patch happens not to mention. */
  const BASE_PROFILE = {
    status: 'ACTIVE',
    onboardingState: 'ACCEPTED',
    standingState: 'GOOD',
    verificationState: 'UNVERIFIED',
  } as const;

  async function setState(name: StateName): Promise<void> {
    const s = STATES[name];
    await prisma.providerProfile.update({
      where: { id: PP },
      // Reset to the base row FIRST, then apply the state's patch. Named as a
      // const rather than spread inline because the two objects share keys by
      // design, and TypeScript reports an inline literal doing that as an
      // accidental overwrite.
      data: { ...BASE_PROFILE, ...s.profile },
    });
    await prisma.providerWorkAccessGrant.deleteMany({ where: { providerProfileId: PP } });
    if (s.grant) {
      await prisma.providerWorkAccessGrant.create({
        data: {
          providerProfileId: PP,
          status: 'ACTIVE',
          source: 'VERIFIED_DOCUMENTS',
          reason: 'ROUTE_MATRIX_FIXTURE',
          grantedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.providerWorkAccessGrant.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceCategory.deleteMany({ where: { id: CATEGORY } });
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const {
      ProviderCapabilityService,
    } = require('../../src/modules/provider/capability/provider-capability.service');
    const {
      ProviderCapabilityGuard,
    } = require('../../src/modules/provider/guards/provider-capability.guard');
    const {
      ProviderActiveGuard,
    } = require('../../src/modules/provider/guards/provider-active.guard');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { RolesGuard } = require('../../src/modules/iam/authorization/guards/roles.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    // Controllers under test, and the services whose RESULTS are irrelevant
    // here — only whether the request reaches them.
    const {
      ProviderJobsController,
    } = require('../../src/modules/provider/feed/provider-jobs.controller');
    const {
      ProviderJobsService,
    } = require('../../src/modules/provider/feed/provider-jobs.service');
    const {
      AvailableRequestsController,
    } = require('../../src/modules/provider/available-requests/available-requests.controller');
    const {
      AvailableRequestsService,
    } = require('../../src/modules/provider/available-requests/available-requests.service');
    const bidsMod = require('../../src/modules/provider/bids/provider-bids.controller');
    const {
      ProviderBidsService,
    } = require('../../src/modules/provider/bids/provider-bids.service');
    const {
      ProviderBookingsController,
    } = require('../../src/modules/provider/bookings/provider-bookings.controller');
    const {
      ProviderBookingsCanonicalController,
    } = require('../../src/modules/provider/bookings/provider-bookings-canonical.controller');
    const {
      ProviderBookingsService,
    } = require('../../src/modules/provider/bookings/provider-bookings.service');
    const {
      ProviderWalletController,
    } = require('../../src/modules/provider/wallet/provider-wallet.controller');
    const {
      ProviderWalletService,
    } = require('../../src/modules/provider/wallet/provider-wallet.service');
    const {
      ProviderEarningsController,
    } = require('../../src/modules/provider/wallet/provider-earnings.controller');
    const {
      ProviderEarningsService,
    } = require('../../src/modules/provider/wallet/provider-earnings.service');
    const {
      ProviderCategoriesController,
    } = require('../../src/modules/provider/categories/provider-categories.controller');
    const {
      ProviderCategoriesService,
    } = require('../../src/modules/provider/categories/provider-categories.service');
    const { ProviderController } = require('../../src/modules/provider/provider.controller');
    const { ProviderService } = require('../../src/modules/provider/provider.service');
    const {
      ProviderOnboardingService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding.service');
    const {
      ProviderOnboardingWizardController,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.controller');
    const {
      ProviderOnboardingWizardService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.service');
    const {
      ProviderVerificationCaseController,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.controller');
    const {
      ProviderVerificationCaseService,
    } = require('../../src/modules/provider/verification/case/provider-verification-case.service');
    const {
      VerificationCaseWorkflowService,
    } = require('../../src/modules/provider/verification/case/verification-case-workflow.service');

    const config = { get: (k: string) => FLAGS_ON[k], isProduction: false };
    /** Every stubbed handler returns the same marker, so a 200 means "reached
     *  the handler" and nothing more. */
    const ok = () => ({ reached: true });
    //
    // `then` MUST come back undefined. A Proxy that answers every property
    // returns a function for `then` too, which makes the object look like a
    // thenable — and Nest awaits provider values, so `await stub()` never
    // settles and the whole beforeAll hangs until the suite timeout. Symbols
    // are excluded for the same class of reason: util.inspect and Jest's
    // printer both probe them.
    const stub = (): Record<string, unknown> =>
      new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then' || typeof prop === 'symbol') return undefined;
            return async () => ok();
          },
        },
      ) as Record<string, unknown>;

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ProviderJobsController,
        AvailableRequestsController,
        bidsMod.ProviderBidsController,
        bidsMod.ProviderBidsLegacyController,
        ProviderBookingsController,
        ProviderBookingsCanonicalController,
        ProviderWalletController,
        ProviderEarningsController,
        ProviderCategoriesController,
        ProviderController,
        ProviderOnboardingWizardController,
        ProviderVerificationCaseController,
      ],
      providers: [
        ProviderCapabilityService,
        ProviderCapabilityGuard,
        ProviderActiveGuard,
        Reflector,
        { provide: PrismaService, useValue: { client: prisma, isReady: () => true } },
        { provide: AppConfigService, useValue: config },
        { provide: ProviderJobsService, useValue: stub() },
        { provide: AvailableRequestsService, useValue: stub() },
        { provide: ProviderBidsService, useValue: stub() },
        { provide: ProviderBookingsService, useValue: stub() },
        { provide: ProviderWalletService, useValue: stub() },
        { provide: ProviderEarningsService, useValue: stub() },
        { provide: ProviderCategoriesService, useValue: stub() },
        { provide: ProviderService, useValue: stub() },
        { provide: ProviderOnboardingService, useValue: stub() },
        { provide: ProviderOnboardingWizardService, useValue: stub() },
        { provide: ProviderVerificationCaseService, useValue: stub() },
        { provide: VerificationCaseWorkflowService, useValue: stub() },
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
    await app.init();
    http = app.getHttpServer();

    await cleanupFixtures();
    await prisma.user.create({
      data: {
        id: USER,
        email: `${USER}@rm.test`,
        firstName: 'R',
        lastName: 'M',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        // Rank 0 denies EVERYTHING for an ineligible account, so without this
        // every 403 below would be an account denial and no row would ever
        // reach the rank it claims to test.
        status: 'ACTIVE',
      },
    });
    await prisma.serviceCategory.create({
      data: { id: CATEGORY, slug: CATEGORY, labelEn: 'RM', labelAr: 'RM', icon: 'bolt' },
    });
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: USER,
        displayName: 'Route Matrix Provider Services',
        headline: 'Experienced provider serving the test region',
        bio: 'A sufficiently long biography for the onboarding policy to consider this profile complete.',
        phoneNumber: '+963900000333',
        // A service area no other suite uses: an eligible provider is a
        // shared-world fixture, and geo-fanout counts recipients table-wide.
        serviceAreaCity: 'RouteMatrixTestCity',
        serviceAreaCountry: 'SY',
        serviceAreaRadiusKm: 25,
        initials: 'RM',
        status: 'ACTIVE',
        onboardingState: 'ACCEPTED',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
    currentUser = { id: USER };
  });

  afterAll(async () => {
    await cleanupFixtures();
    await app?.close();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── the table ───────────────────────────────────────────────────────────

  for (const state of ALL_STATES) {
    describe(`provider state: ${state}`, () => {
      beforeAll(async () => {
        await setState(state);
      });

      for (const family of FAMILIES()) {
        const shouldAllow = family.allow.includes(state);
        it(`${shouldAllow ? 'ALLOWS' : 'denies'} ${family.name}`, async () => {
          const res = await family.call();
          if (shouldAllow) {
            expect(res.status).not.toBe(403);
          } else {
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }

  // ── properties over the whole table ─────────────────────────────────────

  describe('properties the table must satisfy', () => {
    it('denies every family to a TERMINATED provider except reading their own profile', async () => {
      await setState('terminated');
      for (const family of FAMILIES()) {
        const res = await family.call();
        const expected = family.name.startsWith('profile read') ? 'allowed' : 'denied';
        expect(res.status === 403 ? 'denied' : 'allowed').toBe(expected);
      }
    });

    it('gates a legacy twin exactly as strictly as its canonical partner', async () => {
      // The specific danger of a compatibility shim: a twin that gates more
      // weakly is not a shim, it is a bypass, and it is the one an attacker
      // finds first. Compared per state rather than asserted once.
      const pairs: Array<[string, string]> = [
        ['bids list — GET /provider/bids', 'bids list (legacy twin) — GET /me/provider/bids'],
        ['bid submit — POST /provider/bids', 'bid submit (legacy twin) — POST /me/provider/bids'],
        [
          'bookings — GET /me/provider/bookings',
          'bookings (canonical twin) — GET /provider/bookings',
        ],
        [
          'earnings — GET /me/provider/earnings',
          'earnings (canonical twin) — GET /provider/earnings/summary',
        ],
      ];

      for (const state of ALL_STATES) {
        await setState(state);
        for (const [aName, bName] of pairs) {
          const families = FAMILIES();
          const a = families.find((f) => f.name === aName);
          const b = families.find((f) => f.name === bName);
          if (!a || !b) throw new Error(`pair not found: ${aName} / ${bName}`);
          const [ra, rb] = [await a.call(), await b.call()];
          expect(`${state}:${ra.status === 403}`).toBe(`${state}:${rb.status === 403}`);
        }
      }
    });

    it('allows a working provider every family — so the denials above mean something', async () => {
      // Non-vacuity for the entire table. If the fixture were broken in a way
      // that denied everything, every "denies" row would pass for the wrong
      // reason and nothing here would notice.
      await setState('working');
      const denied: string[] = [];
      for (const family of FAMILIES()) {
        const res = await family.call();
        if (res.status === 403) denied.push(family.name);
      }
      expect(denied).toEqual([]);
    });
  });
});
