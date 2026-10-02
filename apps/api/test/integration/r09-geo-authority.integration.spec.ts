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

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// R09 — what the server accepts as a provider's work area, THROUGH THE REAL
// HTTP PATH, against real Postgres.
//
// docs/production-readiness/r09/GEO_AUTHORITY_MATRIX.md
//
// Matching is decided by the provider's point and radius whenever both exist,
// so what may be STORED there is the first half of geographic authority. The
// second half, what matching does with it, is r09-geo-matching.
//
// All coordinates are synthetic. Gated by RUN_DB_INTEGRATION=1.

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

/** Markets this suite adds to the operator registry. Named by nothing else in
 *  the repository, so adding and removing them is invisible to every other
 *  suite (the same discipline as phase5-c2). */
const BOUNDED = 'FI';
const BOUNDED_OTHER = 'PT';
const UNDESCRIBED = 'IS';
const FI_BOUNDS = { south: 59.5, west: 19, north: 70.2, east: 31.6 };
const PT_BOUNDS = { south: 36.8, west: -9.6, north: 42.2, east: -6.1 };

const INSIDE_FI = { serviceAreaLat: 60.17, serviceAreaLng: 24.94 };
const INSIDE_PT = { serviceAreaLat: 38.72, serviceAreaLng: -9.14 };
const FAR_AWAY = { serviceAreaLat: 16.02, serviceAreaLng: 7.03 };

const SUPPORTED_MARKETS_SETTING = 'platform_supported_markets';

