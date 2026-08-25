/* eslint-disable @typescript-eslint/no-require-imports */
export {}; // module marker — see migration-bootstrap.spec.ts.
// Verifies that running seed() twice does not duplicate critical entities.
// Skipped unless RUN_DB_INTEGRATION=1 — same gate as migration-bootstrap.

import { withAdvisoryLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

// Every sibling gated spec sets its own budget; this one inherited jest's 5s
// default, which is not a realistic budget for two full seeds and six counts
// against a real database under a loaded parallel run.
jest.setTimeout(60_000);

d('seed idempotency (postgres)', () => {
  it('running the seed twice keeps row counts stable', async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');

    // EXCLUSIVE for the whole test. The counts below are table-wide reads of
    // rows every seeder shares, so a seed() running in another suite between
    // the two count sets is indistinguishable here from seed() being
    // non-idempotent — the exact property under test.
    await withAdvisoryLock('seed', 'exclusive', async () => {
      await db.seed();
      const rolesA = await db.prisma.role.count();
      const permsA = await db.prisma.permission.count();
      const rpA = await db.prisma.rolePermission.count();

      await db.seed();
      const rolesB = await db.prisma.role.count();
      const permsB = await db.prisma.permission.count();
      const rpB = await db.prisma.rolePermission.count();

      expect(rolesA).toBe(rolesB);
      expect(permsA).toBe(permsB);
      expect(rpA).toBe(rpB);
      expect(rolesA).toBeGreaterThanOrEqual(3);
    });

    await db.prisma.$disconnect();
  });
});
