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

// Sprint 09B.29 Phase 5 (C2) — the enabled-market boundary and radius
// provenance, THROUGH THE REAL HTTP PATH, against real Postgres.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md
//
// WHY THIS SUITE EXISTS SEPARATELY FROM THE C1 DEFAULTS SUITE
//
// The C1 suite calls ProviderOnboardingDefaultsService directly. That proves
// the service does what it says; it proves NOTHING about whether the wizard
// calls it. The clearing of derived provenance on an explicit provider edit is
// exactly that kind of claim: the service had the method and passed its own
// test while the write path never invoked it, so a provider who typed the same
// number the server suggested kept a stamp saying the server owned it.
//
// So every assertion here goes through supertest and the real controller, with
// the real validation pipe, the real DTO, the real service and a real
// database. The only doubles are the authentication guards.
//
// WHAT IS DELIBERATELY NOT MOCKED
//
//   the market registry   read from the seeded PlatformSetting row, because
//                         "an operator disabled a market" is a statement about
//                         that row and a stub would assert the stub
//   Postgres              every claim below is about a conditional write, a
//                         transaction boundary, or a JSON merge
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

/** ISO 3166-1 alpha-2 codes this suite may add to or remove from the operator
 *  registry.
 *
 *  NOT SY, SE or SA. Those three are what the development seed enables and
 *  what every other integration harness patches LOCATION with; disabling one
 *  here would fail an unrelated suite running in another worker. NO and DK are
 *  named by nothing else in the repository, so adding and removing them is
 *  invisible to every concurrent reader. */
const MINE_ENABLED = 'NO';
const MINE_DISABLED = 'DK';

/** A real ISO country that the registry does not mention at all. Distinct from
 *  MINE_DISABLED: "never configured" and "configured and switched off" are
 *  different operator states and both must be refused. */
const UNCONFIGURED = 'FR';

/** A market spanning several zones, declaring them and NO default.
 *
 *  The seeded SY/SE/SA are all single-zone, so without this the "a market with
 *  more than one zone must ASK rather than guess" rule would have no market to
 *  be true of. AU is named by nothing else in the repository. */
const MINE_MULTI = 'AU';
const MULTI_ZONES = ['Australia/Sydney', 'Australia/Perth'];

const SUPPORTED_MARKETS_SETTING = 'platform_supported_markets';

