/* eslint-disable @typescript-eslint/no-require-imports */
// Verifies that running seed() twice does not duplicate critical entities.
// Skipped unless RUN_DB_INTEGRATION=1 — same gate as migration-bootstrap.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

d('seed idempotency (postgres)', () => {
  it('running the seed twice keeps row counts stable', async () => {
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');

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

    await db.prisma.$disconnect();
  });
});