d('R09 - work-area geographic authority (real HTTP, real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('r09geo');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  const OTHER_USER = `${P}other-user`;
  const OTHER_PP = `${P}other-pp`;
  let locks: HeldLock | undefined;
  let seededRegistry: unknown;

  const patchLocation = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/LOCATION').send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');

  async function version(pp = PP): Promise<number> {
    const draft = await prisma.providerOnboardingDraft.findUnique({
      where: { providerProfileId: pp },
      select: { version: true },
    });
    return draft.version;
  }
  async function row(pp = PP): Promise<Record<string, unknown>> {
    return prisma.providerProfile.findUnique({ where: { id: pp } });
  }
  const reason = (res: { body: { error?: { details?: { reason?: string } } } }) =>
    res.body.error?.details?.reason;

  async function installMarkets(): Promise<void> {
    const current = await prisma.platformSetting.findUnique({
      where: { key: SUPPORTED_MARKETS_SETTING },
    });
    const others = (current.value as Array<Record<string, unknown>>).filter(
      (m) => ![BOUNDED, BOUNDED_OTHER, UNDESCRIBED].includes(String(m.countryCode)),
    );
    await prisma.platformSetting.update({
      where: { key: SUPPORTED_MARKETS_SETTING },
      data: {
        value: [
          ...others,
          {
            countryCode: BOUNDED,
            enabled: true,
            displayNameKey: `market.${BOUNDED}`,
            defaultTimezone: 'Europe/Helsinki',
            bounds: FI_BOUNDS,
          },
          {
            countryCode: BOUNDED_OTHER,
            enabled: true,
            displayNameKey: `market.${BOUNDED_OTHER}`,
            defaultTimezone: 'Europe/Lisbon',
            bounds: PT_BOUNDS,
          },
          {
            // An operator who has not described where the market is.
            countryCode: UNDESCRIBED,
            enabled: true,
            displayNameKey: `market.${UNDESCRIBED}`,
            defaultTimezone: 'Atlantic/Reykjavik',
          },
        ],
      },
    });
  }

  /** Arrange a profile without going through the wizard, so a test's
   *  arrangement cannot be mistaken for its subject. */
  async function reset(over: Record<string, unknown> = {}, pp = PP): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: pp },
      data: {
        serviceAreaCity: 'Helsinki',
        serviceAreaCityKey: 'helsinki',
        serviceAreaCountryCode: BOUNDED,
        serviceAreaLat: null,
        serviceAreaLng: null,
        serviceAreaRadiusKm: null,
        transportMode: 'CAR',
        headline: 'Certified electrician',
        providerType: 'INDIVIDUAL',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        ...over,
      },
    });
    await prisma.$executeRawUnsafe(
      `UPDATE "ProviderOnboardingDraft" SET "data" = '{}'::jsonb WHERE "providerProfileId" = $1`,
      pp,
    );
  }

  async function cleanupFixtures(): Promise<void> {
    await prisma.auditEvent.deleteMany({ where: { userId: { startsWith: P } } });
    await prisma.providerOnboardingDraft.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfileServiceCategory.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  beforeAll(async () => {
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'marketRegistry' as const, mode: 'exclusive' as const },
    ]);

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
      CURRENT_ONBOARDING_POLICY_VERSION,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.service');
    const {
      MarketRegistryService,
    } = require('../../src/modules/provider/onboarding/market/market-registry.service');
    const {
      SupportedMarketsService,
    } = require('../../src/modules/provider/onboarding/market/supported-markets.service');
    const {
      MARKET_LOCATION_RESOLVER_PORT,
    } = require('../../src/modules/provider/onboarding/market/market-location-resolver.port');
    const {
      UnavailableMarketLocationResolver,
    } = require('../../src/modules/provider/onboarding/market/unavailable-market-location-resolver.adapter');
    const {
      ProviderOnboardingDefaultsService,
    } = require('../../src/modules/provider/onboarding/market/onboarding-defaults.service');
    const {
      ProviderAvatarService,
    } = require('../../src/modules/provider/onboarding/avatar/provider-avatar.service');
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

    const FLAGS: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r09-geo-authority'),
      WORK_ACCESS_ENFORCED: true,
      VERIFICATION_ENFORCED: true,
    };
    const config = { get: (k: string) => FLAGS[k], isProduction: false };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderOnboardingWizardController],
      providers: [
        ProviderOnboardingWizardService,
        MarketRegistryService,
        SupportedMarketsService,
        { provide: MARKET_LOCATION_RESOLVER_PORT, useClass: UnavailableMarketLocationResolver },
        ProviderOnboardingDefaultsService,
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

    const registry = await prisma.platformSetting.findUnique({
      where: { key: SUPPORTED_MARKETS_SETTING },
    });
    if (!registry) {
      throw new Error(
        `The market registry setting "${SUPPORTED_MARKETS_SETTING}" is absent. ` +
          `Run the development seed before this suite.`,
      );
    }
    seededRegistry = registry.value;

    await cleanupFixtures();
    for (const [user, pp, name] of [
      [USER, PP, 'Nour Haddad'],
      [OTHER_USER, OTHER_PP, 'Sami Darwish'],
    ]) {
      await prisma.user.create({
        data: {
          id: user,
          email: `${user}@r09geo.test`,
          firstName: name.split(' ')[0],
          lastName: name.split(' ')[1],
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
      await prisma.providerProfile.create({
        data: {
          id: pp,
          userId: user,
          displayName: name,
          initials: 'R9',
          status: 'DRAFT',
          onboardingState: 'DRAFT',
          standingState: 'GOOD',
          verificationState: 'UNVERIFIED',
        },
      });
      await prisma.providerOnboardingDraft.create({
        data: {
          providerProfileId: pp,
          currentStep: 'LOCATION',
          version: 1,
          data: {},
          policyVersion: CURRENT_ONBOARDING_POLICY_VERSION,
        },
      });
    }
    currentUser = { id: USER };
  });

  afterAll(async () => {
    try {
      try {
        await cleanupFixtures();
      } finally {
        if (seededRegistry !== undefined) {
          await prisma.platformSetting.update({
            where: { key: SUPPORTED_MARKETS_SETTING },
            data: { value: seededRegistry as never },
          });
        }
      }
    } finally {
      try {
        await app?.close();
      } finally {
        try {
          await locks?.release();
        } finally {
          currentUser = null;
          await prisma?.$disconnect();
        }
      }
    }
  });

  beforeEach(async () => {
    currentUser = { id: USER };
    await installMarkets();
    await reset();
    await reset({}, OTHER_PP);
  });

  /** A refused write must leave no trace. */
  async function expectNothingWritten(before: Record<string, unknown>, v: number): Promise<void> {
    const after = await row();
    for (const key of [
      'serviceAreaLat',
      'serviceAreaLng',
      'serviceAreaCity',
      'serviceAreaCityKey',
      'serviceAreaCountryCode',
      'serviceAreaRadiusKm',
    ]) {
      expect([key, after[key]]).toEqual([key, before[key]]);
    }
    expect(await version()).toBe(v);
  }

  describe('a point is two numbers or it is nothing', () => {
    it('stores a latitude and a longitude together, and serves them back', async () => {
      const res = await patchLocation({ version: await version(), ...INSIDE_FI });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject(INSIDE_FI);
      expect(await row()).toMatchObject(INSIDE_FI);
      // What a reload reads.
      expect((await getDraft()).body.data).toMatchObject(INSIDE_FI);
    });

    it.each([
      ['a latitude alone', { serviceAreaLat: 60.17 }],
      ['a longitude alone', { serviceAreaLng: 24.94 }],
      ['a latitude with a null longitude', { serviceAreaLat: 60.17, serviceAreaLng: null }],
    ])('REFUSES %s when no point is stored', async (_label, body) => {
      const before = await row();
      const v = await version();
      const res = await patchLocation({ version: v, ...body });
      expect(res.status).toBe(400);
      expect(reason(res)).toBe('COORDINATES_INCOMPLETE');
      await expectNothingWritten(before, v);
    });

    it('REFUSES clearing half of a stored point', async () => {
      await reset(INSIDE_FI);
      const before = await row();
      const v = await version();
      const res = await patchLocation({ version: v, serviceAreaLat: null });
      expect(res.status).toBe(400);
      expect(reason(res)).toBe('COORDINATES_INCOMPLETE');
      await expectNothingWritten(before, v);
    });

    it('lets one coordinate move when the other is already stored', async () => {
      await reset(INSIDE_FI);
      const res = await patchLocation({ version: await version(), serviceAreaLat: 61 });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ serviceAreaLat: 61, serviceAreaLng: 24.94 });
    });

    it('clears the point as a pair, and leaves the city and the radius alone', async () => {
      await reset({ ...INSIDE_FI, serviceAreaRadiusKm: 20 });
      const res = await patchLocation({
        version: await version(),
        serviceAreaLat: null,
        serviceAreaLng: null,
      });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({
        serviceAreaLat: null,
        serviceAreaLng: null,
        serviceAreaCity: 'Helsinki',
        serviceAreaCityKey: 'helsinki',
        serviceAreaRadiusKm: 20,
      });
    });

    it.each([
      ['a latitude above 90', { serviceAreaLat: 90.01, serviceAreaLng: 24 }],
      ['a latitude below -90', { serviceAreaLat: -90.01, serviceAreaLng: 24 }],
      ['a longitude above 180', { serviceAreaLat: 60, serviceAreaLng: 180.01 }],
      ['a longitude below -180', { serviceAreaLat: 60, serviceAreaLng: -180.01 }],
      ['a latitude that is not a number', { serviceAreaLat: 'NaN', serviceAreaLng: 24 }],
      ['an infinite longitude', { serviceAreaLat: 60, serviceAreaLng: 'Infinity' }],
      ['words', { serviceAreaLat: 'north', serviceAreaLng: 'east' }],
    ])('REFUSES %s', async (_label, body) => {
      const before = await row();
      const v = await version();
      const res = await patchLocation({ version: v, ...body });
      expect(res.status).toBe(400);
      await expectNothingWritten(before, v);
    });
  });

  describe('a point must be in the market the provider chose', () => {
    it.each([
      ['well inside', INSIDE_FI],
      ['on the southern edge', { serviceAreaLat: FI_BOUNDS.south, serviceAreaLng: 24 }],
      [
        'on the north-east corner',
        { serviceAreaLat: FI_BOUNDS.north, serviceAreaLng: FI_BOUNDS.east },
      ],
    ])('accepts a point %s', async (_label, point) => {
      const res = await patchLocation({ version: await version(), ...point });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject(point);
    });

    it.each([
      ['just south of the edge', { serviceAreaLat: FI_BOUNDS.south - 0.01, serviceAreaLng: 24 }],
      ['just east of the edge', { serviceAreaLat: 62, serviceAreaLng: FI_BOUNDS.east + 0.01 }],
      ['in another supported market', INSIDE_PT],
      ['on another continent', FAR_AWAY],
    ])('REFUSES a point %s, and writes nothing', async (_label, point) => {
      const before = await row();
      const v = await version();
      const res = await patchLocation({ version: v, serviceAreaCity: 'Elsewhere', ...point });
      expect(res.status).toBe(400);
      expect(reason(res)).toBe('POINT_OUTSIDE_MARKET');
      // Not even the city that travelled in the same request.
      await expectNothingWritten(before, v);
    });

    it('judges a point against the market chosen IN THE SAME WRITE', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: BOUNDED_OTHER,
        ...INSIDE_PT,
      });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ serviceAreaCountryCode: BOUNDED_OTHER, ...INSIDE_PT });

      // ...and not against the one being left.
      const back = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: BOUNDED,
        ...INSIDE_PT,
      });
      expect(back.status).toBe(400);
      expect(reason(back)).toBe('POINT_OUTSIDE_MARKET');
      expect(await row()).toMatchObject({ serviceAreaCountryCode: BOUNDED_OTHER, ...INSIDE_PT });
    });

    it('cannot judge a point in a market the operator has not described, and says so by accepting it', async () => {
      await reset({ serviceAreaCountryCode: UNDESCRIBED });
      const res = await patchLocation({ version: await version(), ...FAR_AWAY });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject(FAR_AWAY);
    });

    it('accepts a point before any market is chosen', async () => {
      await reset({ serviceAreaCountryCode: null });
      const res = await patchLocation({ version: await version(), ...FAR_AWAY });
      expect(res.status).toBe(200);
    });

    it('serves the market envelope the picker and the map explain themselves with', async () => {
      const markets = await request(http).get('/v1/me/provider/onboarding/markets');
      expect(markets.status).toBe(200);
      const byCode = new Map(
        (markets.body.markets as Array<{ countryCode: string; bounds?: unknown }>).map((m) => [
          m.countryCode,
          m,
        ]),
      );
      expect(byCode.get(BOUNDED)?.bounds).toEqual(FI_BOUNDS);
      expect(byCode.get(UNDESCRIBED)).not.toHaveProperty('bounds');
    });
  });

  describe('changing market does not leave the old point in force', () => {
    it('CLEARS a stored point that is not in the new market, and keeps the rest', async () => {
      await reset(INSIDE_FI);
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: BOUNDED_OTHER,
      });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        serviceAreaCountryCode: BOUNDED_OTHER,
        serviceAreaLat: null,
        serviceAreaLng: null,
        serviceAreaCity: 'Helsinki',
      });
      expect(await row()).toMatchObject({
        serviceAreaCountryCode: BOUNDED_OTHER,
        serviceAreaLat: null,
        serviceAreaLng: null,
      });
    });

    it('keeps a stored point when the new market cannot judge it', async () => {
      await reset(INSIDE_FI);
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: UNDESCRIBED,
      });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({ serviceAreaCountryCode: UNDESCRIBED, ...INSIDE_FI });
    });

    it('keeps the point when the same market is sent again', async () => {
      await reset(INSIDE_FI);
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: BOUNDED,
      });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject(INSIDE_FI);
    });

    it('does not touch the point on a city edit', async () => {
      await reset(INSIDE_FI);
      const res = await patchLocation({ version: await version(), serviceAreaCity: '  Espoo ' });
      expect(res.status).toBe(200);
      expect(await row()).toMatchObject({
        ...INSIDE_FI,
        serviceAreaCity: 'Espoo',
        serviceAreaCityKey: 'espoo',
      });
    });
  });

  describe('the radius is bounded by the operator policy the server serves', () => {
    async function policy(): Promise<{ minKm: number; maxKm: number; suggestedKm: number }> {
      return (await getDraft()).body.data.radiusPolicy;
    }

    it('accepts the minimum, the maximum and a value between; refuses one beyond either', async () => {
      const { minKm, maxKm } = await policy();
      expect(minKm).toBeGreaterThanOrEqual(1);
      expect(maxKm).toBeGreaterThan(minKm);

      for (const km of [minKm, Math.floor((minKm + maxKm) / 2), maxKm]) {
        const ok = await patchLocation({ version: await version(), serviceAreaRadiusKm: km });
        expect([km, ok.status]).toEqual([km, 200]);
        expect((await row()).serviceAreaRadiusKm).toBe(km);
      }

      const above = await patchLocation({
        version: await version(),
        serviceAreaRadiusKm: maxKm + 1,
      });
      expect(above.status).toBe(400);
      expect(reason(above)).toBe('ABOVE_MAX');

      const below = await patchLocation({
        version: await version(),
        serviceAreaRadiusKm: minKm - 1,
      });
      expect(below.status).toBe(400);
      // Stored value is still the last accepted one: refused, not clamped.
      expect((await row()).serviceAreaRadiusKm).toBe(maxKm);
    });

    it('refuses a fractional or non-numeric radius', async () => {
      for (const km of [10.5, 'ten', -5]) {
        const res = await patchLocation({ version: await version(), serviceAreaRadiusKm: km });
        expect([km, res.status]).toEqual([km, 400]);
      }
      expect((await row()).serviceAreaRadiusKm).not.toBe(10.5);
    });
  });

  describe('concurrency and isolation', () => {
    it('refuses a stale work-area write and stores nothing from it', async () => {
      const stale = await version();
      const first = await patchLocation({ version: stale, ...INSIDE_FI });
      expect(first.status).toBe(200);
      const before = await row();

      const second = await patchLocation({
        version: stale,
        serviceAreaLat: 61,
        serviceAreaLng: 25,
        serviceAreaCity: 'Tampere',
      });
      expect(second.status).toBe(409);
      expect(second.body.error.details).toMatchObject({
        expectedVersion: stale + 1,
        receivedVersion: stale,
      });
      await expectNothingWritten(before, stale + 1);
    });

    it("writes only the caller's own profile", async () => {
      await reset(INSIDE_FI);
      const mine = await row();
      const myVersion = await version();

      currentUser = { id: OTHER_USER };
      const theirs = await patchLocation({
        // The other provider's version number is no key to this profile.
        version: await version(OTHER_PP),
        serviceAreaCity: 'Turku',
        serviceAreaLat: 60.45,
        serviceAreaLng: 22.27,
        serviceAreaRadiusKm: 7,
      });
      expect(theirs.status).toBe(200);
      // The other provider's own draft carries their values, not mine.
      expect((await getDraft()).body.data).toMatchObject({
        serviceAreaCity: 'Turku',
        serviceAreaLat: 60.45,
        serviceAreaLng: 22.27,
      });

      currentUser = { id: USER };
      await expectNothingWritten(mine, myVersion);
      expect((await getDraft()).body.data).toMatchObject(INSIDE_FI);
    });
  });
});