d('Phase 5 C2 - enabled markets and radius provenance (real HTTP, real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('p5c2');
  const USER = `${P}user`;
  const PP = `${P}pp`;

  let lifecycleLock: HeldLock;
  let registryLock: HeldLock;

  /** The registry exactly as the seed left it, restored in afterAll. */
  let seededRegistry: unknown;

  const patchLocation = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/LOCATION').send(body);
  const getMarkets = () => request(http).get('/v1/me/provider/onboarding/markets');

  /** The draft version to send with the next write.
   *
   *  Read from the row rather than from GET /draft on purpose: that endpoint
   *  applies the V2 defaults, so using it to fetch a version would perform the
   *  very derivation several tests below are trying to observe. */
  async function version(): Promise<number> {
    const draft = await prisma.providerOnboardingDraft.findUnique({
      where: { providerProfileId: PP },
      select: { version: true },
    });
    return draft.version;
  }

  async function profile(): Promise<Record<string, unknown>> {
    return prisma.providerProfile.findUnique({ where: { id: PP } });
  }

  interface Stamp {
    countryCode: string | null;
    basedOn: string | null;
    policyVersion: string | null;
    km: number;
    at: string;
  }

  /** The server-owned provenance stamp, or undefined when there is none. */
  async function radiusStamp(): Promise<Stamp | undefined> {
    const draft = await prisma.providerOnboardingDraft.findUnique({
      where: { providerProfileId: PP },
      select: { data: true },
    });
    const data = (draft?.data ?? {}) as Record<string, unknown>;
    return data.v2DerivedRadius as Stamp | undefined;
  }

  /** Rewrite the operator registry, leaving the seeded markets untouched. */
  async function setMineEnabled(enabled: boolean): Promise<void> {
    const row = await prisma.platformSetting.findUnique({
      where: { key: SUPPORTED_MARKETS_SETTING },
    });
    const seeded = (row.value as Array<Record<string, unknown>>).filter(
      (m) =>
        m.countryCode !== MINE_ENABLED &&
        m.countryCode !== MINE_DISABLED &&
        m.countryCode !== MINE_MULTI,
    );
    await prisma.platformSetting.update({
      where: { key: SUPPORTED_MARKETS_SETTING },
      data: {
        value: [
          ...seeded,
          {
            countryCode: MINE_ENABLED,
            enabled,
            displayNameKey: `market.${MINE_ENABLED}`,
            defaultTimezone: 'Europe/Oslo',
          },
          {
            countryCode: MINE_DISABLED,
            enabled: false,
            displayNameKey: `market.${MINE_DISABLED}`,
            defaultTimezone: 'Europe/Copenhagen',
          },
          {
            countryCode: MINE_MULTI,
            enabled: true,
            displayNameKey: `market.${MINE_MULTI}`,
            // No defaultTimezone ON PURPOSE: a default is indistinguishable
            // from an answer, and this market has no single answer.
            timezones: MULTI_ZONES,
          },
        ],
      },
    });
  }

  /** Put the profile in a known state without going through the wizard, so a
   *  test's arrangement cannot be mistaken for its subject. */
  async function reset(over: Record<string, unknown> = {}): Promise<void> {
    await prisma.providerProfile.update({
      where: { id: PP },
      data: {
        serviceAreaCity: 'Aleppo',
        serviceAreaCountryCode: null,
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
      PP,
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
    // SHARED on the lifecycle table, EXCLUSIVE on the registry, in the
    // canonical order. See test/support/db-isolation.ts for why the registry
    // needs a lock a fixture namespace cannot replace.
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');
    registryLock = await acquireAdvisoryLock('marketRegistry', 'exclusive');

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
    // The SAME adapter production binds. No geocoder is configured, and the
    // deterministic fake must be unreachable from an application module - a
    // test that quietly bound the fake here would be asserting a topology the
    // shipped server does not have.
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
      JWT_ACCESS_SECRET: 'p5c2-test-secret',
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
    // The same pipe main.ts installs. Without it the harness would accept
    // payloads the real application rejects, and the DTO assertions below
    // would be judging an app that does not exist.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();

    const row = await prisma.platformSetting.findUnique({
      where: { key: SUPPORTED_MARKETS_SETTING },
    });
    if (!row) {
      throw new Error(
        `The market registry setting "${SUPPORTED_MARKETS_SETTING}" is absent. ` +
          `Run the development seed before this suite; it is what enables SY/SE/SA.`,
      );
    }
    seededRegistry = row.value;

    await cleanupFixtures();
    await prisma.user.create({
      data: {
        id: USER,
        email: `${USER}@p5c2.test`,
        firstName: 'Nour',
        lastName: 'Haddad',
        emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
        status: 'ACTIVE',
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: PP,
        userId: USER,
        displayName: 'Nour Haddad',
        initials: 'NH',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        standingState: 'GOOD',
        verificationState: 'UNVERIFIED',
      },
    });
    await prisma.providerOnboardingDraft.create({
      data: {
        providerProfileId: PP,
        currentStep: 'LOCATION',
        version: 1,
        data: {},
        policyVersion: CURRENT_ONBOARDING_POLICY_VERSION,
      },
    });

    currentUser = { id: USER };
  });

  afterAll(async () => {
    await cleanupFixtures();
    if (seededRegistry !== undefined) {
      // Restored exactly, so a suite that runs after this one sees the registry
      // the seed wrote rather than the one these tests needed.
      await prisma.platformSetting.update({
        where: { key: SUPPORTED_MARKETS_SETTING },
        data: { value: seededRegistry as never },
      });
    }
    await app?.close();
    await registryLock?.release();
    await lifecycleLock?.release();
    currentUser = null;
  });

  beforeEach(async () => {
    await setMineEnabled(true);
    await reset();
  });

  // --- the enabled-market boundary ----------------------------------------

  describe('the enabled-market boundary', () => {
    it('accepts a configured, enabled market and stores it uppercase', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: 'SY',
      });
      expect(res.status).toBe(200);
      expect((await profile()).serviceAreaCountryCode).toBe('SY');
    });

    it('accepts a lowercase ISO code and normalises it on the way in', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: 'se',
      });
      expect(res.status).toBe(200);
      // The stored value is the identifier every later comparison uses, so
      // "SE" and "se" must not be two markets.
      expect((await profile()).serviceAreaCountryCode).toBe('SE');
    });

    it('REFUSES a real ISO country the operator has never configured', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: UNCONFIGURED,
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('MARKET_NOT_SUPPORTED');
      expect((await profile()).serviceAreaCountryCode).toBeNull();
    });

    it('REFUSES a configured market that the operator has switched off', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MINE_DISABLED,
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('MARKET_NOT_SUPPORTED');
      expect((await profile()).serviceAreaCountryCode).toBeNull();
    });

    it('REFUSES a syntactically invalid country at the DTO, before the service', async () => {
      const results: Array<[unknown, number]> = [];
      for (const code of ['ZZ', 'USA', 'S', '12', 'S-']) {
        const res = await patchLocation({ version: await version(), serviceAreaCountryCode: code });
        results.push([code, res.status]);
      }
      expect(results).toEqual([
        ['ZZ', 400],
        ['USA', 400],
        ['S', 400],
        ['12', 400],
        ['S-', 400],
      ]);
      expect((await profile()).serviceAreaCountryCode).toBeNull();
    });

    it('refuses ZZ as a NON-COUNTRY, not merely as an unopened market', async () => {
      // Status alone cannot tell these two layers apart, and that is exactly
      // how a weaker DTO rule hides.
      //
      // ZZ is a two-letter uppercase string, so the shape rule this sprint
      // replaced — /^[A-Z]{2}$/ — accepted it. The request still ended in 400,
      // because the enabled-market check downstream refuses anything not in
      // the registry. Every assertion written against the status code
      // therefore passed with the shape rule restored: the outer boundary was
      // gone and no test could see it.
      //
      // WHICH layer refused is the observable difference. The DTO answers with
      // the validation pipe's message and no market reason; the service
      // answers with MARKET_NOT_SUPPORTED. A real country that is merely
      // closed — FR — must reach the second, and ZZ must never get that far.
      const nonCountry = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: 'ZZ',
      });
      const closedMarket = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: UNCONFIGURED,
      });

      expect([nonCountry.status, closedMarket.status]).toEqual([400, 400]);
      expect(closedMarket.body?.error?.details?.reason).toBe('MARKET_NOT_SUPPORTED');
      // ZZ never reaches the registry, so it cannot carry the registry's
      // reason — and it names the ISO rule that stopped it.
      expect(nonCountry.body?.error?.details?.reason).not.toBe('MARKET_NOT_SUPPORTED');
      expect(JSON.stringify(nonCountry.body)).toContain('ISO 3166-1 alpha-2');
    });

    it('allows the country to be CLEARED - not choosing a market is not an unsupported one', async () => {
      const ok = await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      expect(ok.status).toBe(200);

      const cleared = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: null,
      });
      expect(cleared.status).toBe(200);
      expect((await profile()).serviceAreaCountryCode).toBeNull();
    });

    it('REFUSES a partial edit that carries no country, once the STORED market is disabled', async () => {
      // The defect this pins: the check originally ran only when the request
      // carried serviceAreaCountryCode, so a provider standing in a market the
      // operator had withdrawn from could keep editing their city for ever.
      const placed = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MINE_ENABLED,
      });
      expect(placed.status).toBe(200);

      await setMineEnabled(false);

      const res = await patchLocation({ version: await version(), serviceAreaCity: 'Trondheim' });
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('MARKET_NOT_SUPPORTED');
      // And the city it carried is not persisted: the refusal happens before
      // any write, not after a partial one.
      expect((await profile()).serviceAreaCity).toBe('Aleppo');
    });

    it('takes a withdrawal effective IMMEDIATELY, with no cached window', async () => {
      // Same process, same service instance, no restart between the two calls.
      // A cache in the registry would make the second one succeed.
      const first = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MINE_ENABLED,
      });
      expect(first.status).toBe(200);

      await setMineEnabled(false);

      const second = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MINE_ENABLED,
      });
      expect(second.status).toBe(400);
      expect(second.body?.error?.details?.reason).toBe('MARKET_NOT_SUPPORTED');
    });

    it('writes NOTHING from a payload the market check refuses', async () => {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCity: 'Marseille',
        serviceAreaCountryCode: UNCONFIGURED,
        serviceAreaRadiusKm: 12,
      });
      expect(res.status).toBe(400);

      const p = await profile();
      expect([p.serviceAreaCity, p.serviceAreaCountryCode, p.serviceAreaRadiusKm]).toEqual([
        'Aleppo',
        null,
        null,
      ]);
    });
  });

  // --- radius provenance through the real write path -----------------------

  describe('radius provenance, through the wizard rather than the service', () => {
    it('derives a radius on a LOCATION write and stamps where it came from', async () => {
      const res = await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      expect(res.status).toBe(200);

      const km = (await profile()).serviceAreaRadiusKm as number;
      const stamp = await radiusStamp();
      expect(typeof km).toBe('number');
      expect(stamp).toBeDefined();
      // Enough identity to EXPLAIN the number, not merely to recognise it.
      expect([stamp?.km, stamp?.countryCode, stamp?.basedOn]).toEqual([km, 'SY', 'CAR']);
      expect(typeof stamp?.policyVersion).toBe('string');
    });

    it('does NOT re-stamp when nothing about the derivation has changed', async () => {
      // The other half of "recompute when the identity moves", and the half a
      // test suite forgets: recomputing UNCONDITIONALLY also passes every
      // assertion about following the market, because the stamp is always
      // right — it is simply rewritten on every keystroke.
      //
      // The cost of that is not cosmetic. A stamp rewritten on every write
      // carries a fresh timestamp, so "when did the server last decide this
      // radius?" stops being answerable, and the conditional write that lets a
      // provider's concurrent edit win is executed on every save instead of
      // only when something changed.
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      const first = await radiusStamp();
      expect(first).toBeDefined();

      // A second write that changes something ELSE entirely.
      const again = await patchLocation({ version: await version(), serviceAreaCity: 'Homs' });
      expect(again.status).toBe(200);

      // Byte for byte the same stamp, timestamp included.
      expect(await radiusStamp()).toEqual(first);
    });

    it('follows the market: changing country re-derives and re-stamps', async () => {
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      expect((await radiusStamp())?.countryCode).toBe('SY');

      const moved = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: 'SE',
      });
      expect(moved.status).toBe(200);
      // The number may or may not differ - the ladder is per-market - but the
      // provenance must never still claim the market they left.
      expect((await radiusStamp())?.countryCode).toBe('SE');
    });

    it('CLEARS provenance when the provider chooses exactly the suggested number', async () => {
      // The case numeric comparison cannot decide, and the reason provenance
      // exists at all.
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      const suggested = (await profile()).serviceAreaRadiusKm as number;
      expect(await radiusStamp()).toBeDefined();

      const explicit = await patchLocation({
        version: await version(),
        serviceAreaRadiusKm: suggested,
      });
      expect(explicit.status).toBe(200);

      expect((await profile()).serviceAreaRadiusKm).toBe(suggested);
      expect(await radiusStamp()).toBeUndefined();
    });

    it('never moves an explicitly chosen radius again, even when the market changes', async () => {
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      const suggested = (await profile()).serviceAreaRadiusKm as number;

      await patchLocation({ version: await version(), serviceAreaRadiusKm: suggested });
      expect(await radiusStamp()).toBeUndefined();

      const moved = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: 'SE',
      });
      expect(moved.status).toBe(200);

      expect((await profile()).serviceAreaRadiusKm).toBe(suggested);
      expect(await radiusStamp()).toBeUndefined();
    });

    it('commits the radius and its provenance TOGETHER, or neither', async () => {
      // The refusal comes from the market check, which runs inside the same
      // transaction as both writes. A radius that survived a rolled-back
      // provenance write - or the reverse - is the failure being excluded.
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      const before = (await profile()).serviceAreaRadiusKm as number;
      const stampBefore = await radiusStamp();

      const refused = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MINE_DISABLED,
        serviceAreaRadiusKm: before + 1,
      });
      expect(refused.status).toBe(400);

      expect((await profile()).serviceAreaRadiusKm).toBe(before);
      expect(await radiusStamp()).toEqual(stampBefore);
    });

    it('does not erase OTHER server-owned bookkeeping when a step is written', async () => {
      // The defect this pins is one line in the repository, and it cost the
      // radius stamp its whole existence: the step write replaced draft.data
      // with a scratch bag copied before the defaults ran, so every stamp the
      // same request had just written disappeared on commit.
      //
      // Asserted with the headline stamp rather than the radius stamp because
      // that one is written by a DIFFERENT code path, so a fix that only
      // rescued the radius would still fail here.
      await prisma.$executeRawUnsafe(
        `UPDATE "ProviderOnboardingDraft"
           SET "data" = '{"v2GeneratedHeadlineAt":"2026-01-01T00:00:00.000Z"}'::jsonb
         WHERE "providerProfileId" = $1`,
        PP,
      );

      const res = await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      expect(res.status).toBe(200);

      const draft = await prisma.providerOnboardingDraft.findUnique({
        where: { providerProfileId: PP },
        select: { data: true },
      });
      const data = draft.data as Record<string, unknown>;
      // Both survive: the pre-existing stamp AND the one this request wrote.
      expect(data.v2GeneratedHeadlineAt).toBe('2026-01-01T00:00:00.000Z');
      expect(data.v2DerivedRadius).toBeDefined();
    });

    it('re-derives after the provider clears the radius entirely', async () => {
      await patchLocation({ version: await version(), serviceAreaCountryCode: 'SY' });
      const suggested = (await profile()).serviceAreaRadiusKm as number;

      const cleared = await patchLocation({
        version: await version(),
        serviceAreaRadiusKm: null,
      });
      expect(cleared.status).toBe(200);

      // Clearing is the provider un-answering the question, so the server may
      // answer it again - with FRESH provenance rather than the stale stamp.
      const after = await profile();
      const stamp = await radiusStamp();
      expect(after.serviceAreaRadiusKm).toBe(suggested);
      expect(stamp?.km).toBe(suggested);
    });
  });

  // --- C3: the timezone a week is stored in ---------------------------------

  describe('C3 - the chosen timezone must belong to the confirmed market', () => {
    const patchAvailability = (body: Record<string, unknown>) =>
      request(http).patch('/v1/me/provider/onboarding/steps/AVAILABILITY').send(body);
    const MONDAY = [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }];

    async function storedZones(): Promise<string[]> {
      const rows = await prisma.providerAvailabilityInterval.findMany({
        where: { providerProfileId: PP },
        select: { timezone: true },
      });
      return rows.map((r: { timezone: string }) => r.timezone);
    }

    async function place(countryCode: string): Promise<void> {
      const res = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: countryCode,
      });
      expect([countryCode, res.status]).toEqual([countryCode, 200]);
    }

    afterEach(async () => {
      await prisma.providerAvailabilityInterval.deleteMany({ where: { providerProfileId: PP } });
    });

    it('accepts the zone the market declares', async () => {
      await place('SY');
      const res = await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: 'Asia/Damascus',
      });
      expect(res.status).toBe(200);
      expect(await storedZones()).toEqual(['Asia/Damascus']);
    });

    it('REFUSES a perfectly valid IANA zone that belongs to another market', async () => {
      // The assertion a syntax check cannot make. Europe/Stockholm parses,
      // exists, and is wrong for a provider working in Syria.
      await place('SY');
      const res = await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: 'Europe/Stockholm',
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('TIMEZONE_NOT_IN_MARKET');
      // The permitted zones travel with the refusal, so the screen can offer
      // them rather than leaving the provider to guess.
      expect(res.body?.error?.details?.allowed).toEqual(['Asia/Damascus']);
      // And nothing partial is written.
      expect(await storedZones()).toEqual([]);
    });

    it('distinguishes an UNKNOWN zone from an incompatible one', async () => {
      // Two different mistakes needing two different sentences: "that is not a
      // timezone" and "that is not YOUR timezone".
      await place('SY');
      const res = await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: 'Mars/Olympus_Mons',
      });
      expect(res.status).toBe(400);
      expect(res.body?.error?.details?.reason).toBe('TIMEZONE_UNKNOWN');
      expect(await storedZones()).toEqual([]);
    });

    it('lets a MULTI-zone market choose any zone it declares', async () => {
      await place(MINE_MULTI);
      for (const zone of MULTI_ZONES) {
        const res = await patchAvailability({
          version: await version(),
          availability: MONDAY,
          timezone: zone,
        });
        expect([zone, res.status]).toEqual([zone, 200]);
        expect(await storedZones()).toEqual([zone]);
      }
    });

    it('ASKS rather than guessing when a multi-zone market supplies no timezone', async () => {
      await place(MINE_MULTI);
      const res = await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: null,
      });
      expect(res.status).toBe(400);
      // AMBIGUOUS_MARKET, not MARKET_REQUIRED: they HAVE a market, it just has
      // more than one answer. The screen asks a different question for each.
      expect(res.body?.error?.details?.reason).toBe('TIMEZONE_AMBIGUOUS');
      expect(await storedZones()).toEqual([]);
    });

    it('INVALIDATES a stored zone when the provider changes country', async () => {
      // The never-overwrite rule, correctly bounded. Keeping Europe/Stockholm
      // for a provider who has moved to Syria would silently shift every hour
      // they had already entered.
      await place('SE');
      const saved = await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: 'Europe/Stockholm',
      });
      expect(saved.status).toBe(200);
      expect(await storedZones()).toEqual(['Europe/Stockholm']);

      await place('SY');

      // A later write carrying no timezone of its own must resolve from the
      // NEW market rather than keep the zone of the market they left.
      const rewritten = await patchAvailability({
        version: await version(),
        availability: MONDAY,
      });
      expect(rewritten.status).toBe(200);
      expect(await storedZones()).toEqual(['Asia/Damascus']);
    });

    it('survives a reload: the stored zone is read back, not re-decided', async () => {
      await place('SY');
      await patchAvailability({
        version: await version(),
        availability: MONDAY,
        timezone: 'Asia/Damascus',
      });

      const draft = await request(http).get('/v1/me/provider/onboarding/draft');
      expect(draft.status).toBe(200);
      expect(draft.body.data.availability.map((a: { timezone: string }) => a.timezone)).toEqual([
        'Asia/Damascus',
      ]);
    });
  });

  // --- the markets read model ----------------------------------------------

  describe('GET /markets', () => {
    it('serves the enabled markets and omits the disabled one', async () => {
      const res = await getMarkets();
      expect(res.status).toBe(200);

      const codes = res.body.markets.map((m: { countryCode: string }) => m.countryCode);
      expect(codes).toEqual(expect.arrayContaining(['SY', 'SE', 'SA', MINE_ENABLED]));
      expect(codes).not.toContain(MINE_DISABLED);
      // Uppercase is the identifier contract; a mixed-case code would compare
      // unequal to the persisted value.
      expect(codes).toEqual(codes.map((c: string) => c.toUpperCase()));
    });

    it('sends i18n KEYS, so Arabic and English are equal rather than translated', async () => {
      const res = await getMarkets();
      const sy = res.body.markets.find((m: { countryCode: string }) => m.countryCode === 'SY');
      expect(sy.displayNameKey).toBe('market.SY');
    });

    it('discloses nothing from the operator registry beyond the projection', async () => {
      const res = await getMarkets();
      expect(Object.keys(res.body).sort()).toEqual([
        'locationSuggestionAvailable',
        'markets',
        'selectedCountryCode',
      ]);
      for (const market of res.body.markets) {
        expect(Object.keys(market).sort()).toEqual([
          'countryCode',
          'displayNameKey',
          'radius',
          'timezone',
        ]);
      }
      // Belt and braces: the registry's own field names must not appear
      // anywhere in the response, however the projection is later reshaped.
      const body = JSON.stringify(res.body);
      for (const leaked of ['enabled', 'updatedBy', 'defaultTimezone', 'platform_supported']) {
        expect(body).not.toContain(leaked);
      }
    });

    it('reports a selected market that has since been WITHDRAWN', async () => {
      await patchLocation({ version: await version(), serviceAreaCountryCode: MINE_ENABLED });
      await setMineEnabled(false);

      const res = await getMarkets();
      const codes = res.body.markets.map((m: { countryCode: string }) => m.countryCode);
      // Both halves: absent from the choices, still named as the selection.
      // The UI needs both to say "we have withdrawn from your market".
      expect(codes).not.toContain(MINE_ENABLED);
      expect(res.body.selectedCountryCode).toBe(MINE_ENABLED);
    });

    it('says location suggestion is unavailable, because no geocoder is configured', async () => {
      const res = await getMarkets();
      expect(res.body.locationSuggestionAvailable).toBe(false);
    });

    it('is a static route that the step parameter cannot capture', async () => {
      // `markets` is not a ProviderOnboardingStep, and the step route is a
      // PATCH under `steps/`. If a later refactor moved the wizard to a
      // top-level `:step` GET, this is what would catch it.
      const asStep = await request(http).get('/v1/me/provider/onboarding/steps/markets');
      expect(asStep.status).toBe(404);
      expect((await getMarkets()).status).toBe(200);
    });

    it('is refused when the request carries no authenticated user', async () => {
      const saved = currentUser;
      currentUser = null;
      try {
        const res = await getMarkets();
        // The harness stubs JwtAuthGuard, so an unauthenticated request is
        // refused by a guard returning false - 403. What this asserts is that
        // the route IS behind the guard chain; the real guard's 401 is the
        // authentication module's own contract and is tested there.
        expect(res.status).toBe(403);
      } finally {
        currentUser = saved;
      }
    });
  });
});
