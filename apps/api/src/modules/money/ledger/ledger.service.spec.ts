import { LedgerService, digestOf } from './ledger.service';

// Hermetic checks of the posting authority's own rules. The invariants the
// database owns are proven against real PostgreSQL in
// test/integration/r15-ledger.integration.spec.ts.

const SYSTEM = { kind: 'SYSTEM', system: 'r15.unit' } as const;

function make(overrides: { rights?: string[] } = {}) {
  const repo = {
    findTransactionByKey: jest.fn().mockResolvedValue(null),
    findAccounts: jest.fn().mockResolvedValue([]),
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
