/* eslint-disable @typescript-eslint/no-require-imports -- Database dependencies load only inside the integration gate. */
import type { PrismaClient, PrismaTx } from '@homeservicemarketplace/database';

import { fixturePrefix } from '../support/db-isolation';

const dbDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
jest.setTimeout(120_000);

// R18 (D-19) — the ADR 0013 live-grant count and the bounded backfill, against
// real PostgreSQL. The backfill is platform-wide, so every case runs in a
// transaction that is rolled back: other suites' providers never receive a
// grant they did not ask for.
class Rollback extends Error {}

dbDescribe('R18 work-access readiness and backfill (real PostgreSQL)', () => {
  const prefix = fixturePrefix('r18-work-access');
  let prisma: PrismaClient;
  let db: typeof import('@homeservicemarketplace/database');

  beforeAll(() => {
    db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
  });

  // Runs `work` and always rolls back. A failure inside is rethrown as
  // itself, so the report names the assertion, not the rollback.
  async function rolledBack(work: (tx: PrismaTx) => Promise<void>): Promise<void> {
    let failure: unknown;
    await prisma
      .$transaction(
        async (tx) => {
          try {
            await work(tx as PrismaTx);
          } catch (error) {
            failure = error;
          }
          throw new Rollback();
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    if (failure) throw failure;
  }

  async function profile(
    tx: PrismaTx,
    tag: string,
    data: Record<string, unknown> = {},
  ): Promise<string> {
    const id = `${prefix}${tag}`;
    await tx.providerProfile.create({
      data: { id, displayName: `Fixture ${tag}`, initials: 'FX', status: 'ACTIVE', ...data },
    });
    return id;
  }

  async function grant(
    tx: PrismaTx,
    providerProfileId: string,
    data: Record<string, unknown> = {},
  ) {
    await tx.providerWorkAccessGrant.create({
      data: {
        providerProfileId,
        status: 'ACTIVE',
        reason: 'VERIFIED_DOCUMENTS',
        source: 'VERIFIED_DOCUMENTS',
        // Explicitly in the past: the client and database clocks may differ.
        grantedAt: new Date(Date.now() - 60_000),
        ...data,
      },
    });
  }

  it('counts exactly the working providers that enforcement would deny', async () => {
    await rolledBack(async (tx) => {
      const base = await db.readWorkAccessReadiness(tx);
      expect(base.missingLiveGrant).toBe(base.workingProviders - base.withLiveGrant);

      const live = await profile(tx, 'live', { verificationState: 'VERIFIED' });
      await grant(tx, live);
      await grant(tx, await profile(tx, 'expired'), {
        grantedAt: new Date(Date.now() - 180_000),
        expiresAt: new Date(Date.now() - 120_000),
      });
      await grant(tx, await profile(tx, 'revoked'), { revokedAt: new Date(), status: 'REVOKED' });
      await grant(tx, await profile(tx, 'future'), { grantedAt: new Date(Date.now() + 3_600_000) });
      await profile(tx, 'none');
      // Not working under the legacy rule, so not counted at all.
      await profile(tx, 'suspended', { status: 'SUSPENDED' });
      await profile(tx, 'deleted', { deletedAt: new Date() });

      const now = await db.readWorkAccessReadiness(tx);
      expect(now.workingProviders - base.workingProviders).toBe(5);
      expect(now.withLiveGrant - base.withLiveGrant).toBe(1);
      expect(now.missingLiveGrant - base.missingLiveGrant).toBe(4);
      expect(now.verified - base.verified).toBe(1);
      expect(now.workAccessReady).toBe(false);
    });
  });

  it('backfills in bounded, restartable runs that log first and invent no verification', async () => {
    await rolledBack(async (tx) => {
      const a = await profile(tx, 'missing-a', { verificationState: 'UNVERIFIED' });
      const b = await profile(tx, 'missing-b');
      const before = await db.readWorkAccessReadiness(tx);
      expect(before.missingLiveGrant).toBeGreaterThanOrEqual(2);

      const first = await db.backfillMissingGrantsWithTx(tx, 1);
      expect(first.granted).toBe(1);
      expect(first.after.missingLiveGrant).toBe(before.missingLiveGrant - 1);

      // Restart until done; every run is bounded and takes only missing rows.
      let runs = 0;
      for (let left = first.after.missingLiveGrant; left > 0; runs += 1) {
        const next = await db.backfillMissingGrantsWithTx(tx, db.MAX_BACKFILL_LIMIT);
        expect(next.granted).toBeLessThanOrEqual(db.MAX_BACKFILL_LIMIT);
        left = next.after.missingLiveGrant;
        expect(runs).toBeLessThan(1000);
      }
      const done = await db.readWorkAccessReadiness(tx);
      expect(done.workAccessReady).toBe(true);
      // A finished backfill selects nothing more.
      expect((await db.backfillMissingGrantsWithTx(tx, 10)).granted).toBe(0);

      for (const id of [a, b]) {
        const grants = await tx.providerWorkAccessGrant.findMany({
          where: { providerProfileId: id },
        });
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
          status: 'ACTIVE',
          reason: 'LEGACY_APPROVED',
          source: 'LEGACY_BACKFILL',
          caseId: null,
          grantedByUserId: null,
          expiresAt: null,
          revokedAt: null,
        });
        const logs = await tx.dataRemediationLog.findMany({
          where: { migration: db.BACKFILL_MIGRATION_TAG, entityId: id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('GRANTED_LEGACY_WORK_ACCESS');
        expect(logs[0].createdAt.getTime()).toBeLessThanOrEqual(grants[0].createdAt.getTime());
      }
      // Access is granted; verification is not.
      expect(
        (await tx.providerProfile.findUniqueOrThrow({ where: { id: a } })).verificationState,
      ).toBe('UNVERIFIED');
      expect(
        (await tx.providerProfile.findUniqueOrThrow({ where: { id: b } })).verificationState,
      ).toBeNull();
    });
  });

  it('never grants a provider who does not work under the legacy rule', async () => {
    await rolledBack(async (tx) => {
      const suspended = await profile(tx, 'not-working', { status: 'SUSPENDED' });
      await db.backfillMissingGrantsWithTx(tx, db.MAX_BACKFILL_LIMIT);
      expect(
        await tx.providerWorkAccessGrant.count({ where: { providerProfileId: suspended } }),
      ).toBe(0);
    });
  });
});
