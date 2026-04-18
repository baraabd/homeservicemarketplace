/* eslint-disable @typescript-eslint/no-require-imports */
export {}; // module marker — keeps `shouldRun` / `d` out of global scope (collides with sibling integration specs otherwise).
// Integration scaffold: verifies the IAM tables actually exist after running
// `prisma migrate deploy` against the configured DATABASE_URL.
//
// Skipped unless RUN_DB_INTEGRATION=1 so plain `pnpm test` stays hermetic.
// To run:  RUN_DB_INTEGRATION=1 pnpm --filter @homeservicemarketplace/api test

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

d('migration bootstrap (postgres)', () => {
  it('exposes the iam tables after migrations are applied', async () => {
    const { prisma } =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      ['users', 'roles', 'permissions', 'user_roles', 'role_permissions'],
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(['permissions', 'role_permissions', 'roles', 'user_roles', 'users']);
    await prisma.$disconnect();
  });
});
