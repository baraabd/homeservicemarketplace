import { Prisma } from '@homeservicemarketplace/database';
import {
  FINANCIAL_RECORD_KINDS,
  type FinancialReconciliationStatusV1,
} from '@homeservicemarketplace/contracts';

import {
  FinancialReportService,
  UnavailableFinancialReconciliationStatus,
} from './financial-report.service';

const AT = new Date('2026-01-01T12:00:00.000Z');
const END = new Date('2026-02-01T12:00:00.000Z');
const LARGE = 9007199254740993n;

function fixture(rights = ['money:read:self', 'money:review:read']) {
  const reads = () => ({
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  });
  const db = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'actor' }) },
    providerProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'provider-1' }) },
    moneyPaymentIntent: reads(),
    moneyPaymentAttempt: reads(),
    moneyRefundRequest: reads(),
    moneyRefund: reads(),
    providerSubscription: reads(),
    subscriptionPeriod: reads(),
    moneyReconciliationException: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const permissions = { resolveFreshForUser: jest.fn().mockResolvedValue(new Set(rights)) };
  const transactions = {
    run: jest.fn(async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db)),
  };
  const queries = {
    reviewFinancials: jest.fn().mockResolvedValue({
      contractVersion: 'hsm.money.v1',
      source: 'LEDGER',
      totals: [],
      asOf: AT.toISOString(),
    }),
    reviewExceptions: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
  const status = {
    status: jest
      .fn()
      .mockImplementation(() => new UnavailableFinancialReconciliationStatus().status()),
  };
  const service = new FinancialReportService(
    permissions as never,
    transactions as never,
    queries as never,
    status,
  );
  return { service, db, permissions, transactions, queries, status };
}
function confirmation() {
  return {
    id: 'confirmation-1',
    paymentIntentId: 'intent-1',
    amountMinor: LARGE,
    currency: 'XTS',
    ledgerTransactionId: 'ledger-1',
    ledgerTransaction: { status: 'POSTED', currency: 'XTS', bookingId: null, postedAt: AT },
  };
}
function intent(id = 'intent-1') {
  return {
    id,
    status: 'PROCESSING',
    totalMinor: LARGE,
    currency: 'XTS',
    createdAt: AT,
    providerProfileId: 'provider-1',
    confirmation: null,
    receiptMediaAssetId: 'private-receipt',
    externalReference: 'private-rail',
    internalNote: 'private-note',
  };
}
function refund(status = 'RESERVED') {
  return {
    id: 'refund-1',
    status,
    amountMinor: LARGE,
    currency: 'XTS',
    createdAt: AT,
    paymentConfirmationId: 'confirmation-1',
    compensatingLedgerTransactionId: null,
    compensatingLedgerTxn: null,
    paymentConfirmation: { ...confirmation(), paymentIntent: { providerProfileId: 'provider-1' } },
    dispatch: { status: 'UNKNOWN' },
    reasonCode: 'PRIVATE_OPERATOR_REASON',
  };
}

