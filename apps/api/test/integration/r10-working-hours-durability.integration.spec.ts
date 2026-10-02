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

// R10 — the provider's weekly working hours, THROUGH THE REAL HTTP PATH,
// against real Postgres.
//
// docs/production-readiness/r10/SCHEDULE_AUTHORITY_MATRIX.md
//
// A week is recurring LOCAL wall-clock minutes in one IANA zone:
// dayOfWeek 0 (Sunday) to 6, startMinute inclusive, endMinute exclusive, 1440
// for midnight as an end. The whole week is replaced in one transaction under
// the draft version. Nothing here is an appointment or an instant.
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

/** Markets this suite adds to the operator registry. Named by nothing else in
 *  the repository except r09-geo-authority, which holds the same exclusive
 *  registry lock, so the two never run at once. */
const SINGLE = 'FI';
const SINGLE_ZONE = 'Europe/Helsinki';
const OTHER = 'PT';
const OTHER_ZONE = 'Europe/Lisbon';
/** Several zones and no default: the provider has to say which. */
const MULTI = 'BR';
const MULTI_ZONES = ['America/Sao_Paulo', 'America/Manaus'];

const SUPPORTED_MARKETS_SETTING = 'platform_supported_markets';

d('R10 - working-hours durability (real HTTP, real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let app: INestApplication;
  let http: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('r10hrs');
  const USER = `${P}user`;
  const PP = `${P}pp`;
  const OTHER_USER = `${P}other-user`;
  const OTHER_PP = `${P}other-pp`;
  let locks: HeldLock | undefined;
  let seededRegistry: unknown;

  const patchLocation = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/LOCATION').send(body);
  const patchHours = (body: Record<string, unknown>) =>
    request(http).patch('/v1/me/provider/onboarding/steps/AVAILABILITY').send(body);
  const getDraft = () => request(http).get('/v1/me/provider/onboarding/draft');

  async function version(pp = PP): Promise<number> {
    const draft = await prisma.providerOnboardingDraft.findUnique({
      where: { providerProfileId: pp },
      select: { version: true },
    });
    return draft.version;
  }
  const reason = (res: { body: { error?: { details?: { reason?: string } } } }) =>
    res.body.error?.details?.reason;

  async function installMarkets(): Promise<void> {
    const current = await prisma.platformSetting.findUnique({
      where: { key: SUPPORTED_MARKETS_SETTING },
    });
    const others = (current.value as Array<Record<string, unknown>>).filter(
      (m) => ![SINGLE, OTHER, MULTI].includes(String(m.countryCode)),
    );
    await prisma.platformSetting.update({
      where: { key: SUPPORTED_MARKETS_SETTING },
      data: {
        value: [
          ...others,
          {
            countryCode: SINGLE,
            enabled: true,
            displayNameKey: `market.${SINGLE}`,
            defaultTimezone: SINGLE_ZONE,
          },
          {
            countryCode: OTHER,
            enabled: true,
            displayNameKey: `market.${OTHER}`,
            defaultTimezone: OTHER_ZONE,
          },
          {
            countryCode: MULTI,
            enabled: true,
            displayNameKey: `market.${MULTI}`,
            timezones: MULTI_ZONES,
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
        serviceAreaCountryCode: SINGLE,
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
    await prisma.providerAvailabilityInterval.deleteMany({ where: { providerProfileId: pp } });
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
      JWT_ACCESS_SECRET: makeTestSecret('r10-working-hours'),
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
          email: `${user}@r10hrs.test`,
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
          currentStep: 'AVAILABILITY',
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

  // ── the week, as rows ───────────────────────────────────────────────────

  interface Interval {
    dayOfWeek: number;
    startMinute: number;
    endMinute: number;
  }
  const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  const win = (dayOfWeek: number, start: string, end: string): Interval => ({
    dayOfWeek,
    startMinute: at(start),
    endMinute: end === '24:00' ? 1440 : at(end),
  });
  const sorted = (week: Interval[]) =>
    [...week].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute);

  /** The stored week, straight from PostgreSQL, in the documented order. */
  async function rows(pp = PP): Promise<Array<Interval & { timezone: string; id: string }>> {
    return prisma.providerAvailabilityInterval.findMany({
      where: { providerProfileId: pp },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
    });
  }
  const bare = (stored: Array<Interval & { timezone: string }>) =>
    stored.map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute }));
  const zonesOf = (stored: Array<{ timezone: string }>) => [
    ...new Set(stored.map((r) => r.timezone)),
  ];

  /** Save a week the way a client does, and require it to be accepted. */
  async function save(week: Interval[], extra: Record<string, unknown> = {}) {
    const res = await patchHours({ version: await version(), availability: week, ...extra });
    expect([res.status, JSON.stringify(res.body.error ?? null)]).toEqual([200, 'null']);
    return res;
  }

  const WEEK_A = [win(1, '09:00', '17:00'), win(3, '09:00', '17:00'), win(5, '10:00', '14:00')];
  const WEEK_B = [win(0, '08:00', '12:00'), win(2, '13:00', '18:30')];
  const problems = (res: { body: { error?: { details?: { availability?: unknown[] } } } }) =>
    (res.body.error?.details?.availability ?? []) as Array<{
      code: string;
      index: number;
      conflictsWith?: number;
    }>;

  /** A refused write must leave the stored week exactly as it was: same rows,
   *  same ids, same zone, same version. */
  async function expectWeekUntouched(
    before: Awaited<ReturnType<typeof rows>>,
    v: number,
  ): Promise<void> {
    expect(await rows()).toEqual(before);
    expect(await version()).toBe(v);
  }

  describe('a week is written, read back and stored as one thing', () => {
    it('stores exactly the rows that were sent, in one zone, and serves them back in order', async () => {
      // Sent out of order on purpose.
      const sent = [WEEK_A[2], WEEK_A[0], WEEK_A[1]];
      const res = await save(sent);

      const stored = await rows();
      expect(bare(stored)).toEqual(sorted(WEEK_A));
      expect(zonesOf(stored)).toEqual([SINGLE_ZONE]);
      // The acknowledgement and a later read say the same thing as the rows.
      for (const view of [res.body, (await getDraft()).body]) {
        expect(
          view.data.availability.map((i: Interval) => ({
            dayOfWeek: i.dayOfWeek,
            startMinute: i.startMinute,
            endMinute: i.endMinute,
          })),
        ).toEqual(sorted(WEEK_A));
        expect(view.data.timezone).toBe(SINGLE_ZONE);
      }
    });

    it('keeps several windows on one day, and returns them in start order', async () => {
      const split = [win(1, '13:00', '17:00'), win(1, '09:00', '12:00'), win(2, '09:00', '12:00')];
      await save(split);
      expect(bare(await rows())).toEqual(sorted(split));
      expect((await getDraft()).body.data.availability.map((i: Interval) => i.startMinute)).toEqual(
        [at('09:00'), at('13:00'), at('09:00')],
      );
    });

    it('accepts touching windows and does not merge them', async () => {
      const touching = [win(1, '09:00', '12:00'), win(1, '12:00', '15:00')];
      await save(touching);
      // Two rows, exactly as entered: an exclusive end may equal the next start.
      expect(bare(await rows())).toEqual(touching);
    });

    it('stores midnight as an exclusive end of 1440, and a whole day as 0 to 1440', async () => {
      const late = [win(5, '22:00', '24:00'), win(6, '00:00', '24:00')];
      await save(late);
      expect(bare(await rows())).toEqual([
        { dayOfWeek: 5, startMinute: 1320, endMinute: 1440 },
        { dayOfWeek: 6, startMinute: 0, endMinute: 1440 },
      ]);
    });

    it('keeps a shift that crosses midnight as two windows on two days', async () => {
      const overnight = [win(5, '22:00', '24:00'), win(6, '00:00', '02:00')];
      await save(overnight);
      expect(bare(await rows())).toEqual(overnight);
    });

    it('stores a minute that is not on a quarter hour exactly as sent', async () => {
      const offGrid = [win(1, '09:07', '16:53')];
      await save(offGrid);
      expect(bare(await rows())).toEqual([{ dayOfWeek: 1, startMinute: 547, endMinute: 1013 }]);
      expect((await getDraft()).body.data.availability[0]).toMatchObject({
        startMinute: 547,
        endMinute: 1013,
      });
    });

    it('replaces the whole week: nothing of the old one remains', async () => {
      await save(WEEK_A);
      await save(WEEK_B);
      expect(bare(await rows())).toEqual(sorted(WEEK_B));
    });

    it('saving the same week twice stores it once', async () => {
      await save(WEEK_A);
      const v = await version();
      await save(WEEK_A);
      expect(bare(await rows())).toEqual(sorted(WEEK_A));
      expect(
        await prisma.providerAvailabilityInterval.count({ where: { providerProfileId: PP } }),
      ).toBe(WEEK_A.length);
      // Every accepted write is a new revision, identical or not.
      expect(await version()).toBe(v + 1);
    });
  });

  describe('an empty week means no working hours, and stays empty', () => {
    it('clears every row and invents no default hours', async () => {
      await save(WEEK_A);
      const res = await save([]);
      expect(res.body.data.availability).toEqual([]);
      expect(await rows()).toEqual([]);

      // Reading it back, twice, does not put anything there.
      for (let i = 0; i < 2; i += 1) {
        expect((await getDraft()).body.data.availability).toEqual([]);
      }
      expect(await rows()).toEqual([]);
    });

    it('an empty week can be saved before any market is chosen', async () => {
      await reset({ serviceAreaCountryCode: null });
      const res = await patchHours({ version: await version(), availability: [] });
      expect(res.status).toBe(200);
      expect(await rows()).toEqual([]);
    });
  });

  describe('what the server refuses, whatever order it arrives in', () => {
    const cases: Array<[string, Interval[], string]> = [
      ['a partial overlap', [win(1, '09:00', '12:00'), win(1, '11:00', '13:00')], 'OVERLAP'],
      [
        'a partial overlap, later window first',
        [win(1, '11:00', '13:00'), win(1, '09:00', '12:00')],
        'OVERLAP',
      ],
      ['a window inside another', [win(1, '09:00', '17:00'), win(1, '10:00', '11:00')], 'OVERLAP'],
      [
        'a window inside another, inner first',
        [win(1, '10:00', '11:00'), win(1, '09:00', '17:00')],
        'OVERLAP',
      ],
      ['an exact duplicate', [win(1, '09:00', '12:00'), win(1, '09:00', '12:00')], 'OVERLAP'],
      [
        'an overlap hidden among other days',
        [
          win(0, '09:00', '12:00'),
          win(3, '14:00', '18:00'),
          win(6, '09:00', '12:00'),
          win(3, '17:59', '19:00'),
        ],
        'OVERLAP',
      ],
      [
        'a single window running past midnight',
        [{ dayOfWeek: 5, startMinute: 1320, endMinute: 120 }],
        'END_NOT_AFTER_START',
      ],
      ['a window that ends when it starts', [win(1, '09:00', '09:00')], 'END_NOT_AFTER_START'],
    ];

    it.each(cases)(
      'REFUSES %s, names the row, and leaves the stored week intact',
      async (_label, week, code) => {
        await save(WEEK_A);
        const before = await rows();
        const v = await version();

        const res = await patchHours({ version: v, availability: week });
        expect(res.status).toBe(422);
        expect(problems(res).map((p) => p.code)).toContain(code);
        for (const problem of problems(res)) {
          expect(problem.index).toBeGreaterThanOrEqual(0);
          expect(problem.index).toBeLessThan(week.length);
        }
        await expectWeekUntouched(before, v);
      },
    );

    it('answers the same for every ordering of an overlapping pair among valid windows', async () => {
      const valid = [win(0, '09:00', '12:00'), win(2, '09:00', '12:00')];
      const clash = [win(1, '09:00', '13:00'), win(1, '12:00', '15:00')];
      const orderings = [
        [...valid, ...clash],
        [...clash, ...valid],
        [clash[1], valid[0], clash[0], valid[1]],
        [valid[1], clash[1], valid[0], clash[0]],
      ];
      for (const week of orderings) {
        const res = await patchHours({ version: await version(), availability: week });
        expect(res.status).toBe(422);
        const [problem] = problems(res);
        // Always the later-starting window, pointing at the one it collides with.
        expect(week[problem.index]).toEqual(clash[1]);
        expect(week[problem.conflictsWith as number]).toEqual(clash[0]);
      }
      expect(await rows()).toEqual([]);
    });

    it.each([
      ['a day of 7', { dayOfWeek: 7, startMinute: 540, endMinute: 600 }],
      ['a negative day', { dayOfWeek: -1, startMinute: 540, endMinute: 600 }],
      ['an end past 1440', { dayOfWeek: 1, startMinute: 540, endMinute: 1441 }],
      ['a negative start', { dayOfWeek: 1, startMinute: -1, endMinute: 600 }],
      ['a fractional minute', { dayOfWeek: 1, startMinute: 540.5, endMinute: 600 }],
      ['a time written as text', { dayOfWeek: 1, startMinute: '09:00', endMinute: '10:00' }],
      ['a missing end', { dayOfWeek: 1, startMinute: 540 }],
      [
        'an unknown property',
        { dayOfWeek: 1, startMinute: 540, endMinute: 600, isAvailable: true },
      ],
    ])('REFUSES %s before it reaches the schedule', async (_label, interval) => {
      await save(WEEK_A);
      const before = await rows();
      const v = await version();
      const res = await patchHours({ version: v, availability: [interval] });
      expect(res.status).toBe(400);
      await expectWeekUntouched(before, v);
    });

    it('accepts exactly the maximum number of windows and refuses one more', async () => {
      // 60 windows: seven days of 30-minute windows separated by 30 minutes.
      const many: Interval[] = [];
      for (let i = 0; i < 61; i += 1) {
        const day = i % 7;
        const slot = Math.floor(i / 7);
        many.push({ dayOfWeek: day, startMinute: slot * 60, endMinute: slot * 60 + 30 });
      }
      const atLimit = many.slice(0, 60);
      await save(atLimit);
      expect(
        await prisma.providerAvailabilityInterval.count({ where: { providerProfileId: PP } }),
      ).toBe(60);

      const before = await rows();
      const v = await version();
      const over = await patchHours({ version: v, availability: many });
      expect(over.status).toBeGreaterThanOrEqual(400);
      expect(over.status).toBeLessThan(500);
      await expectWeekUntouched(before, v);
    });

    it('rolls the whole replacement back when the database itself refuses a row', async () => {
      await save(WEEK_A);
      const before = await rows();
      const v = await version();

      // A real database failure in the middle of the replacement: the delete
      // of the old week has already run inside the transaction when PostgreSQL
      // refuses the insert. The trigger fires for this fixture's profile only.
      const fn = `r10_refuse_insert_${Date.now()}`;
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$
           BEGIN RAISE EXCEPTION 'r10 simulated insert failure'; END;
         $$ LANGUAGE plpgsql`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER "${fn}" BEFORE INSERT ON "ProviderAvailabilityInterval"
           FOR EACH ROW WHEN (NEW."providerProfileId" = '${PP}') EXECUTE FUNCTION "${fn}"()`,
      );
      try {
        const res = await patchHours({ version: v, availability: WEEK_B });
        expect(res.status).toBe(500);
        // The database's own words do not reach the client.
        expect(JSON.stringify(res.body)).not.toContain('r10 simulated');
      } finally {
        await prisma.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${fn}" ON "ProviderAvailabilityInterval"`,
        );
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
      }
      // Not half of B, not an empty week: A, exactly as it was.
      await expectWeekUntouched(before, v);

      // And the schedule is still writable afterwards.
      await save(WEEK_B);
      expect(bare(await rows())).toEqual(sorted(WEEK_B));
    });
  });

  describe('one writer wins, completely', () => {
    it('refuses a stale write and stores nothing from it', async () => {
      const stale = await version();
      await save(WEEK_A);
      const before = await rows();

      const res = await patchHours({ version: stale, availability: WEEK_B });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toMatchObject({
        expectedVersion: stale + 1,
        receivedVersion: stale,
      });
      await expectWeekUntouched(before, stale + 1);

      // With the current version the same week is accepted.
      await save(WEEK_B);
      expect(bare(await rows())).toEqual(sorted(WEEK_B));
    });

    it('two simultaneous writers: one whole week is stored, never a mixture', async () => {
      for (let round = 0; round < 12; round += 1) {
        await save(round % 2 === 0 ? [] : [win(4, '06:00', '07:00')]);
        const v = await version();
        const [a, b] = await Promise.all([
          patchHours({ version: v, availability: WEEK_A }),
          patchHours({ version: v, availability: WEEK_B }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);

        const winner = a.status === 200 ? WEEK_A : WEEK_B;
        const stored = await rows();
        expect([round, bare(stored)]).toEqual([round, sorted(winner)]);
        expect(zonesOf(stored)).toEqual([SINGLE_ZONE]);
        expect(await version()).toBe(v + 1);

        // The loser reads the new version and saves normally.
        const loser = a.status === 200 ? WEEK_B : WEEK_A;
        await save(loser);
        expect([round, bare(await rows())]).toEqual([round, sorted(loser)]);
      }
    });

    it('five simultaneous writers: exactly one is accepted', async () => {
      const weeks = [0, 1, 2, 3, 4].map((d) => [
        win(d, '09:00', '12:00'),
        win(d + 1, '13:00', '17:00'),
      ]);
      for (let round = 0; round < 4; round += 1) {
        const v = await version();
        const results = await Promise.all(
          weeks.map((week) => patchHours({ version: v, availability: week })),
        );
        const accepted = results.map((r, i) => (r.status === 200 ? i : -1)).filter((i) => i >= 0);
        expect([round, accepted.length]).toEqual([round, 1]);
        expect(results.filter((r) => r.status === 409)).toHaveLength(4);
        expect(bare(await rows())).toEqual(sorted(weeks[accepted[0]]));
        expect(await version()).toBe(v + 1);
      }
    });

    it('a zone change racing a new week leaves one zone and one week', async () => {
      await reset({ serviceAreaCountryCode: MULTI });
      await save(WEEK_A, { timezone: MULTI_ZONES[0] });
      for (let round = 0; round < 6; round += 1) {
        const v = await version();
        const [zone, week] = await Promise.all([
          patchHours({ version: v, timezone: MULTI_ZONES[1] }),
          patchHours({ version: v, availability: WEEK_B, timezone: MULTI_ZONES[0] }),
        ]);
        expect([zone.status, week.status].sort()).toEqual([200, 409]);
        const stored = await rows();
        expect(zonesOf(stored)).toHaveLength(1);
        expect([sorted(WEEK_A), sorted(WEEK_B)]).toContainEqual(bare(stored));
        // Back to a known state for the next round.
        await save(WEEK_A, { timezone: MULTI_ZONES[0] });
      }
    });
  });

  describe('the timezone belongs to the market, not to the browser', () => {
    it('derives the zone of a single-zone market when none is sent', async () => {
      await save(WEEK_A);
      expect(zonesOf(await rows())).toEqual([SINGLE_ZONE]);
    });

    it.each([
      ['a zone that does not exist', 'Mars/Olympus_Mons', 'TIMEZONE_UNKNOWN'],
      ['something that is not a zone at all', 'not a timezone', 'TIMEZONE_UNKNOWN'],
      ['a real zone of another country', 'Asia/Riyadh', 'TIMEZONE_NOT_IN_MARKET'],
      ['UTC, which is no market zone', 'UTC', 'TIMEZONE_NOT_IN_MARKET'],
    ])('REFUSES %s and leaves the stored week and zone intact', async (_label, timezone, code) => {
      await save(WEEK_A);
      const before = await rows();
      const v = await version();
      const res = await patchHours({ version: v, availability: WEEK_B, timezone });
      expect(res.status).toBe(400);
      expect(reason(res)).toBe(code);
      await expectWeekUntouched(before, v);
    });

    it('treats an empty or null zone as "not sent" where the market can answer', async () => {
      for (const timezone of ['', null]) {
        await save(WEEK_A, { timezone });
        expect(zonesOf(await rows())).toEqual([SINGLE_ZONE]);
      }
    });

    it('a multi-zone market must be told which zone, and accepts only its own', async () => {
      await reset({ serviceAreaCountryCode: MULTI });

      const unsaid = await patchHours({ version: await version(), availability: WEEK_A });
      expect(unsaid.status).toBe(400);
      expect(reason(unsaid)).toBe('TIMEZONE_AMBIGUOUS');
      expect(await rows()).toEqual([]);

      const foreign = await patchHours({
        version: await version(),
        availability: WEEK_A,
        timezone: SINGLE_ZONE,
      });
      expect(foreign.status).toBe(400);
      expect(reason(foreign)).toBe('TIMEZONE_NOT_IN_MARKET');
      expect(await rows()).toEqual([]);

      for (const zone of MULTI_ZONES) {
        await save(WEEK_A, { timezone: zone });
        expect(zonesOf(await rows())).toEqual([zone]);
      }
    });

    it('refuses hours when there is no market to take a zone from, and writes nothing', async () => {
      await reset({ serviceAreaCountryCode: null });
      const v = await version();
      const res = await patchHours({ version: v, availability: WEEK_A });
      expect(res.status).toBe(400);
      expect(reason(res)).toBe('TIMEZONE_MARKET_REQUIRED');
      expect(await rows()).toEqual([]);
      expect(await version()).toBe(v);
    });

    it('changing the zone moves every row together and shifts no minute', async () => {
      await reset({ serviceAreaCountryCode: MULTI });
      const week = [win(1, '10:00', '13:00'), win(1, '14:00', '18:00'), win(5, '22:00', '24:00')];
      await save(week, { timezone: MULTI_ZONES[0] });

      const res = await patchHours({ version: await version(), timezone: MULTI_ZONES[1] });
      expect(res.status).toBe(200);
      const stored = await rows();
      // Local wall-clock hours: the same numbers, in the new zone.
      expect(bare(stored)).toEqual(sorted(week));
      expect(zonesOf(stored)).toEqual([MULTI_ZONES[1]]);
      expect(res.body.data.timezone).toBe(MULTI_ZONES[1]);
    });

    it('repairs rows that were left in two zones on the next write', async () => {
      // A state no route produces; reachable only by a direct database write.
      await save(WEEK_A);
      const [first] = await rows();
      await prisma.providerAvailabilityInterval.update({
        where: { id: first.id },
        data: { timezone: 'Europe/Stockholm' },
      });
      expect(zonesOf(await rows())).toHaveLength(2);

      await save(WEEK_B);
      const stored = await rows();
      expect(zonesOf(stored)).toEqual([SINGLE_ZONE]);
      expect(bare(stored)).toEqual(sorted(WEEK_B));
    });
  });

  describe('the hours follow the provider to a new market', () => {
    it('after a change of market the stored hours are in a zone of the NEW market', async () => {
      await save(WEEK_A);
      expect(zonesOf(await rows())).toEqual([SINGLE_ZONE]);

      const moved = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: OTHER,
      });
      expect(moved.status).toBe(200);

      // The same local hours, now in the new market's zone, without waiting
      // for the provider to touch their schedule again.
      const stored = await rows();
      expect(bare(stored)).toEqual(sorted(WEEK_A));
      expect(zonesOf(stored)).toEqual([OTHER_ZONE]);
      expect((await getDraft()).body.data.timezone).toBe(OTHER_ZONE);
    });

    it('a client that sends back the zone the server reported can still save hours after moving market', async () => {
      await save(WEEK_A);
      await patchLocation({ version: await version(), serviceAreaCountryCode: OTHER });

      // Exactly what the working-hours screen does: it echoes `data.timezone`.
      const reported = (await getDraft()).body.data.timezone;
      const res = await patchHours({
        version: await version(),
        availability: WEEK_B,
        timezone: reported,
      });
      expect([res.status, reason(res) ?? null]).toEqual([200, null]);
      const stored = await rows();
      expect(bare(stored)).toEqual(sorted(WEEK_B));
      expect(zonesOf(stored)).toEqual([OTHER_ZONE]);
    });

    it('moving to a multi-zone market does not keep the old market zone as if it were confirmed', async () => {
      await save(WEEK_A);
      const moved = await patchLocation({
        version: await version(),
        serviceAreaCountryCode: MULTI,
      });
      expect(moved.status).toBe(200);

      const view = (await getDraft()).body.data;
      // The server cannot pick among several zones: it reports none, and asks.
      expect(view.timezone).toBeNull();
      // The local hours themselves are not lost.
      expect(
        view.availability.map((i: Interval) => ({
          dayOfWeek: i.dayOfWeek,
          startMinute: i.startMinute,
          endMinute: i.endMinute,
        })),
      ).toEqual(sorted(WEEK_A));

      const confirmed = await patchHours({ version: await version(), timezone: MULTI_ZONES[1] });
      expect(confirmed.status).toBe(200);
      const stored = await rows();
      expect(bare(stored)).toEqual(sorted(WEEK_A));
      expect(zonesOf(stored)).toEqual([MULTI_ZONES[1]]);
    });
  });

  describe('one provider cannot reach the hours of another', () => {
    it('writes, clears and stale versions land only on the caller', async () => {
      await save(WEEK_A);
      const mine = await rows();
      const myVersion = await version();

      currentUser = { id: OTHER_USER };
      // The other provider's draft shows none of it.
      expect((await getDraft()).body.data.availability).toEqual([]);

      // My version number is no key to their draft, nor theirs to mine.
      const theirVersion = await version(OTHER_PP);
      const theirs = await patchHours({ version: theirVersion, availability: WEEK_B });
      expect(theirs.status).toBe(200);
      expect(bare(await rows(OTHER_PP))).toEqual(sorted(WEEK_B));
      const cleared = await patchHours({ version: await version(OTHER_PP), availability: [] });
      expect(cleared.status).toBe(200);
      expect(await rows(OTHER_PP)).toEqual([]);

      currentUser = { id: USER };
      await expectWeekUntouched(mine, myVersion);
      expect(
        (await getDraft()).body.data.availability.map((i: { id: string }) => i.id).sort(),
      ).toEqual(mine.map((r) => r.id).sort());
    });
  });
});
