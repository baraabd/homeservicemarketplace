/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client is required LAZILY inside beforeAll on purpose: with
 * RUN_DB_INTEGRATION unset this spec is skipped, and a top-level import would
 * still load the generated client and open its pool on every hermetic run.
 * The sibling integration specs use the same pattern.
 */

export {};

import { fixturePrefix, withAdvisoryLock } from '../support/db-isolation';

// Sprint 9B.21 — the weekly schedule, against a REAL Postgres.
//
// docs/sprint-09b21/BULK_AVAILABILITY.md
//
// The validation rules have an exhaustive unit suite and the HTTP edge has its
// own e2e file. What is left over — and what is here — is everything those
// cannot see:
//
//   * a bulk update is ATOMIC. A five-day apply that loses a version race
//     leaves the PREVIOUS schedule exactly as it was, not three of five days.
//   * two concurrent bulk applies produce one winner and one 409, and the
//     stored week is one of the two schedules, never a mixture of both.
//   * what is stored reads back identically — the acceptance criterion that
//     the summary after a reload IS the schedule that was saved.
//   * a rejected week writes nothing at all.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Sprint 9B.21 weekly availability (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let wizard: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const P = fixturePrefix('availability-schedule');
  const USER_ID = `${P}user`;
  const PROFILE_ID = `${P}profile`;
  const ZONE = 'Asia/Damascus';

  /** 09:00–17:00 on the given days. The shape a bulk apply produces. */
  function weekOf(days: number[], startMinute = 540, endMinute = 1020) {
    return days.map((dayOfWeek) => ({ dayOfWeek, startMinute, endMinute }));
  }

  /** What the database actually holds, in the order the read model uses. */
  async function storedWeek(): Promise<
    { dayOfWeek: number; startMinute: number; endMinute: number }[]
  > {
    const rows = await prisma.providerAvailabilityInterval.findMany({
      where: { providerProfileId: PROFILE_ID },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
      select: { dayOfWeek: true, startMinute: true, endMinute: true },
    });
    return rows;
  }

  async function draftVersion(): Promise<number> {
    const row = await prisma.providerOnboardingDraft.findUnique({
      where: { providerProfileId: PROFILE_ID },
      select: { version: true },
    });
    return row.version as number;
  }

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
    await prisma.providerAvailabilityInterval.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerOnboardingDraft.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.auditEvent.deleteMany({ where: { userId: USER_ID } });
    await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  }

  beforeAll(async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      PlatformSettingRepository,
    } = require('../../src/infrastructure/persistence/settings/platform-setting.repository');
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
      AuditEventRepository,
    } = require('../../src/infrastructure/persistence/iam/audit-event.repository');
    const { AuditService } = require('../../src/modules/iam/audit/audit.service');
    const {
      ProviderServiceAreaExpansionService,
    } = require('../../src/modules/provider/onboarding/service-area/expansion/provider-service-area-expansion.service');
    const {
      ProviderOnboardingWizardService,
    } = require('../../src/modules/provider/onboarding/provider-onboarding-wizard.service');

    // The same two-method stand-in the sibling integration specs use.
    const prismaService = { client: prisma, isReady: () => true };
    const settings = new PlatformSettingRepository(prismaService);
    const audit = new AuditService(new AuditEventRepository(prismaService));

    wizard = new ProviderOnboardingWizardService(
      new ProviderProfileRepository(prismaService),
      new ProviderOnboardingDraftRepository(prismaService),
      new ServiceCategoryRepository(prismaService),
      new ProviderCategoryApplicationRepository(prismaService),
      new UserRepository(prismaService),
      settings,
      audit,
      new TransactionRunner(prismaService),
      new ProviderServiceAreaExpansionService(prismaService, settings, audit),
    );

    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `${P}provider@example.test`,
        passwordHash: 'x',
        firstName: 'Ada',
        lastName: 'Lovelace',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.providerProfile.create({
      data: {
        id: PROFILE_ID,
        userId: USER_ID,
        displayName: 'Ada Lovelace Services',
        initials: 'AL',
        status: 'DRAFT',
        onboardingState: 'DRAFT',
        serviceAreaCountryCode: 'SY',
      },
    });
    // Opening the wizard creates the draft row, which is what carries the
    // version the concurrency guard turns on.
    await wizard.get(USER_ID);
  });

  // ── the acceptance criterion ─────────────────────────────────────────────

  describe('a whole week in one write', () => {
    it('stores exactly the five days that were sent', async () => {
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: weekOf([0, 1, 2, 3, 4]),
        timezone: ZONE,
      });

      expect(await storedWeek()).toEqual(weekOf([0, 1, 2, 3, 4]));
    });

    it('reads back through the wizard exactly what was written', async () => {
      // "Persisted schedule equals the visible summary after reload" — the
      // read model is what the summary renders from.
      const sent = weekOf([1, 3, 5], 600, 780);
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: sent,
        timezone: ZONE,
      });

      const view = await wizard.get(USER_ID);
      expect(
        view.data.availability
          .map((i: { dayOfWeek: number; startMinute: number; endMinute: number }) => ({
            dayOfWeek: i.dayOfWeek,
            startMinute: i.startMinute,
            endMinute: i.endMinute,
          }))
          .sort((a: { dayOfWeek: number }, b: { dayOfWeek: number }) => a.dayOfWeek - b.dayOfWeek),
      ).toEqual(sent);
    });

    it('stamps every window with the timezone, so one schedule is in one zone', async () => {
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: weekOf([1, 2]),
        timezone: ZONE,
      });

      const zones = await prisma.providerAvailabilityInterval.findMany({
        where: { providerProfileId: PROFILE_ID },
        select: { timezone: true },
      });
      expect([...new Set(zones.map((z: { timezone: string }) => z.timezone))]).toEqual([ZONE]);
    });

    it('replaces rather than accumulates, so applying twice is not ten rows', async () => {
      for (let i = 0; i < 2; i += 1) {
        await wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: await draftVersion(),
          availability: weekOf([0, 1, 2, 3, 4]),
          timezone: ZONE,
        });
      }
      expect(await storedWeek()).toHaveLength(5);
    });

    it('supports several windows on one day, which the editor offers', async () => {
      const split = [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 780, endMinute: 1020 },
      ];
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: split,
        timezone: ZONE,
      });
      expect(await storedWeek()).toEqual(split);
    });

    it('clears the week when an empty schedule is sent', async () => {
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: weekOf([1, 2]),
        timezone: ZONE,
      });
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: [],
        timezone: ZONE,
      });
      expect(await storedWeek()).toEqual([]);
    });
  });

  // ── atomicity ────────────────────────────────────────────────────────────

  describe('a bulk update is all or nothing', () => {
    it('leaves the previous schedule untouched when the new one is refused', async () => {
      const good = weekOf([1, 2, 3]);
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: good,
        timezone: ZONE,
      });

      // Five days, one of which collides with itself. If the write were
      // per-day, four days would land and the fifth would fail — which is
      // exactly the inconsistent state this sprint must make impossible.
      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: await draftVersion(),
          availability: [
            ...weekOf([0, 1, 2, 3]),
            { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
            { dayOfWeek: 4, startMinute: 600, endMinute: 900 },
          ],
          timezone: ZONE,
        }),
      ).rejects.toMatchObject({ status: 422 });

      expect(await storedWeek()).toEqual(good);
    });

    it('writes nothing at all when the timezone is missing', async () => {
      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: await draftVersion(),
          availability: weekOf([1]),
          timezone: null,
        }),
      ).rejects.toMatchObject({ status: 400 });

      expect(await storedWeek()).toEqual([]);
    });

    it('rolls the delete back too, not just the insert', async () => {
      // The write is deleteMany + createMany. A refusal AFTER the delete would
      // leave the provider with no schedule at all — worse than the bad one
      // they tried to save. The version guard is what makes that reachable, so
      // it is what this drives.
      const good = weekOf([1, 2, 3, 4, 5]);
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: good,
        timezone: ZONE,
      });

      const stale = (await draftVersion()) - 1;
      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: stale,
          availability: weekOf([6]),
          timezone: ZONE,
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect(await storedWeek()).toEqual(good);
    });
  });

  // ── concurrency ──────────────────────────────────────────────────────────

  describe('two writers, one schedule', () => {
    it('lets exactly one concurrent bulk apply win, and stores no mixture', async () => {
      const version = await draftVersion();
      const sunThu = weekOf([0, 1, 2, 3, 4], 540, 1020);
      const monFri = weekOf([1, 2, 3, 4, 5], 600, 780);

      const results = await Promise.allSettled([
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version,
          availability: sunThu,
          timezone: ZONE,
        }),
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version,
          availability: monFri,
          timezone: ZONE,
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const conflicts = results.filter(
        (r) => r.status === 'rejected' && (r.reason as { status?: number }).status === 409,
      ).length;
      expect({ fulfilled, conflicts }).toEqual({ fulfilled: 1, conflicts: 1 });

      // And the stored week is ONE of the two, not five days of one plus a
      // sixth from the other.
      const stored = await storedWeek();
      const isOneOrTheOther =
        JSON.stringify(stored) === JSON.stringify(sunThu) ||
        JSON.stringify(stored) === JSON.stringify(monFri);
      expect({ stored, isOneOrTheOther }).toEqual({ stored, isOneOrTheOther: true });
    });

    it('lets the loser succeed once it reads the current version', async () => {
      // The conflict is recoverable, which is what makes a 409 the right
      // answer rather than a failure the provider has to work around.
      const version = await draftVersion();
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version,
        availability: weekOf([0]),
        timezone: ZONE,
      });

      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version,
          availability: weekOf([6]),
          timezone: ZONE,
        }),
      ).rejects.toMatchObject({ status: 409 });

      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: weekOf([6]),
        timezone: ZONE,
      });
      expect(await storedWeek()).toEqual(weekOf([6]));
    });
  });

  // ── the client's rules are not the enforcement point ──────────────────────

  describe('the server refuses what the editor would never send', () => {
    it.each([
      ['an overnight window', [{ dayOfWeek: 1, startMinute: 1320, endMinute: 120 }]],
      ['an inverted window', [{ dayOfWeek: 1, startMinute: 1020, endMinute: 540 }]],
      [
        'an overlap',
        [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
          { dayOfWeek: 1, startMinute: 600, endMinute: 900 },
        ],
      ],
      [
        'an exact duplicate',
        [
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
          { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        ],
      ],
    ])('refuses %s and stores nothing', async (_name, availability) => {
      // The web module cannot import this validator, so its rules are a
      // mirror. This is the guard that makes a drift surface as a refusal
      // rather than as a silently-persisted bad schedule.
      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: await draftVersion(),
          availability,
          timezone: ZONE,
        }),
      ).rejects.toMatchObject({ status: 422 });
      expect(await storedWeek()).toEqual([]);
    });

    it('accepts two windows that TOUCH, because the end is exclusive', async () => {
      const touching = [
        { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
        { dayOfWeek: 1, startMinute: 720, endMinute: 1020 },
      ];
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: touching,
        timezone: ZONE,
      });
      expect(await storedWeek()).toEqual(touching);
    });

    it('accepts a window that ends at midnight', async () => {
      // 1440 is what the editor's end control offers and a clock input cannot.
      const untilMidnight = [{ dayOfWeek: 5, startMinute: 1080, endMinute: 1440 }];
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: untilMidnight,
        timezone: ZONE,
      });
      expect(await storedWeek()).toEqual(untilMidnight);
    });

    it('refuses an unknown timezone rather than storing an unresolvable one', async () => {
      await expect(
        wizard.patchStep(USER_ID, 'AVAILABILITY', {
          version: await draftVersion(),
          availability: weekOf([1]),
          timezone: 'Asia/Damascusx',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await storedWeek()).toEqual([]);
    });
  });

  // ── the timezone re-stamp ────────────────────────────────────────────────

  describe('changing the zone', () => {
    it('moves the whole week onto the new zone, never half of it', async () => {
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: weekOf([1, 2, 3]),
        timezone: ZONE,
      });

      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        timezone: 'Europe/Stockholm',
      });

      const rows = await prisma.providerAvailabilityInterval.findMany({
        where: { providerProfileId: PROFILE_ID },
        select: { timezone: true, dayOfWeek: true },
      });
      expect({
        zones: [...new Set(rows.map((r: { timezone: string }) => r.timezone))],
        count: rows.length,
      }).toEqual({ zones: ['Europe/Stockholm'], count: 3 });
    });

    it('leaves the hours themselves exactly where they were', async () => {
      // Re-stamping is a change of LABEL, not of time. Shifting the minutes
      // would silently move somebody's working day.
      const before = weekOf([1, 2, 3], 600, 780);
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        availability: before,
        timezone: ZONE,
      });
      await wizard.patchStep(USER_ID, 'AVAILABILITY', {
        version: await draftVersion(),
        timezone: 'Europe/Stockholm',
      });
      expect(await storedWeek()).toEqual(before);
    });
  });
});
