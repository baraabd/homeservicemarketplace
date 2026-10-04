import { Prisma, type PrismaTx } from '@homeservicemarketplace/database';

import { LedgerService, digestOf } from './ledger.service';

// Hermetic checks of the posting authority's own rules. The invariants the
// database owns are proven against real PostgreSQL in
// test/integration/r15-ledger.integration.spec.ts.

const SYSTEM = { kind: 'SYSTEM', system: 'r15.unit' } as const;

function make(overrides: { rights?: string[] } = {}) {
  const repo = {
    findAccountByKey: jest.fn().mockResolvedValue(null),
    createAccount: jest.fn(),
    findTransactionByKey: jest.fn().mockResolvedValue(null),
    findTransaction: jest.fn(),
    findAccounts: jest.fn().mockResolvedValue([]),
    bookingExists: jest.fn().mockResolvedValue(true),
    createDraft: jest.fn(),
    insertEntry: jest.fn(),
    markPosted: jest.fn(),
  };
  const tx = { run: jest.fn((fn: (t: unknown) => unknown) => fn({})) };
  const audit = { record: jest.fn() };
  const permissions = {
    resolveFreshForUser: jest.fn().mockResolvedValue(new Set(overrides.rights ?? [])),
  };
  const service = new LedgerService(
    repo as never,
    tx as never,
    audit as never,
    permissions as never,
  );
  return { service, repo, tx, audit, permissions };
}

const command = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: 'unit_key_0000000001',
  currency: 'USD',
  description: 'unit',
  lines: [
    { accountId: 'a1', side: 'DEBIT' as const, amountMinor: 10n },
    { accountId: 'a2', side: 'CREDIT' as const, amountMinor: 10n },
  ],
  ...over,
});

