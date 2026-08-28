/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client is required LAZILY inside beforeAll on purpose: with
 * RUN_DB_INTEGRATION unset this spec is skipped, and a top-level import would
 * still load the generated client and open its pool on every hermetic run.
 * The sibling integration specs use the same pattern.
 */

// Sprint 7 — the backfill, against a REAL Postgres. docs/adr/0007.
//
// Everything asserted here is a property of the DATABASE, not of the script's
// control flow: that a fresh schema starts NULL, that the mapping lands the
// documented values, that a second run writes nothing, that conflicting rows
// survive untouched, and that the new CHECK constraints actually reject the
// rows they exist to reject. A mocked client would restate the code.
//
// Gated by RUN_DB_INTEGRATION=1.

export {};

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Provider lifecycle backfill (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let runBackfill: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const IDS: string[] = [];

  /** This suite's fixture namespace, so its rows are never confused with
   *  another suite's even though the backfill reads the whole table. */
  const P = fixturePrefix('provider-lifecycle');

  /**
   * The backfill is a WHOLE-TABLE mutator and this suite asserts on
   * whole-table totals — `totals.written`, `totals.scanned`, `totals.conflicts`.
   * Those are global by construction, so no fixture namespace can make them
   * parallel-safe: a ProviderProfile created by any other suite between the
   * two `--apply` runs lands in the second run's write count and fails
   * "a second apply writes zero rows".
   *
   * That is the case the advisory lock exists for. EXCLUSIVE here; every other
   * suite that writes ProviderProfile takes it SHARED, so they still run
   * concurrently with each other and only this suite serialises against them.
   */
  let lifecycleLock: HeldLock;
  let grantsLock: HeldLock;

  /** A provider profile with a chosen legacy status and NULL axes, i.e. what
   *  an upgraded (pre-Sprint-7) database looks like. */
  async function legacyProfile(
    id: string,
    status: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    IDS.push(id);
    await prisma.providerProfile.create({
      data: {
        id,
        displayName: `Backfill ${id}`,
        initials: 'BF',
        status,
        ...over,
      },
    });
    return id;
  }

  async function readAxes(id: string) {
    return prisma.providerProfile.findUnique({
      where: { id },
      select: {
        onboardingState: true,
        verificationState: true,
        standingState: true,
        subscriptionTier: true,
        lifecycleSource: true,
        lifecycleSyncedAt: true,
      },
    });
  }

  async function cleanup() {
    if (IDS.length === 0) return;
    await prisma.providerProfile.deleteMany({ where: { id: { in: IDS } } });
    IDS.length = 0;
  }

  beforeAll(async () => {
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'exclusive');
    // Sprint 9B.21 — SHARED on the grant table, and acquired LAST.
    //
    // work-access-enforcement drives the expiry sweep, which scans every
    // ACTIVE grant TABLE-WIDE and can expire one. Holding this shared keeps
    // that suite out while this one has grants alive, while letting every
    // suite here still run beside each other.
    //
    // Last, because the order providerLifecycle -> outbox -> workAccessGrants
    // is the same in every suite. Two suites taking two locks in opposite
    // orders is a deadlock, and a deadlocked CI job looks like a hang.
    grantsLock = await acquireAdvisoryLock('workAccessGrants', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    // Drive the REAL CLI as a child process rather than importing it.
    //
    // Two reasons. The script is ESM (.mjs) and this suite runs under CommonJS
    // ts-jest, so a dynamic import cannot be parsed here. More importantly,
    // spawning exercises the exact command an operator runs — argument
    // parsing, dry-run default and all — instead of a function call that
    // bypasses them.
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const path = require('node:path') as typeof import('node:path');
    const script = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'database',
      'scripts',
      'backfill-provider-lifecycle.mjs',
    );

    runBackfill = (opts: { apply?: boolean } = {}) => {
      const args = [script, '--json', ...(opts.apply ? ['--apply'] : [])];
      const out = execFileSync(process.execPath, args, {
        env: { ...process.env },
        encoding: 'utf8',
      });
      return JSON.parse(out);
    };
  });

  afterEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await grantsLock?.release();
    await lifecycleLock.release();
  });

  // ── schema shape ─────────────────────────────────────────────────────────

  describe('migration produces a backward-compatible schema', () => {
    it('leaves every new axis NULL on a freshly created row', async () => {
      // The backward-compatibility guarantee: an older API build that knows
      // nothing about these columns can still insert a profile.
      const id = await legacyProfile(`${P}fresh`, 'DRAFT');
      const axes = await readAxes(id);

      expect(axes).toEqual({
        onboardingState: null,
        verificationState: null,
        standingState: null,
        subscriptionTier: null,
        lifecycleSource: null,
        lifecycleSyncedAt: null,
      });
    });

    it('keeps the legacy status column writable and authoritative', async () => {
      const id = await legacyProfile(`${P}legacy`, 'ACTIVE');
      const row = await prisma.providerProfile.findUnique({
        where: { id },
        select: { status: true },
      });
      expect(row.status).toBe('ACTIVE');
    });
  });

  // ── mapping ──────────────────────────────────────────────────────────────

  describe('mapping (docs/adr/0007)', () => {
    const CASES: Array<[string, string, string, string]> = [
      ['DRAFT', 'DRAFT', 'GOOD', 'LEGACY_DRAFT'],
      ['PENDING_REVIEW', 'SUBMITTED', 'GOOD', 'LEGACY_PENDING'],
      ['ACTIVE', 'ACCEPTED', 'GOOD', 'LEGACY_APPROVED'],
      ['SUSPENDED', 'ACCEPTED', 'SUSPENDED', 'LEGACY_SUSPENDED'],
      ['REJECTED', 'RETURNED', 'GOOD', 'LEGACY_REJECTED'],
    ];

    it.each(CASES)(
      '%s maps to onboarding=%s standing=%s source=%s',
      async (legacy, onboarding, standing, source) => {
        const id = await legacyProfile(`${P}map-${legacy}`, legacy, {
          // Satisfy the conflict detectors so this case isolates the mapping.
          ...(legacy === 'ACTIVE' || legacy === 'SUSPENDED' ? { reviewedAt: new Date() } : {}),
          ...(legacy === 'PENDING_REVIEW' ? { submittedForReviewAt: new Date() } : {}),
          ...(legacy === 'REJECTED'
            ? { rejectionReason: 'incomplete', reviewedAt: new Date() }
            : {}),
        });
        runBackfill({ apply: true });

        const axes = await readAxes(id);
        expect(axes.onboardingState).toBe(onboarding);
        expect(axes.standingState).toBe(standing);
        expect(axes.lifecycleSource).toBe(source);
      },
    );

    it('records EVERY legacy row as UNVERIFIED, approved ones included', async () => {
      // The load-bearing decision of the whole migration. An admin clicked
      // approve; nobody saw a document. Writing VERIFIED here would fabricate
      // an audit trail for the entire existing supply side.
      const id = await legacyProfile(`${P}unverified`, 'ACTIVE', { reviewedAt: new Date() });
      runBackfill({ apply: true });

      expect((await readAxes(id)).verificationState).toBe('UNVERIFIED');
    });
  });

  // ── dry run ──────────────────────────────────────────────────────────────

  describe('dry run', () => {
    it('writes NOTHING and still reports what it would do', async () => {
      const id = await legacyProfile(`${P}dry`, 'ACTIVE', { reviewedAt: new Date() });

      const report = runBackfill(); // default mode

      expect(report.mode).toBe('dry-run');
      expect(report.totals.written).toBe(0);
      expect(report.totals.wouldWrite).toBeGreaterThan(0);
      expect((await readAxes(id)).lifecycleSource).toBeNull();
    });
  });

  // ── idempotency ──────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('a second apply writes zero rows', async () => {
      await legacyProfile(`${P}idem`, 'ACTIVE', { reviewedAt: new Date() });

      const first = runBackfill({ apply: true });
      const second = runBackfill({ apply: true });

      expect(first.totals.written).toBeGreaterThan(0);
      expect(second.totals.written).toBe(0);
      expect(second.totals.alreadyPopulated).toBeGreaterThanOrEqual(first.totals.written);
    });

    it('never overwrites an axis a human or newer code already set', async () => {
      // Only NULLs are filled. A non-null value was written by something that
      // knew more than the backfill does.
      const id = await legacyProfile(`${P}preset`, 'ACTIVE', {
        reviewedAt: new Date(),
        standingState: 'RESTRICTED',
        lifecycleSource: 'NATIVE',
      });
      runBackfill({ apply: true });

      const axes = await readAxes(id);
      expect(axes.standingState).toBe('RESTRICTED');
      expect(axes.lifecycleSource).toBe('NATIVE');
      // The genuinely-null ones were still filled.
      expect(axes.onboardingState).toBe('ACCEPTED');
    });
  });

  // ── reconciliation ───────────────────────────────────────────────────────

  describe('reconciliation report', () => {
    it('counts conflicting rows and leaves them untouched', async () => {
      // A DRAFT profile that carries a submission stamp contradicts itself.
      // The migration is not entitled to decide which half was the truth.
      const id = await legacyProfile(`${P}conflict`, 'DRAFT', {
        submittedForReviewAt: new Date(),
      });

      const report = runBackfill();

      const mine = report.conflicts.find((c: { id: string }) => c.id === id);
      expect(mine).toBeDefined();
      expect(mine.reasons).toContain('DRAFT_WITH_SUBMISSION_STAMP');
      expect(report.totals.conflicts).toBeGreaterThan(0);
      // Reported, NOT repaired.
      const row = await prisma.providerProfile.findUnique({
        where: { id },
        select: { status: true, submittedForReviewAt: true },
      });
      expect(row.status).toBe('DRAFT');
      expect(row.submittedForReviewAt).not.toBeNull();
    });

    it('breaks counts down by legacy status and target source', async () => {
      await legacyProfile(`${P}c1`, 'DRAFT');
      await legacyProfile(`${P}c2`, 'ACTIVE', { reviewedAt: new Date() });

      const report = runBackfill();

      expect(report.byLegacyStatus.DRAFT).toBeGreaterThanOrEqual(1);
      expect(report.byLegacyStatus.ACTIVE).toBeGreaterThanOrEqual(1);
      expect(report.byTargetSource.LEGACY_DRAFT).toBeGreaterThanOrEqual(1);
      expect(report.byTargetSource.LEGACY_APPROVED).toBeGreaterThanOrEqual(1);
      expect(report.totals.scanned).toBe(
        Object.values(report.byLegacyStatus).reduce((a, b) => (a as number) + (b as number), 0),
      );
    });
  });

  // ── constraints ──────────────────────────────────────────────────────────

  describe('constraints actually reject what they exist to reject', () => {
    it('refuses a grant that expires before it begins', async () => {
      const id = await legacyProfile(`${P}grant-1`, 'ACTIVE', { reviewedAt: new Date() });
      await expect(
        prisma.providerWorkAccessGrant.create({
          data: {
            providerProfileId: id,
            reason: 'TEST',
            grantedAt: new Date('2027-01-01'),
            expiresAt: new Date('2026-01-01'),
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a second LIVE grant with the same reason', async () => {
      // A retried admin action must not produce two live grants for one
      // justification. Different reasons remain legal.
      const id = await legacyProfile(`${P}grant-2`, 'ACTIVE', { reviewedAt: new Date() });
      await prisma.providerWorkAccessGrant.create({
        data: { providerProfileId: id, reason: 'LEGACY_APPROVED' },
      });

      await expect(
        prisma.providerWorkAccessGrant.create({
          data: { providerProfileId: id, reason: 'LEGACY_APPROVED' },
        }),
      ).rejects.toThrow();

      // A different justification is fine.
      await expect(
        prisma.providerWorkAccessGrant.create({
          data: { providerProfileId: id, reason: 'MANUAL_OVERRIDE' },
        }),
      ).resolves.toBeDefined();
    });

    it('refuses half a decision on a submission', async () => {
      const id = await legacyProfile(`${P}sub-1`, 'PENDING_REVIEW', {
        submittedForReviewAt: new Date(),
      });
      await expect(
        prisma.providerOnboardingSubmission.create({
          data: {
            providerProfileId: id,
            policyVersion: 'v1',
            snapshot: {},
            decidedAt: new Date(),
            // decision deliberately omitted
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a submission with a blank policy version', async () => {
      const id = await legacyProfile(`${P}sub-2`, 'PENDING_REVIEW', {
        submittedForReviewAt: new Date(),
      });
      await expect(
        prisma.providerOnboardingSubmission.create({
          data: { providerProfileId: id, policyVersion: '   ', snapshot: {} },
        }),
      ).rejects.toThrow();
    });

    it('accepts a well-formed submission snapshot', async () => {
      const id = await legacyProfile(`${P}sub-3`, 'PENDING_REVIEW', {
        submittedForReviewAt: new Date(),
      });
      await expect(
        prisma.providerOnboardingSubmission.create({
          data: {
            providerProfileId: id,
            policyVersion: 'onboarding-policy@2026-08',
            snapshot: { displayName: 'x', headline: 'y' },
          },
        }),
      ).resolves.toBeDefined();
    });
  });
});
