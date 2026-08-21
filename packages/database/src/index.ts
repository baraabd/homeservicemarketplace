// Generated client lives inside this package (see the `output` on the
// generator in prisma/schema.prisma) rather than in the pnpm virtual store, so
// it travels with `pnpm deploy` into the production bundle. This file is the
// ONLY place the generated client is imported from — every consumer goes
// through this barrel.
import { Prisma, PrismaClient } from '../generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Type alias for an interactive transaction client. Repositories accept
// `PrismaTx | undefined`; passing the same call site through a transaction
// is just a parameter swap. Using Prisma.TransactionClient keeps us aligned
// with whatever Prisma's $transaction(fn) signature exposes.
export type PrismaTx = Prisma.TransactionClient;

export * from '../generated/prisma';

// Re-export seed utilities so they can be unit-tested from the workspace
// without pulling the seed script's top-level main() execution.
export { assertSeedProductionSafe, seed, seedWithTx } from './seed';

// Local-only operator routine for granting customer + provider + admin
// access to an existing User. Exposed for the CLI script in
// `scripts/grant-admin-provider-access.ts` and for unit tests against a
// mocked TransactionClient. There is NO public HTTP path that grants
// admin — this routine is the single sanctioned source of admin-role
// assignment.
// Phase 4 — least-privilege operator routines. The previous combined
// `grantAdminProviderAccess` / `grantWithTx` pair welded three independent
// decisions together (admin role, provider role, provider approval) and is
// replaced by these two.
export {
  grantAdminAccess,
  grantAdminWithTx,
  grantProviderAccess,
  grantProviderWithTx,
  assertGrantNotProductionUnsafe,
} from './admin-access-grant';
export type {
  GrantInput,
  ProviderGrantInput,
  GrantSummaryBase,
  AdminGrantSummary,
  ProviderGrantSummary,
} from './admin-access-grant';
