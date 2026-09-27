import type { PrismaTx } from '@homeservicemarketplace/database';

/** Account before tokens before sessions: the shared IAM transaction lock order.
 * The lock lives until the caller commits/rolls back. Never call it on an
 * autocommit connection or hold it while sending email or waiting on a browser.
 */
export async function lockAuthAccount(tx: PrismaTx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}
