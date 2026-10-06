import type { PrismaClient, PrismaTx } from '@homeservicemarketplace/database';

import type { LedgerRepository } from '../../src/infrastructure/persistence/ledger/ledger.repository';
import type { AuditService } from '../../src/modules/iam/audit/audit.service';
import type {
  LedgerActor,
  LedgerService,
  PostLedgerTransactionCommand,
} from '../../src/modules/money/ledger/ledger.service';

interface Context {
  prisma: PrismaClient;
  ledger: LedgerService;
  repo: LedgerRepository;
  audit: AuditService;
  system: LedgerActor;
  from: string;
  to: string;
  markerUserId: string;
  roleId: string;
  accountPrefix: string;
  key: (label: string) => string;
}

// Registered within the existing gated ledger suite so it shares that suite's
// fixture namespace and teardown. Imports are type-only: hermetic discovery
// must not instantiate Prisma or assert that a real database was exercised.
export function registerLedgerCallerTransactionCases(context: () => Context): void {
  function command(label: string): PostLedgerTransactionCommand {
    const c = context();
    return {
      idempotencyKey: c.key(label),
      currency: 'USD',
      description: 'Caller transaction acceptance',
      lines: [
        { accountId: c.from, side: 'DEBIT', amountMinor: 17n },
        { accountId: c.to, side: 'CREDIT', amountMinor: 17n },
      ],
    };
  }

  const options = { maxWait: 10_000, timeout: 20_000 };

  async function assertAbsent(id: string, idempotencyKey: string): Promise<void> {
    const { prisma } = context();
    expect(await prisma.ledgerTransaction.count({ where: { idempotencyKey } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { transactionId: id } })).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { metadata: { path: ['ledgerTransactionId'], equals: id } },
      }),
    ).toBe(0);
  }

  it('caller-owned transaction keeps ledger, audit and caller writes invisible until commit', async () => {
    const c = context();
    const input = command('outer_commit');
    const marker = `committed-${input.idempotencyKey}`;
    const result = await c.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: c.markerUserId }, data: { firstName: marker } });
      const posted = await c.ledger.post(c.system, input, tx);
      expect(await tx.ledgerEntry.count({ where: { transactionId: posted.transaction.id } })).toBe(
        2,
      );
      expect(
        await c.prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
      ).toBe(0);
      expect(
        await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } }),
      ).not.toMatchObject({ firstName: marker });
      const replay = await c.ledger.post(c.system, input, tx);
      expect(replay).toMatchObject({ replayed: true, transaction: { id: posted.transaction.id } });
      return posted;
    }, options);
    expect(await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } })).toMatchObject({
      firstName: marker,
    });
    expect(
      await c.prisma.ledgerTransaction.count({
        where: { idempotencyKey: input.idempotencyKey, status: 'POSTED' },
      }),
    ).toBe(1);
    expect(
      await c.prisma.auditEvent.count({
        where: {
          type: 'MONEY_LEDGER_POSTED',
          metadata: { path: ['ledgerTransactionId'], equals: result.transaction.id },
        },
      }),
    ).toBe(1);
  });

  it('caller-owned transaction rolls back posting and audit when the caller fails afterwards', async () => {
    const c = context();
    const input = command('outer_rollback');
    const before = await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } });
    let id = '';
    await expect(
      c.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: c.markerUserId },
          data: { firstName: 'rolled-back-marker' },
        });
        const posted = await c.ledger.post(c.system, input, tx);
        id = posted.transaction.id;
        expect(await tx.ledgerTransaction.count({ where: { id, status: 'POSTED' } })).toBe(1);
        throw new Error('caller failed after ledger posting');
      }, options),
    ).rejects.toThrow('caller failed after ledger posting');
    expect(id).not.toBe('');
    await assertAbsent(id, input.idempotencyKey);
    expect(await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } })).toMatchObject({
      firstName: before.firstName,
    });
    const retry = await c.ledger.post(c.system, input);
    expect(retry.replayed).toBe(false);
  });

  it('caller-owned transaction enlists account creation without opening another transaction', async () => {
    const c = context();
    const accountKey = `${c.accountPrefix}:outer-account`;
    const input = command('outer_account');
    let id = '';
    await expect(
      c.prisma.$transaction(async (tx) => {
        const opened = await c.ledger.openAccount(
          c.system,
          {
            key: accountKey,
            ownerType: 'PLATFORM',
            currency: 'USD',
          },
          tx,
        );
        expect(await c.prisma.ledgerAccount.count({ where: { key: accountKey } })).toBe(0);
        input.lines[0].accountId = opened.account.id;
        id = (await c.ledger.post(c.system, input, tx)).transaction.id;
        throw new Error('caller cancelled account and posting');
      }, options),
    ).rejects.toThrow('caller cancelled account and posting');
    expect(await c.prisma.ledgerAccount.count({ where: { key: accountKey } })).toBe(0);
    await assertAbsent(id, input.idempotencyKey);
  });

  it('caller-owned transaction rolls back a reversal and can retry it after rollback', async () => {
    const c = context();
    const original = await c.ledger.post(c.system, command('outer_reverse_original'));
    const input = {
      idempotencyKey: c.key('outer_reverse'),
      transactionId: original.transaction.id,
      description: 'Caller-owned reversal',
    };
    let id = '';
    await expect(
      c.prisma.$transaction(async (tx) => {
        id = (await c.ledger.reverse(c.system, input, tx)).transaction.id;
        expect(await tx.ledgerTransaction.count({ where: { id, status: 'POSTED' } })).toBe(1);
        throw new Error('caller failed after reversal');
      }, options),
    ).rejects.toThrow('caller failed after reversal');
    await assertAbsent(id, input.idempotencyKey);
    expect(
      await c.prisma.ledgerTransaction.count({
        where: { id: original.transaction.id, status: 'POSTED' },
      }),
    ).toBe(1);
    const retried = await c.prisma.$transaction(
      (tx) => c.ledger.reverse(c.system, input, tx),
      options,
    );
    expect(retried.replayed).toBe(false);
    expect(retried.transaction.reversesTransactionId).toBe(original.transaction.id);
  });

  it('caller-owned transaction rolls back caller writes when ledger audit fails', async () => {
    const c = context();
    const input = command('outer_audit_failure');
    const before = await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } });
    const audit = jest
      .spyOn(c.audit, 'record')
      .mockRejectedValueOnce(new Error('injected audit storage failure'));
    await expect(
      c.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: c.markerUserId },
          data: { firstName: 'audit-failure-marker' },
        });
        await c.ledger.post(c.system, input, tx);
      }, options),
    ).rejects.toThrow('injected audit storage failure');
    audit.mockRestore();
    expect(
      await c.prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    ).toBe(0);
    expect(await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } })).toMatchObject({
      firstName: before.firstName,
    });
  });

  // PLATFORM-TX-1 — the outer transaction is rejected AT COMMIT, after the
  // posting and its audit row were written inside it. Nothing may survive,
  // and the caller must see the failure rather than a posting result.
  it('caller-owned transaction rolls back a posting when the outer COMMIT is rejected', async () => {
    const c = context();
    const input = command('outer_commit_rejected');
    const marker = `ptx_ledger_${input.idempotencyKey
      .slice(-12)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')}`;
    await c.prisma.$executeRawUnsafe(`CREATE TABLE ${marker} (id int)`);
    await c.prisma
      .$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${marker}_reject() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'ptx: ledger commit rejected' USING ERRCODE = 'P0001'; END $$ LANGUAGE plpgsql`);
    await c.prisma
      .$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER ${marker}_t AFTER INSERT ON ${marker}
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${marker}_reject()`);
    try {
      let postedId = '';
      await expect(
        c.prisma.$transaction(async (tx) => {
          postedId = (await c.ledger.post(c.system, input, tx)).transaction.id;
          await tx.$executeRawUnsafe(`INSERT INTO ${marker} VALUES (1)`);
        }, options),
      ).rejects.toThrow('ptx: ledger commit rejected');
      expect(postedId).not.toBe('');
      await assertAbsent(postedId, input.idempotencyKey);
      // The same command is a fresh posting afterwards, not a replay of
      // something that never committed.
      const retried = await c.prisma.$transaction(
        (tx) => c.ledger.post(c.system, input, tx),
        options,
      );
      expect(retried.replayed).toBe(false);
    } finally {
      await c.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${marker}`);
      await c.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${marker}_reject()`);
    }
  });

  it('caller-owned transaction authorizes against its own uncommitted permission state', async () => {
    const c = context();
    const input = command('outer_permission');
    let id = '';
    await expect(
      c.prisma.$transaction(async (tx) => {
        await tx.userRole.create({ data: { userId: c.markerUserId, roleId: c.roleId } });
        id = (await c.ledger.post({ kind: 'USER', userId: c.markerUserId }, input, tx)).transaction
          .id;
        throw new Error('caller cancelled permission and posting');
      }, options),
    ).rejects.toThrow('caller cancelled permission and posting');
    expect(id).not.toBe('');
    await assertAbsent(id, input.idempotencyKey);
    expect(
      await c.prisma.userRole.count({ where: { userId: c.markerUserId, roleId: c.roleId } }),
    ).toBe(0);
  });

  it('caller-owned transaction propagates a real uniqueness failure instead of replaying outside it', async () => {
    const c = context();
    const input = command('outer_unique');
    const winner = await c.ledger.post(c.system, input);
    const before = await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } });
    // Controlled stale-read fault: insert still hits the REAL unique constraint.
    // An enlisted call must not query outside the now-aborted caller transaction.
    const read = jest.spyOn(c.repo, 'findTransactionByKey').mockResolvedValueOnce(null);
    let supplied: PrismaTx | undefined;
    await expect(
      c.prisma.$transaction(async (tx) => {
        supplied = tx;
        await tx.user.update({
          where: { id: c.markerUserId },
          data: { firstName: 'unique-failure-marker' },
        });
        await c.ledger.post(c.system, input, tx);
      }, options),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(input.idempotencyKey, supplied);
    read.mockRestore();
    expect(await c.prisma.user.findUniqueOrThrow({ where: { id: c.markerUserId } })).toMatchObject({
      firstName: before.firstName,
    });
    const retry = await c.prisma.$transaction((tx) => c.ledger.post(c.system, input, tx), options);
    expect(retry).toMatchObject({ replayed: true, transaction: { id: winner.transaction.id } });
    expect(
      await c.prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    ).toBe(1);
  });
}