describe('LedgerService (hermetic)', () => {
  it.each([
    ['a short idempotency key', { idempotencyKey: 'short' }],
    [
      'an unbalanced command',
      {
        lines: [
          { accountId: 'a1', side: 'DEBIT', amountMinor: 10n },
          { accountId: 'a2', side: 'CREDIT', amountMinor: 9n },
        ],
      },
    ],
    [
      'a float amount',
      {
        lines: [
          { accountId: 'a1', side: 'DEBIT', amountMinor: 1.5 },
          { accountId: 'a2', side: 'CREDIT', amountMinor: 1.5 },
        ],
      },
    ],
    ['a bad currency', { currency: 'US$' }],
    ['an empty description', { description: '   ' }],
    [
      'more than 100 lines',
      {
        lines: Array.from({ length: 101 }, (_, i) => ({
          accountId: `a${i}`,
          side: i % 2 ? 'CREDIT' : 'DEBIT',
          amountMinor: 1n,
        })),
      },
    ],
  ])('refuses %s before opening a database transaction', async (_label, over) => {
    const { service, tx } = make();
    await expect(service.post(SYSTEM, command(over) as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(tx.run).not.toHaveBeenCalled();
  });

  it('refuses a user without a fresh ledger:post capability and writes nothing', async () => {
    const { service, repo, permissions } = make({ rights: ['ledger:read'] });
    await expect(service.post({ kind: 'USER', userId: 'u1' }, command())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(permissions.resolveFreshForUser).toHaveBeenCalledWith('u1', {});
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it('refuses an unnamed internal caller', async () => {
    const { service, repo } = make();
    await expect(service.post({ kind: 'SYSTEM', system: 'X' }, command())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repo.createDraft).not.toHaveBeenCalled();
  });

  it('enlists authorization, reference checks, posting and audit in the supplied transaction', async () => {
    const { service, repo, tx, audit, permissions } = make({ rights: ['ledger:post'] });
    const callerTx = { ledgerCaller: true } as unknown as PrismaTx;
    repo.findAccounts.mockResolvedValue([
      { id: 'a1', currency: 'USD' },
      { id: 'a2', currency: 'USD' },
    ]);
    repo.createDraft.mockResolvedValue({ id: 'posted-tx' });
    repo.findTransaction.mockResolvedValue({
      id: 'posted-tx',
      kind: 'STANDARD',
      status: 'POSTED',
      currency: 'USD',
      description: 'unit',
      bookingId: 'booking-1',
      externalReference: null,
      reversesTransactionId: null,
      postedAt: new Date('2026-01-01T00:00:00Z'),
      entries: [],
    });

    await expect(
      service.post({ kind: 'USER', userId: 'u1' }, command({ bookingId: 'booking-1' }), callerTx),
    ).resolves.toMatchObject({ replayed: false, transaction: { id: 'posted-tx' } });
    expect(tx.run).not.toHaveBeenCalled();
    expect(permissions.resolveFreshForUser).toHaveBeenCalledWith('u1', callerTx);
    expect(repo.findTransactionByKey).toHaveBeenCalledWith('unit_key_0000000001', callerTx);
    expect(repo.findAccounts).toHaveBeenCalledWith(['a1', 'a2'], callerTx);
    expect(repo.bookingExists).toHaveBeenCalledWith('booking-1', callerTx);
    expect(repo.createDraft).toHaveBeenCalledWith(expect.any(Object), callerTx);
    expect(repo.insertEntry).toHaveBeenCalledTimes(2);
    for (const call of repo.insertEntry.mock.calls) expect(call[1]).toBe(callerTx);
    expect(repo.markPosted).toHaveBeenCalledWith('posted-tx', callerTx);
    expect(audit.record).toHaveBeenCalledWith(expect.any(Object), callerTx);
    expect(repo.findTransaction).toHaveBeenCalledWith('posted-tx', callerTx);
  });

  it('propagates account uniqueness failures without leaving the supplied transaction', async () => {
    const { service, repo, tx } = make();
    const callerTx = { ledgerCaller: true } as unknown as PrismaTx;
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['key'] },
    });
    repo.createAccount.mockRejectedValueOnce(unique);

    await expect(
      service.openAccount(
        SYSTEM,
        { key: 'unit:account', ownerType: 'PLATFORM', currency: 'USD' },
        callerTx,
      ),
    ).rejects.toBe(unique);
    expect(tx.run).not.toHaveBeenCalled();
    expect(repo.findAccountByKey).toHaveBeenCalledTimes(1);
    expect(repo.findAccountByKey).toHaveBeenCalledWith('unit:account', callerTx);
    expect(repo.createAccount).toHaveBeenCalledWith(expect.any(Object), callerTx);
  });

  it('preserves account duplicate recovery after its own transaction has rolled back', async () => {
    const { service, repo, tx } = make();
    const unique = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['key'] },
    });
    const existing = {
      id: 'existing-account',
      key: 'unit:account',
      ownerType: 'PLATFORM',
      ownerUserId: null,
      currency: 'USD',
    };
    repo.findAccountByKey.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
    repo.createAccount.mockRejectedValueOnce(unique);

    await expect(
      service.openAccount(SYSTEM, { key: 'unit:account', ownerType: 'PLATFORM', currency: 'USD' }),
    ).resolves.toEqual({ account: existing, replayed: true });
    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(repo.findAccountByKey).toHaveBeenNthCalledWith(1, 'unit:account', {});
    expect(repo.findAccountByKey).toHaveBeenNthCalledWith(2, 'unit:account');
  });

  it('treats a stored key with a different digest as a conflict and returns nothing of it', async () => {
    const { service, repo } = make();
    repo.findTransactionByKey.mockResolvedValue({
      id: 'secret-tx',
      status: 'POSTED',
      requestDigest: 'f'.repeat(64),
      entries: [],
    });
    const error = await service.post(SYSTEM, command()).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'LEDGER_IDEMPOTENCY_CONFLICT' },
    });
    expect(JSON.stringify(error)).not.toContain('secret-tx');
  });

  it('digests are stable for the same command and differ by actor or amount', () => {
    const base = { op: 'post', actor: 'system:a', lines: [['a1', 'DEBIT', '10']] };
    expect(digestOf(base)).toBe(digestOf({ ...base }));
    expect(digestOf(base)).not.toBe(digestOf({ ...base, actor: 'user:u1' }));
    expect(digestOf(base)).not.toBe(digestOf({ ...base, lines: [['a1', 'DEBIT', '11']] }));
    expect(digestOf(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
