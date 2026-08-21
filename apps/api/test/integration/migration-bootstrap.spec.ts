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
    // PascalCase, not snake_case: migration 20260501003603_rename_tables_to_
    // pascal_case renamed every table to match the Prisma model names. This
    // assertion still expected the OLD names and had been failing ever since —
    // invisibly, because the RUN_DB_INTEGRATION gate skips this spec unless CI
    // turns it on.
    const expected = ['Permission', 'Role', 'RolePermission', 'User', 'UserRole'];
    const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      expected,
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual([...expected].sort());
    await prisma.$disconnect();
  });
});
