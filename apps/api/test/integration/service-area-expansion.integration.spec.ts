/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client is required LAZILY inside beforeAll on purpose: with
 * RUN_DB_INTEGRATION unset this spec is skipped, and a top-level import would
 * still load the generated client and open its pool on every hermetic run.
 * The sibling integration specs use the same pattern.
 */

export {};

import { fixturePrefix, withAdvisoryLock } from '../support/db-isolation';

// Sprint 9B.20 — earned service-area expansion, against a REAL Postgres.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// The resolver's rules are unit-tested without a database, exhaustively, in
// expansion-resolver.spec.ts. What is left over — and what is here — is
// everything a unit test provably cannot reach:
//
//   * the PARTIAL unique index that makes "one live ladder per market" true
//     under a real race, which no read-then-write service check can guarantee;
//   * the NULLS NOT DISTINCT clause, without which two global-default ladders
//     both insert and the resolver has two answers to choose between;
//   * the CHECK constraints on the override row;
//   * that the feature, SWITCHED OFF, changes nothing end to end;
//   * that switching it on grants exactly what the ladder says and audits it.
//
// Prisma cannot express partial indexes or CHECK constraints, so
// `prisma migrate diff` is blind to all of them. Nothing but this file would
// notice if the migration lost them.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Sprint 9B.20 earned service-area expansion (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let expansionService: any;
  let adminService: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** This suite's fixture namespace. */
  const P = fixturePrefix('service-area-expansion');
  const V = (n: string): string => `2099.01-${P.replace(/-$/, '')}-${n}-v1`;

  /**
   * A user-assigned ISO 3166-1 code. Deliberately NOT the global (NULL) scope:
   * that one is shared, and a suite that fought another for it would be
   * testing whichever ran first.
   */
  const COUNTRY = 'ZZ';
  /** For the NULLS NOT DISTINCT case only, which needs the NULL scope by
   *  definition. Guarded by cleanup, and no seed publishes one. */
  const GLOBAL = null;

  const ADMIN_ID = `${P}admin`;

  /** A ladder that is legal under the shipped defaults (base 100, ceiling
   *  250) and asks for more than a rating. */
  const TIERS = {
    tiers: [
      {
        key: 'established',
        maxKm: 150,
        criteria: { requireVerified: true, minCompletedJobs: 10, maxOpenComplaints: 0 },
      },
      {
        key: 'wide',
        maxKm: 200,
        criteria: {
          requireVerified: true,
          minCompletedJobs: 40,
          minRatingAvg: 4.5,
          minReviewCount: 20,
          maxOpenComplaints: 0,
        },
      },
    ],
  };

  /**
   * Guarded by the SHARED lifecycle lock, for the duration of the deletes only.
   *
   * This suite creates ProviderProfile rows, which makes it one of the writers
   * the lifecycle backfill takes that lock EXCLUSIVE against: the backfill
   * scans the whole table, and a row that vanishes between its read and its
   * update fails the run outright with `Record to update not found`. That is
   * exactly what CI hit — this cleanup deleting a row mid-scan.
   *
   * Held around the DELETES rather than the whole suite on purpose.
   * `acquireAdvisoryLock` polls `pg_try_advisory_lock`, which never queues, so
   * an exclusive waiter only wins at an instant when no shared holder exists.
   * Taking it for a whole suite adds a minutes-long holder to that pool and
   * starves the backfill instead — measured, 56 lock timeouts. Held for the
   * milliseconds a delete takes, the window closes and the pool is unchanged.
   *
   * Creating a row mid-scan is harmless by comparison: the backfill either
   * sees it or does not. Only the delete can break it.
   */
  async function cleanup(): Promise<void> {
    await withAdvisoryLock('providerLifecycle', 'shared', async () => {
      await cleanupRows();
    });
  }

  async function cleanupRows(): Promise<void> {
    await prisma.providerServiceAreaExpansion.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceAreaExpansionPolicy.deleteMany({
      where: {
        OR: [{ country: COUNTRY }, { version: { startsWith: '2099.01-' + P.replace(/-$/, '') } }],
      },
    });
    await prisma.auditEvent.deleteMany({ where: { userId: ADMIN_ID } });
    await prisma.user.deleteMany({ where: { id: ADMIN_ID } });
    await prisma.platformSetting.deleteMany({
      where: { key: { in: SETTING_KEYS } },
    });
  }

  const SETTING_KEYS = [
    'provider_service_area_expansion_enabled',
    'provider_service_area_expansion_max_km',
  ];

  /** Write a platform setting, or remove it to fall back to the schema default. */
  async function setSetting(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      await prisma.platformSetting.deleteMany({ where: { key } });
      return;
    }
    await prisma.platformSetting.upsert({
      where: { key },
      create: { key, value: value as never },
      update: { value: value as never },
    });
  }

  async function makeProvider(
    id: string,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return prisma.providerProfile.create({
      data: {
        id: `${P}${id}`,
        displayName: `Expansion ${id}`,
        initials: 'EX',
        status: 'DRAFT',
        serviceAreaCountryCode: COUNTRY,
        serviceAreaRadiusKm: 25,
        verificationState: 'VERIFIED',
        standingState: 'GOOD',
        availability: 'ONLINE',
        completedJobs: 50,
        ratingAvg: 4.9,
        reviewCount: 30,
        ...over,
      },
    });
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function subjectFor(profile: any) {
    return {
      providerProfileId: profile.id,
      userId: profile.userId ?? null,
      countryCode: profile.serviceAreaCountryCode,
      currentRadiusKm: profile.serviceAreaRadiusKm,
      verificationState: profile.verificationState,
      standingState: profile.standingState,
      legacyStatus: profile.status,
      availability: profile.availability,
      completedJobs: profile.completedJobs,
      ratingAvg: profile.ratingAvg,
      reviewCount: profile.reviewCount,
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** The transport-based ceiling the wizard would pass in. The shipped
   *  `provider_service_radius_max_km` default, read from the schema rather
   *  than written here so the two cannot drift. */
  const BASE_MAX_KM = 100;
  const NOW = new Date('2099-06-01T12:00:00.000Z');

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
    const {
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      ProviderServiceAreaExpansionService,
    } = require('../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service');
    const {
      AdminServiceAreaPolicyService,
    } = require('../../src/modules/admin/service-area/admin-service-area-policy.service');

    // The same two-method stand-in the sibling integration specs use. Not
    // typed as PrismaService: every consumer below came through require() and
    // is therefore already untyped, so importing the class only to name it in
    // a cast would add an unused binding and no safety.
    const prismaService = { client: prisma, isReady: () => true };
    const settings = new PlatformSettingRepository(prismaService);
    const audit = new AuditService(new AuditEventRepository(prismaService));
    const tx = new TransactionRunner(prismaService);

    expansionService = new ProviderServiceAreaExpansionService(prismaService, settings, audit);
    adminService = new AdminServiceAreaPolicyService(prismaService, tx, audit, settings);

    await cleanup();
    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        email: `${P}admin@example.test`,
        passwordHash: 'x',
        firstName: 'A',
        lastName: 'B',
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.providerServiceAreaExpansion.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.serviceAreaExpansionPolicy.deleteMany({
      where: { OR: [{ country: COUNTRY }, { country: GLOBAL }] },
    });
    for (const key of SETTING_KEYS) await setSetting(key, undefined);
    // Every test in this file asserts on the events IT produced. Scoped to
    // this suite's admin plus the one event type nothing else writes, so a
    // concurrent suite's rows are never in range.
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [{ userId: ADMIN_ID }, { type: 'SERVICE_AREA_EXPANSION_TIER_CHANGED' }],
      },
    });
  });

  // ── The index the service layer cannot enforce ────────────────────────────

  describe('one live ladder per market', () => {
    it('survives a real race: many concurrent publishes, exactly one live row', async () => {
      // The service pre-check is a read-then-write and LOSES this race by
      // construction. If it were the only guard, several of these would land
      // and the resolver would have to choose between them — which is the
      // non-deterministic eligibility this sprint forbids.
      const attempts = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          prisma.serviceAreaExpansionPolicy.create({
            data: {
              version: V(`race-${i}`),
              country: COUNTRY,
              tiers: TIERS,
              publishedAt: NOW,
            },
          }),
        ),
      );

      const live = await prisma.serviceAreaExpansionPolicy.count({
        where: { country: COUNTRY, retiredAt: null },
      });
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled').length;
      expect({ live, fulfilled }).toEqual({ live: 1, fulfilled: 1 });
    });

    it('treats two global defaults as the same scope (NULLS NOT DISTINCT)', async () => {
      // Postgres normally considers NULLs distinct in a unique index, so
      // without the clause both of these insert and the global default exists
      // twice.
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('global-a'), country: GLOBAL, tiers: TIERS, publishedAt: NOW },
      });
      await expect(
        prisma.serviceAreaExpansionPolicy.create({
          data: { version: V('global-b'), country: GLOBAL, tiers: TIERS, publishedAt: NOW },
        }),
      ).rejects.toThrow();
    });

    it('allows a replacement once the previous ladder is retired', async () => {
      // Retire-and-republish is the ordinary way to correct a ladder, so the
      // index has to be scoped to un-retired rows or corrections are
      // impossible.
      const first = await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('r1'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      await prisma.serviceAreaExpansionPolicy.update({
        where: { version: first.version },
        data: { retiredAt: NOW },
      });
      const second = await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('r2'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      expect(second.version).toBe(V('r2'));
    });
  });

  describe('override row constraints', () => {
    it('refuses a ceiling with no stated reason', async () => {
      const p = await makeProvider('ov1');
      await expect(
        prisma.providerServiceAreaExpansion.create({
          data: { providerProfileId: p.id, overrideMaxKm: 180 },
        }),
      ).rejects.toThrow();
    });

    it('refuses a reason with no ceiling', async () => {
      const p = await makeProvider('ov2');
      await expect(
        prisma.providerServiceAreaExpansion.create({
          data: { providerProfileId: p.id, overrideReason: 'sparse market' },
        }),
      ).rejects.toThrow();
    });

    it('refuses a blank reason', async () => {
      const p = await makeProvider('ov3');
      await expect(
        prisma.providerServiceAreaExpansion.create({
          data: { providerProfileId: p.id, overrideMaxKm: 180, overrideReason: '   ' },
        }),
      ).rejects.toThrow();
    });
  });

  // ── The acceptance criterion ──────────────────────────────────────────────

  describe('with the feature switched off (the default)', () => {
    it('grants nothing, even with a live ladder and a perfect provider', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('off'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('off');

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);

      expect({
        allowed: decision.allowedMaxKm,
        tier: decision.currentTier,
        version: decision.policyVersion,
        card: decision.showRewardCard,
        reasons: decision.reasonCodes,
      }).toEqual({
        allowed: BASE_MAX_KM,
        tier: null,
        version: null,
        card: false,
        reasons: ['FEATURE_DISABLED'],
      });
    });

    it('writes no expansion row and no audit event', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('off2'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('off2');

      await expansionService.evaluate(subjectFor(p), BASE_MAX_KM, NOW);

      expect(
        await prisma.providerServiceAreaExpansion.count({
          where: { providerProfileId: p.id },
        }),
      ).toBe(0);
    });
  });

  describe('with the feature switched on', () => {
    beforeEach(async () => {
      await setSetting('provider_service_area_expansion_enabled', true);
    });

    it('grants the highest tier the provider actually meets', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('on'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('on');

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({
        allowed: decision.allowedMaxKm,
        tier: decision.currentTier?.key,
        version: decision.policyVersion,
      }).toEqual({ allowed: 200, tier: 'wide', version: V('on') });
    });

    it('records the tier and audits the change exactly once', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('rec'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('rec', { userId: null });

      await expansionService.evaluate(subjectFor(p), BASE_MAX_KM, NOW);
      // Re-running an unchanged evaluation must write nothing: otherwise every
      // autosave would add a row that describes no change.
      await expansionService.evaluate(subjectFor(p), BASE_MAX_KM, NOW);

      const row = await prisma.providerServiceAreaExpansion.findUnique({
        where: { providerProfileId: p.id },
      });
      expect({ tier: row.tierKey, km: row.earnedMaxKm, version: row.policyVersion }).toEqual({
        tier: 'wide',
        km: 200,
        version: V('rec'),
      });

      const events = await prisma.auditEvent.count({
        where: { type: 'SERVICE_AREA_EXPANSION_TIER_CHANGED' },
      });
      expect(events).toBe(1);
    });

    it('ignores a ladder published for another market', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('other'), country: 'ZY', tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('other');

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: BASE_MAX_KM,
        reasons: ['NO_POLICY_FOR_MARKET'],
      });
      await prisma.serviceAreaExpansionPolicy.deleteMany({ where: { country: 'ZY' } });
    });

    it('prefers the market ladder over the global default', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('g'), country: GLOBAL, tiers: TIERS, publishedAt: NOW },
      });
      await prisma.serviceAreaExpansionPolicy.create({
        data: {
          version: V('m'),
          country: COUNTRY,
          tiers: { tiers: [{ ...TIERS.tiers[0], maxKm: 120 }] },
          publishedAt: NOW,
        },
      });
      const p = await makeProvider('pref');

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, version: decision.policyVersion }).toEqual({
        allowed: 120,
        version: V('m'),
      });
    });

    it('refuses to grant anything to a provider on a safety hold', async () => {
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('hold'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      const p = await makeProvider('hold', { standingState: 'UNDER_REVIEW' });

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: BASE_MAX_KM,
        reasons: ['SAFETY_HOLD'],
      });
    });

    it('falls back to the standard bounds when the live ladder no longer parses', async () => {
      // An operator lowering the absolute ceiling below a published tier must
      // not crash the provider's onboarding screen — and must not keep
      // granting more than the ceiling now allows.
      await prisma.serviceAreaExpansionPolicy.create({
        data: { version: V('stale'), country: COUNTRY, tiers: TIERS, publishedAt: NOW },
      });
      await setSetting('provider_service_area_expansion_max_km', 110);
      const p = await makeProvider('stale');

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: BASE_MAX_KM,
        reasons: ['NO_POLICY_FOR_MARKET'],
      });
    });
  });

  // ── The admin surface ─────────────────────────────────────────────────────

  describe('publishing and retiring through the admin service', () => {
    it('publishes a ladder and audits it in the same transaction', async () => {
      const summary = await adminService.publish(ADMIN_ID, {
        version: V('pub'),
        country: COUNTRY,
        tiers: TIERS,
      });
      expect({ version: summary.version, live: summary.isLive }).toEqual({
        version: V('pub'),
        live: true,
      });

      const event = await prisma.auditEvent.findFirst({
        where: { type: 'SERVICE_AREA_POLICY_PUBLISHED', userId: ADMIN_ID },
      });
      expect(event.metadata).toEqual({ policyVersion: V('pub'), country: COUNTRY });
    });

    it('refuses a rating-only ladder at the API boundary, not just in a unit test', async () => {
      await expect(
        adminService.publish(ADMIN_ID, {
          version: V('rating'),
          country: COUNTRY,
          tiers: {
            tiers: [
              { key: 'stars', maxKm: 150, criteria: { minRatingAvg: 4.5, minReviewCount: 20 } },
            ],
          },
        }),
      ).rejects.toMatchObject({ details: { reason: 'RATING_ONLY' } });

      expect(await prisma.serviceAreaExpansionPolicy.count({ where: { country: COUNTRY } })).toBe(
        0,
      );
    });

    it('turns the index violation into the same stable conflict the pre-check gives', async () => {
      await adminService.publish(ADMIN_ID, { version: V('c1'), country: COUNTRY, tiers: TIERS });
      await expect(
        adminService.publish(ADMIN_ID, { version: V('c2'), country: COUNTRY, tiers: TIERS }),
      ).rejects.toMatchObject({ details: { reason: 'OVERLAPPING_POLICY' } });
    });

    it('retires once and refuses a second retirement', async () => {
      await adminService.publish(ADMIN_ID, { version: V('ret'), country: COUNTRY, tiers: TIERS });
      const retired = await adminService.retire(ADMIN_ID, V('ret'));
      expect(retired.retiredAt).not.toBeNull();
      await expect(adminService.retire(ADMIN_ID, V('ret'))).rejects.toMatchObject({
        details: { reason: 'ALREADY_RETIRED' },
      });
    });
  });

  describe('the manual override — the appeal path', () => {
    beforeEach(async () => {
      await setSetting('provider_service_area_expansion_enabled', true);
    });

    it('raises one provider ceiling in a market with no ladder at all', async () => {
      const p = await makeProvider('appeal', { completedJobs: 0, verificationState: 'UNVERIFIED' });

      await adminService.setOverride(ADMIN_ID, {
        providerProfileId: p.id,
        maxKm: 180,
        reason: 'Sparse market; agreed with the regional team.',
        expiresAt: null,
      });

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: 180,
        reasons: ['MANUAL_OVERRIDE', 'NO_POLICY_FOR_MARKET'],
      });
    });

    it('records who granted it, why, and when', async () => {
      const p = await makeProvider('audit');
      await adminService.setOverride(ADMIN_ID, {
        providerProfileId: p.id,
        maxKm: 180,
        reason: 'Appeal upheld.',
        expiresAt: null,
      });

      const row = await prisma.providerServiceAreaExpansion.findUnique({
        where: { providerProfileId: p.id },
      });
      expect({ by: row.overrideByUserId, why: row.overrideReason, km: row.overrideMaxKm }).toEqual({
        by: ADMIN_ID,
        why: 'Appeal upheld.',
        km: 180,
      });

      const event = await prisma.auditEvent.findFirst({
        where: { type: 'SERVICE_AREA_EXPANSION_OVERRIDE_SET', userId: ADMIN_ID },
      });
      expect(event.metadata).toEqual({
        providerProfileId: p.id,
        overrideMaxKm: 180,
        overrideExpiresAt: null,
        reason: 'Appeal upheld.',
      });
    });

    it('refuses an override above the configured ceiling', async () => {
      const p = await makeProvider('cap');
      await setSetting('provider_service_area_expansion_max_km', 150);
      await expect(
        adminService.setOverride(ADMIN_ID, {
          providerProfileId: p.id,
          maxKm: 400,
          reason: 'too much',
          expiresAt: null,
        }),
      ).rejects.toMatchObject({ details: { reason: 'ABOVE_CEILING' } });
    });

    it('refuses an override with no reason', async () => {
      const p = await makeProvider('noreason');
      await expect(
        adminService.setOverride(ADMIN_ID, {
          providerProfileId: p.id,
          maxKm: 180,
          reason: '   ',
          expiresAt: null,
        }),
      ).rejects.toMatchObject({ details: { reason: 'REASON_REQUIRED' } });
    });

    it('clears cleanly, and clearing an absent override is not an error', async () => {
      const p = await makeProvider('clear');
      await adminService.setOverride(ADMIN_ID, {
        providerProfileId: p.id,
        maxKm: 180,
        reason: 'temporary',
        expiresAt: null,
      });
      await adminService.clearOverride(ADMIN_ID, p.id);
      await adminService.clearOverride(ADMIN_ID, p.id);

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect(decision.allowedMaxKm).toBe(BASE_MAX_KM);

      const cleared = await prisma.auditEvent.count({
        where: { type: 'SERVICE_AREA_EXPANSION_OVERRIDE_CLEARED', userId: ADMIN_ID },
      });
      // Exactly once: the second clear changed nothing and must not claim to.
      expect(cleared).toBe(1);
    });

    it('stops applying once it expires', async () => {
      const p = await makeProvider('expired');
      await adminService.setOverride(ADMIN_ID, {
        providerProfileId: p.id,
        maxKm: 180,
        reason: 'trial period',
        expiresAt: new Date(NOW.getTime() - 1000),
      });

      const decision = await expansionService.describe(subjectFor(p), BASE_MAX_KM, NOW);
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: BASE_MAX_KM,
        reasons: ['OVERRIDE_EXPIRED', 'NO_POLICY_FOR_MARKET'],
      });
    });
  });
});
