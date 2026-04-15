import { Prisma, PrismaClient } from '@prisma/client';

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

export * from '@prisma/client';

// Re-export seed utilities so they can be unit-tested from the workspace
// without pulling the seed script's top-level main() execution.
export { assertSeedProductionSafe, seed, seedWithTx } from './seed';
