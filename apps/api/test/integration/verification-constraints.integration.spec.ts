/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client is required LAZILY inside beforeAll on purpose: with
 * RUN_DB_INTEGRATION unset this spec is skipped, and a top-level import would
 * still load the generated client and open its pool on every hermetic run.
 * The sibling integration specs use the same pattern.
 */

export {};

import { acquireAdvisoryLock, fixturePrefix, type HeldLock } from '../support/db-isolation';

// Sprint 9B.2 — the two PARTIAL unique indexes, against a REAL Postgres.
//
// Migration 20260825060000_sprint09b2_verification_policy_and_case_constraints.
//
// These indexes exist because the service layer cannot enforce them. Both rules
// are "at most one row like this", and every service-layer version of that is a
// read followed by a write — two concurrent requests both read "none", both
// write, and there are now two. So the properties worth testing are the ones a
// unit test provably cannot reach: the behaviour of PostgreSQL under a real
// race, and the NULL semantics of a unique index.
//
// Prisma cannot express partial indexes, so `prisma migrate diff` is blind to
// them. Nothing but this file would notice if the migration were dropped.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Sprint 9B.2 verification constraints (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  /** This suite's fixture namespace. */
  const P = fixturePrefix('verification-constraints');
  /** Policy versions this suite owns. Real format, reserved scope. */
  const V = (n: string): string => `2099.01-${P.replace(/-$/, '')}-${n}-v1`;

  /**
   * ISO 3166-1 alpha-2 user-assigned code. Deliberately NOT the global
   * (NULL, NULL, NULL) scope: a seeded default policy lives there, and a test
   * that fought the seed for it would be testing the seed.
   *
   * `ZZ` still leaves providerType and categoryId NULL, so two rows in this
   * scope are exactly the NULLS NOT DISTINCT case — without that clause
   * Postgres would consider them distinct and both would insert.
   */
  const SCOPE_COUNTRY = 'ZZ';

  let lifecycleLock: HeldLock;

  async function cleanup(): Promise<void> {
    await prisma.verificationCase.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.verificationRequirementPolicy.deleteMany({
      where: { country: SCOPE_COUNTRY },
    });
  }

  const REQUIREMENTS = { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true };

  function policyRow(version: string, over: Record<string, unknown> = {}) {
    return {
      version,
      country: SCOPE_COUNTRY,
      providerType: null,
      categoryId: null,
      requirements: REQUIREMENTS,
      publishedAt: new Date('2099-01-01T00:00:00Z'),
      ...over,
    };
  }

  async function makeProvider(id: string): Promise<string> {
    await prisma.providerProfile.create({
      data: { id, displayName: `Constraint ${id}`, initials: 'CC', status: 'DRAFT' },
    });
    return id;
  }

  function caseRow(providerProfileId: string, id: string, over: Record<string, unknown> = {}) {
    return {
      id,
      providerProfileId,
      state: 'DRAFT',
      policyVersion: V('base'),
      ...over,
    };
  }

  beforeAll(async () => {
    // SHARED: this suite writes ProviderProfile rows, which the lifecycle
    // backfill suite scans table-wide (see test/support/db-isolation.ts).
    lifecycleLock = await acquireAdvisoryLock('providerLifecycle', 'shared');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;

    await cleanup();
    // The cases below carry a policyVersion FK, so the policy must exist.
    await prisma.verificationRequirementPolicy.create({ data: policyRow(V('base')) });
  });

  afterEach(async () => {
    await prisma.verificationCase.deleteMany({
      where: { providerProfileId: { startsWith: P } },
    });
    await prisma.providerProfile.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.verificationRequirementPolicy.deleteMany({
      where: { country: SCOPE_COUNTRY, version: { not: V('base') } },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await lifecycleLock.release();
  });

  // ── one live policy per scope ────────────────────────────────────────────

  describe('verification_policy_one_live_per_scope_uniq', () => {
    it('refuses a second live policy for the same scope', async () => {
      await expect(
        prisma.verificationRequirementPolicy.create({ data: policyRow(V('dup')) }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('treats NULL scope columns as EQUAL, not distinct', async () => {
      // The load-bearing assertion for NULLS NOT DISTINCT. Both rows share
      // country='ZZ' and leave providerType and categoryId NULL. Under
      // Postgres' DEFAULT unique-index semantics those NULLs make the rows
      // distinct and BOTH would insert — which is how a duplicate global
      // default would have slipped through.
      const rows = await prisma.verificationRequirementPolicy.findMany({
        where: { country: SCOPE_COUNTRY, retiredAt: null },
        select: { version: true, providerType: true, categoryId: true },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].providerType).toBeNull();
      expect(rows[0].categoryId).toBeNull();

      await expect(
        prisma.verificationRequirementPolicy.create({
          data: policyRow(V('null-scope'), { providerType: null, categoryId: null }),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('a rejected publish leaves no partial row behind', async () => {
      const before = await prisma.verificationRequirementPolicy.count({
        where: { country: SCOPE_COUNTRY },
      });
      await expect(
        prisma.verificationRequirementPolicy.create({ data: policyRow(V('partial')) }),
      ).rejects.toMatchObject({ code: 'P2002' });
      const after = await prisma.verificationRequirementPolicy.count({
        where: { country: SCOPE_COUNTRY },
      });
      expect(after).toBe(before);
      expect(
        await prisma.verificationRequirementPolicy.findUnique({ where: { version: V('partial') } }),
      ).toBeNull();
    });

    it('lets a retired policy step out of the uniqueness rule', async () => {
      // The ordinary way to correct a policy: retire, then publish. History
      // stays queryable because the index only covers un-retired rows.
      await prisma.verificationRequirementPolicy.update({
        where: { version: V('base') },
        data: { retiredAt: new Date('2099-06-01T00:00:00Z') },
      });

      await expect(
        prisma.verificationRequirementPolicy.create({ data: policyRow(V('replacement')) }),
      ).resolves.toMatchObject({ version: V('replacement') });

      const all = await prisma.verificationRequirementPolicy.findMany({
        where: { country: SCOPE_COUNTRY },
        select: { version: true },
      });
      expect(all).toHaveLength(2);

      // Restore the fixture for the remaining tests.
      await prisma.verificationRequirementPolicy.delete({ where: { version: V('replacement') } });
      await prisma.verificationRequirementPolicy.update({
        where: { version: V('base') },
        data: { retiredAt: null },
      });
    });

    it('allows a DIFFERENT scope alongside the same country', async () => {
      // providerType is part of the scope, so this is a different row, not a
      // duplicate — the resolver scores it as more specific.
      await expect(
        prisma.verificationRequirementPolicy.create({
          data: policyRow(V('business'), { providerType: 'BUSINESS' }),
        }),
      ).resolves.toMatchObject({ version: V('business') });
    });

    it('two SIMULTANEOUS publishes of the same scope leave exactly one', async () => {
      await prisma.verificationRequirementPolicy.delete({ where: { version: V('base') } });

      const results = await Promise.allSettled([
        prisma.verificationRequirementPolicy.create({ data: policyRow(V('race-a')) }),
        prisma.verificationRequirementPolicy.create({ data: policyRow(V('race-b')) }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'P2002' });

      const live = await prisma.verificationRequirementPolicy.findMany({
        where: { country: SCOPE_COUNTRY, retiredAt: null },
      });
      expect(live).toHaveLength(1);

      // Restore the fixture.
      await prisma.verificationRequirementPolicy.deleteMany({ where: { country: SCOPE_COUNTRY } });
      await prisma.verificationRequirementPolicy.create({ data: policyRow(V('base')) });
    });
  });

  // ── one active case per provider ─────────────────────────────────────────

  describe('verification_case_one_active_per_provider_uniq', () => {
    it.each(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'])(
      'refuses a second open case when one is %s',
      async (state) => {
        const pp = await makeProvider(`${P}one-open-${state}`);
        await prisma.verificationCase.create({ data: caseRow(pp, `${P}c-${state}-1`, { state }) });

        await expect(
          prisma.verificationCase.create({ data: caseRow(pp, `${P}c-${state}-2`) }),
        ).rejects.toMatchObject({ code: 'P2002' });
      },
    );

    it.each(['REJECTED', 'EXPIRED'])('lets a provider try again after a %s case', async (state) => {
      // The reason this is a PARTIAL index. A plain unique on
      // providerProfileId would have been expressible in schema.prisma and
      // would permanently bar a rejected provider from re-applying.
      const pp = await makeProvider(`${P}retry-${state}`);
      await prisma.verificationCase.create({ data: caseRow(pp, `${P}r-${state}-1`, { state }) });

      await expect(
        prisma.verificationCase.create({ data: caseRow(pp, `${P}r-${state}-2`) }),
      ).resolves.toMatchObject({ id: `${P}r-${state}-2` });
    });

    it('does not let a VERIFIED case block a later re-verification', async () => {
      // VERIFIED is finished, not open. `reverify` closes it and opens a fresh
      // case; if VERIFIED were in the index predicate that would be impossible.
      const pp = await makeProvider(`${P}verified`);
      await prisma.verificationCase.create({
        data: caseRow(pp, `${P}v-1`, { state: 'VERIFIED' }),
      });

      await expect(
        prisma.verificationCase.create({ data: caseRow(pp, `${P}v-2`) }),
      ).resolves.toMatchObject({ id: `${P}v-2` });
    });

    it('scopes the rule per provider, not globally', async () => {
      const a = await makeProvider(`${P}scope-a`);
      const b = await makeProvider(`${P}scope-b`);
      await prisma.verificationCase.create({ data: caseRow(a, `${P}s-a`) });

      await expect(
        prisma.verificationCase.create({ data: caseRow(b, `${P}s-b`) }),
      ).resolves.toMatchObject({ id: `${P}s-b` });
    });

    it('two SIMULTANEOUS creates leave exactly one open case', async () => {
      // The race the service layer cannot win on its own: both requests read
      // "no active case", both proceed, and only the database can arbitrate.
      const pp = await makeProvider(`${P}race`);

      const results = await Promise.allSettled([
        prisma.verificationCase.create({ data: caseRow(pp, `${P}race-1`) }),
        prisma.verificationCase.create({ data: caseRow(pp, `${P}race-2`) }),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'P2002' });

      const open = await prisma.verificationCase.findMany({
        where: {
          providerProfileId: pp,
          state: { in: ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED'] },
        },
      });
      expect(open).toHaveLength(1);
    });

    it('a refused create leaves no partial row behind', async () => {
      const pp = await makeProvider(`${P}partial-case`);
      await prisma.verificationCase.create({ data: caseRow(pp, `${P}pc-1`) });

      await expect(
        prisma.verificationCase.create({ data: caseRow(pp, `${P}pc-2`) }),
      ).rejects.toMatchObject({ code: 'P2002' });

      expect(await prisma.verificationCase.findUnique({ where: { id: `${P}pc-2` } })).toBeNull();
      expect(await prisma.verificationCase.count({ where: { providerProfileId: pp } })).toBe(1);
    });
  });

  // ── idempotency key ──────────────────────────────────────────────────────

  describe('VerificationCase_providerProfileId_idempotencyKey_key', () => {
    it('refuses the same key twice for one provider', async () => {
      const pp = await makeProvider(`${P}idem`);
      await prisma.verificationCase.create({
        data: caseRow(pp, `${P}i-1`, { state: 'REJECTED', idempotencyKey: 'k-1' }),
      });

      await expect(
        prisma.verificationCase.create({
          data: caseRow(pp, `${P}i-2`, { state: 'REJECTED', idempotencyKey: 'k-1' }),
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('lets two providers use the same client-generated key', async () => {
      // Scoped per provider precisely so a client-side value cannot collide
      // across accounts and leak one provider's case to another.
      const a = await makeProvider(`${P}idem-a`);
      const b = await makeProvider(`${P}idem-b`);
      await prisma.verificationCase.create({
        data: caseRow(a, `${P}ia-1`, { idempotencyKey: 'shared-key' }),
      });

      await expect(
        prisma.verificationCase.create({
          data: caseRow(b, `${P}ib-1`, { idempotencyKey: 'shared-key' }),
        }),
      ).resolves.toMatchObject({ id: `${P}ib-1` });
    });

    it('allows any number of keyless cases for one provider', async () => {
      // NULLs stay DISTINCT on this index — the opposite of the policy scope
      // index, and deliberately so: a case created without a key is not a
      // replay of every other keyless case.
      const pp = await makeProvider(`${P}keyless`);
      await prisma.verificationCase.create({
        data: caseRow(pp, `${P}k-1`, { state: 'REJECTED', idempotencyKey: null }),
      });

      await expect(
        prisma.verificationCase.create({
          data: caseRow(pp, `${P}k-2`, { state: 'EXPIRED', idempotencyKey: null }),
        }),
      ).resolves.toMatchObject({ id: `${P}k-2` });
    });
  });
});