describe('R33 financial read authority and truth', () => {
  it.each(FINANCIAL_RECORD_KINDS)(
    'requires fresh explicit permission before %s reads',
    async (kind) => {
      const f = fixture([]);
      await expect(f.service.records('actor', 'ADMIN', { kind })).rejects.toMatchObject({
        status: 403,
      });
      expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
      expect(f.db.user.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each(['ADMIN', 'PROVIDER'] as const)(
    'requires a current %s base role even when a capability survives',
    async (audience) => {
      const f = fixture();
      f.db.user.findFirst.mockResolvedValue(null);
      await expect(f.service.records('actor', audience)).rejects.toMatchObject({ status: 403 });
      expect(f.db.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
            isActive: true,
            deletedAt: null,
            userRoles: {
              some: {
                role: { name: audience === 'ADMIN' ? 'admin' : 'provider', deletedAt: null },
              },
            },
          }),
        }),
      );
    },
  );

  it('never accepts an unknown audience as admin', async () => {
    const f = fixture();
    await expect(f.service.records('actor', 'FORGED' as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(f.permissions.resolveFreshForUser).not.toHaveBeenCalled();
  });

  it('rechecks revocation on the next request without a permission cache', async () => {
    const f = fixture();
    await f.service.records('actor', 'ADMIN');
    f.permissions.resolveFreshForUser.mockResolvedValue(new Set());
    await expect(f.service.records('actor', 'ADMIN')).rejects.toMatchObject({ status: 403 });
    expect(f.db.moneyPaymentIntent.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(['PAYMENT', 'ATTEMPT', 'REFUND_REQUEST', 'REFUND', 'SUBSCRIPTION'] as const)(
    'hides missing and foreign %s details behind the same 404',
    async (kind) => {
      const f = fixture();
      await expect(f.service.detail('actor', 'PROVIDER', kind, 'foreign')).rejects.toMatchObject({
        status: 404,
        message: 'Financial resource not found.',
      });
      expect(f.db.providerProfile.findFirst).toHaveBeenCalledWith({
        where: { userId: 'actor', deletedAt: null },
        select: { id: true },
      });
    },
  );

  it('preserves integer precision, raw state and explicit unknown transport without leaking private data', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent()]);
    f.db.$queryRaw.mockResolvedValue([{ paymentIntentId: 'intent-1', status: 'UNKNOWN' }]);
    const result = await f.service.records('actor', 'PROVIDER');
    expect(result.items[0]).toMatchObject({
      amount: { amountMinor: '9007199254740993', currency: 'XTS' },
      status: 'PROCESSING',
      confirmationState: 'UNCONFIRMED',
      dispatchStatus: 'UNKNOWN',
      amountMeaning: 'INTENT_TOTAL',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-|receiptMediaAsset|externalReference|internalNote/u,
    );
    expect(f.db.moneyPaymentIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              providerProfileId: 'provider-1',
              providerProfile: { userId: 'actor', deletedAt: null },
            },
            {},
          ],
        },
        take: 21,
      }),
    );
    expect(f.transactions.run).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });

  it('does not infer a confirmation from a succeeded intent without a posting', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([{ ...intent(), status: 'SUCCEEDED' }]);
    expect((await f.service.records('actor', 'ADMIN')).items[0]).toMatchObject({
      confirmationState: 'INCONSISTENT',
      amountMeaning: 'INTENT_TOTAL',
      ledgerTransactionId: null,
    });
  });

  it('only a posted subscription confirmation proves a collection', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue({
      ...intent(),
      status: 'SUCCEEDED',
      confirmation: confirmation(),
    });
    expect((await f.service.detail('actor', 'ADMIN', 'PAYMENT', 'intent-1')).record).toMatchObject({
      confirmationState: 'CONFIRMED',
      amountMeaning: 'CONFIRMED_COLLECTION',
      ledgerTransactionId: 'ledger-1',
    });
  });

  it.each([{ status: 'DRAFT' }, { currency: 'XXX' }, { bookingId: 'booking' }, { postedAt: null }])(
    'refuses inconsistent confirmation posting %#',
    async (bad) => {
      const f = fixture();
      const c = confirmation();
      f.db.moneyPaymentIntent.findMany.mockResolvedValue([
        {
          ...intent(),
          confirmation: { ...c, ledgerTransaction: { ...c.ledgerTransaction, ...bad } },
        },
      ]);
      expect((await f.service.records('actor', 'ADMIN')).items[0]).toMatchObject({
        confirmationState: 'INCONSISTENT',
        ledgerTransactionId: null,
        amountMeaning: 'INTENT_TOTAL',
      });
    },
  );

  it.each([{ amountMinor: 1n }, { currency: 'XXX' }, { paymentIntentId: 'foreign-intent' }])(
    'does not treat a mismatched confirmation as proof %#',
    async (bad) => {
      const f = fixture();
      f.db.moneyPaymentIntent.findMany.mockResolvedValue([
        { ...intent(), confirmation: { ...confirmation(), ...bad } },
      ]);
      expect((await f.service.records('actor', 'ADMIN')).items[0]).toMatchObject({
        confirmationState: 'INCONSISTENT',
        ledgerTransactionId: null,
        amountMeaning: 'INTENT_TOTAL',
      });
    },
  );

  it('does not turn a successful transport attempt into captured revenue', async () => {
    const f = fixture();
    f.db.moneyPaymentAttempt.findMany.mockResolvedValue([
      {
        id: 'attempt',
        createdAt: AT,
        status: 'SUCCEEDED',
        paymentIntentId: 'intent-1',
        paymentIntent: {
          providerProfileId: 'provider-1',
          totalMinor: LARGE,
          currency: 'XTS',
          confirmation: confirmation(),
        },
        dispatch: { status: 'SUCCEEDED' },
      },
    ]);
    expect((await f.service.records('actor', 'ADMIN', { kind: 'ATTEMPT' })).items[0]).toMatchObject(
      {
        amountMeaning: 'ATTEMPT_TOTAL',
        confirmationState: 'NOT_APPLICABLE',
        ledgerTransactionId: null,
      },
    );
  });

  it.each(['RESERVED', 'DISPATCHED', 'FAILED', 'CANCELLED'])(
    'does not report %s refunds as confirmed',
    async (status) => {
      const f = fixture();
      f.db.moneyRefund.findMany.mockResolvedValue([refund(status)]);
      expect(
        (await f.service.records('actor', 'ADMIN', { kind: 'REFUND' })).items[0],
      ).toMatchObject({
        confirmationState: 'UNCONFIRMED',
        amountMeaning: 'REFUND_RESERVED',
        publicReasonCode: null,
      });
    },
  );

  it('requires both a succeeded refund and its posted compensation', async () => {
    const f = fixture();
    f.db.moneyRefund.findMany.mockResolvedValue([refund('SUCCEEDED')]);
    expect(
      (await f.service.records('actor', 'ADMIN', { kind: 'REFUND' })).items[0].confirmationState,
    ).toBe('INCONSISTENT');
    f.db.moneyRefund.findMany.mockResolvedValue([
      {
        ...refund('SUCCEEDED'),
        compensatingLedgerTransactionId: 'refund-ledger',
        compensatingLedgerTxn: confirmation().ledgerTransaction,
      },
    ]);
    expect((await f.service.records('actor', 'ADMIN', { kind: 'REFUND' })).items[0]).toMatchObject({
      confirmationState: 'CONFIRMED',
      amountMeaning: 'CONFIRMED_REFUND',
      ledgerTransactionId: 'refund-ledger',
    });
  });

  it('never projects plan prices as an unconfirmed subscription payment', async () => {
    const f = fixture();
    f.db.providerSubscription.findMany.mockResolvedValue([
      {
        id: 'subscription',
        status: 'PENDING_PAYMENT',
        providerProfileId: 'provider-1',
        createdAt: AT,
        planVersion: { priceMinor: LARGE, currency: 'XTS' },
      },
    ]);
    expect(
      (await f.service.records('actor', 'ADMIN', { kind: 'SUBSCRIPTION' })).items[0],
    ).toMatchObject({ amount: null, amountMeaning: 'UNAVAILABLE', period: null });
  });

  it('projects the latest confirmed subscription period with exact paid amount', async () => {
    const f = fixture();
    f.db.providerSubscription.findMany.mockResolvedValue([
      {
        id: 'subscription',
        status: 'ACTIVE',
        providerProfileId: 'provider-1',
        createdAt: AT,
      },
    ]);
    f.db.$queryRaw.mockResolvedValue([{ id: 'period-1' }]);
    f.db.subscriptionPeriod.findMany.mockResolvedValue([
      {
        subscriptionId: 'subscription',
        startsAt: AT,
        endsAt: END,
        paymentConfirmation: confirmation(),
      },
    ]);
    expect(
      (await f.service.records('actor', 'ADMIN', { kind: 'SUBSCRIPTION' })).items[0],
    ).toMatchObject({
      amount: { amountMinor: LARGE.toString(), currency: 'XTS' },
      amountMeaning: 'CONFIRMED_SUBSCRIPTION_PERIOD',
      period: { startsAt: AT.toISOString(), endsAt: END.toISOString() },
    });
  });

  it('reports missing settlement persistence as unavailable, with no synthetic zero', async () => {
    const f = fixture();
    expect(await f.service.records('actor', 'ADMIN', { kind: 'SETTLEMENT' })).toMatchObject({
      items: [],
      nextCursor: null,
      availability: { state: 'UNAVAILABLE', reason: 'SETTLEMENT_SOURCE_UNAVAILABLE' },
    });
    await expect(f.service.detail('actor', 'ADMIN', 'SETTLEMENT', 'x')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('uses the existing ledger authority and separately timestamps pending obligations', async () => {
    const f = fixture();
    f.db.$queryRaw
      .mockResolvedValueOnce([
        { currency: 'XTS', pending: LARGE.toString(), unknown: '4' },
        { currency: 'XXX', pending: '1', unknown: '0' },
      ])
      .mockResolvedValueOnce([{ currency: 'XTS', requested: '6' }]);
    const result = await f.service.summary('actor');
    expect(f.queries.reviewFinancials).toHaveBeenCalledWith('actor', { currency: undefined });
    expect(result.ledger.asOf).toBe(AT.toISOString());
    expect(result.pendingAsOf).not.toBe(AT.toISOString());
    expect(result.pendingTotals).toEqual([
      {
        currency: 'XTS',
        pending: { amountMinor: LARGE.toString(), currency: 'XTS' },
        unknown: { amountMinor: '4', currency: 'XTS' },
        refundsRequested: { amountMinor: '6', currency: 'XTS' },
      },
      {
        currency: 'XXX',
        pending: { amountMinor: '1', currency: 'XXX' },
        unknown: { amountMinor: '0', currency: 'XXX' },
        refundsRequested: { amountMinor: '0', currency: 'XXX' },
      },
    ]);
    expect(result.reconciliation).toEqual({
      state: 'UNAVAILABLE',
      lastSuccessAt: null,
      runId: null,
      reason: 'R34_INTEGRATION_PENDING',
    });
    expect(
      Object.values(result.capabilities).every(
        (capability) => !capability.available && capability.href === null,
      ),
    ).toBe(true);
  });

  it.each(['9223372036854775808', '1.5', '-1', '1e3'])(
    'fails closed on unrepresentable aggregate %s',
    async (pending) => {
      const f = fixture();
      f.db.$queryRaw.mockResolvedValueOnce([{ currency: 'XTS', pending, unknown: '0' }]);
      await expect(f.service.summary('actor')).rejects.toMatchObject({
        status: 500,
        code: 'INTERNAL_ERROR',
      });
    },
  );

  it('does not substitute zero totals for a failed ledger read', async () => {
    const f = fixture();
    f.queries.reviewFinancials.mockRejectedValue(new Error('read unavailable'));
    await expect(f.service.summary('actor')).rejects.toThrow('read unavailable');
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });

  it.each(['NOT_RUN', 'UNAVAILABLE'] as const)(
    'keeps %s distinct from successfully reconciled zero exceptions',
    async (state) => {
      const f = fixture();
      f.status.status.mockResolvedValue({
        state,
        lastSuccessAt: null,
        runId: null,
        reason: 'RUN_UNAVAILABLE',
      });
      expect(await f.service.reconciliation('actor')).toMatchObject({
        items: [],
        status: { state, lastSuccessAt: null },
      });
    },
  );

  it('requires successful-run provenance before showing AVAILABLE', async () => {
    const f = fixture();
    f.status.status.mockResolvedValue({
      state: 'AVAILABLE',
      lastSuccessAt: null,
      runId: null,
      reason: null,
    });
    await expect(f.service.reconciliation('actor')).rejects.toMatchObject({ status: 500 });
    f.status.status.mockResolvedValue({
      state: 'AVAILABLE',
      lastSuccessAt: AT.toISOString(),
      runId: 'run-1',
      reason: null,
    } satisfies FinancialReconciliationStatusV1);
    expect((await f.service.reconciliation('actor')).status.state).toBe('AVAILABLE');
  });

  it('redacts internal reconciliation resolution text and exposes no command', async () => {
    const f = fixture();
    f.db.moneyReconciliationException.findUnique.mockResolvedValue({
      id: 'ex-1',
      kind: 'AMOUNT_MISMATCH',
      subjectType: 'PaymentConfirmation',
      subjectId: 'confirmation-1',
      detectedAt: AT,
      resolvedAt: END,
      resolutionCode: 'private-note',
    });
    const result = await f.service.exception('actor', 'ex-1');
    expect(result).toMatchObject({
      allowedActions: [],
      exception: { resolvedAt: END.toISOString() },
    });
    expect(JSON.stringify(result)).not.toContain('private-note');
  });
});

describe('R33 stable bounded pagination', () => {
  it.each([0, 51, -1, 1.5, Number.NaN])('rejects invalid limit %s', async (limit) => {
    await expect(fixture().service.records('actor', 'ADMIN', { limit })).rejects.toMatchObject({
      status: 400,
    });
  });
  it.each([
    { currency: 'usd' },
    { currency: 'USD,EUR' },
    { kind: 'booking' },
    { cursor: '' },
    { cursor: 'x'.repeat(2049) },
  ])('rejects invalid selector %#', async (input) => {
    await expect(fixture().service.records('actor', 'ADMIN', input as never)).rejects.toMatchObject(
      { status: 400 },
    );
  });
  it('caps the fetch at limit+1 and binds cursors to actor, kind, currency and audience', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('b'), intent('a')]);
    const first = await f.service.records('actor', 'ADMIN', { limit: 1, currency: 'XTS' });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue({ id: 'b', createdAt: AT });
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('a')]);
    const next = await f.service.records('actor', 'ADMIN', {
      limit: 1,
      currency: 'XTS',
      cursor: first.nextCursor!,
    });
    expect(next.items[0].id).toBe('a');
    expect(next.nextCursor).toBeNull();
    expect(f.db.moneyPaymentIntent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 2,
        where: {
          AND: [
            { currency: 'XTS' },
            { OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lt: 'b' } }] },
          ],
        },
      }),
    );
    for (const [actor, audience, query] of [
      ['other', 'ADMIN', { currency: 'XTS' }],
      ['actor', 'PROVIDER', { currency: 'XTS' }],
      ['actor', 'ADMIN', { currency: 'XXX' }],
      ['actor', 'ADMIN', { currency: 'XTS', kind: 'ATTEMPT' }],
    ] as const) {
      await expect(
        f.service.records(actor, audience, { ...query, cursor: first.nextCursor! }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });
  it('rejects missing anchors and noncanonical cursors', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('b'), intent('a')]);
    const first = await f.service.records('actor', 'ADMIN', { limit: 1 });
    await expect(
      f.service.records('actor', 'ADMIN', { cursor: first.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.records('actor', 'ADMIN', { cursor: first.nextCursor! + '=' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
