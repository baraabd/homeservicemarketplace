import { Prisma } from '@homeservicemarketplace/database';
import { MoneyQueryService, type MoneyPageQuery } from './money-query.service';

const AT = new Date('2026-01-01T12:00:00.000Z');
const LATER = new Date('2026-02-01T12:00:00.000Z');
const RIGHTS = ['money:read:self', 'money:review:read'];

function fixture(rights = RIGHTS) {
  const db = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'current-user' }) },
    providerProfile: { findFirst: jest.fn().mockResolvedValue({ id: 'provider-1' }) },
    moneyPaymentIntent: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moneyPaymentAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
    moneyDispatch: { findUnique: jest.fn().mockResolvedValue(null) },
    providerSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moneyEntitlementUsage: {
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    moneyRefundRequest: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moneyReconciliationException: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ledgerEntry: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const permissions = { resolveFreshForUser: jest.fn().mockResolvedValue(new Set(rights)) };
  const transactions = {
    run: jest.fn(async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db)),
  };
  const service = new MoneyQueryService(
    { client: db } as never,
    permissions as never,
    transactions as never,
  );
  return { service, db, permissions, transactions };
}

function intent(id = 'intent-1', currency = 'XTS') {
  return {
    id,
    providerProfileId: 'provider-1',
    planVersionId: 'plan-v1',
    method: 'STRIPE',
    status: 'CREATED',
    currency,
    subtotalMinor: 9007199254740993n,
    discountMinor: 0n,
    totalMinor: 9007199254740993n,
    expiresAt: LATER,
    createdAt: AT,
    idempotencyKey: 'private-command-key',
    requestDigest: 'private-request-digest',
    accountId: 'private-account-id',
  };
}

function refund(id = 'request-1', currency = 'XTS') {
  return {
    id,
    paymentConfirmationId: 'confirmation-1',
    providerProfileId: 'provider-1',
    requestedByUserId: 'owner-1',
    amountMinor: 9007199254740993n,
    currency,
    reasonCode: 'DUPLICATE_PURCHASE',
    status: 'PENDING_POLICY',
    refundId: null,
    createdAt: AT,
    policyVersion: 'private-policy',
    decisionCode: 'private-decision',
    commandId: 'private-command',
  };
}

function subscription(id = 'subscription-1') {
  return {
    id,
    providerProfileId: 'provider-1',
    planVersionId: 'plan-v1',
    status: 'ACTIVE',
    createdAt: AT,
    planVersion: { currency: 'XTS', entitlements: { secret: 'do-not-project' } },
    periods: [{ startsAt: AT, endsAt: LATER }],
  };
}

function exception(id = 'exception-1') {
  return {
    id,
    kind: 'CONFIRMATION_WITHOUT_POSTING',
    subjectType: 'PaymentConfirmation',
    subjectId: 'confirmation-1',
    detectedAt: AT,
    resolvedAt: null,
    resolutionCode: 'private-operator-note',
  };
}

const readCalls: [string, (service: MoneyQueryService) => Promise<unknown>][] = [
  ['intent', (s) => s.intent('owner-1', 'intent-1')],
  ['listIntents', (s) => s.listIntents('owner-1')],
  ['attempt', (s) => s.attempt('owner-1', 'attempt-1')],
  ['subscriptions', (s) => s.subscriptions('owner-1')],
  ['subscription', (s) => s.subscription('owner-1', 'subscription-1')],
  ['usage', (s) => s.usage('owner-1', 'subscription-1')],
  ['refundRequest', (s) => s.refundRequest('owner-1', 'request-1')],
  ['listRefundRequests', (s) => s.listRefundRequests('owner-1')],
  ['reviewIntents', (s) => s.reviewIntents('reviewer-1')],
  ['reviewRefundRequests', (s) => s.reviewRefundRequests('reviewer-1')],
  ['reviewFinancials', (s) => s.reviewFinancials('reviewer-1')],
  ['reviewExceptions', (s) => s.reviewExceptions('reviewer-1')],
  [
    'financialProjection port',
    (s) => s.financialProjection('reviewer-1', { currency: 'XTS', asOf: AT.toISOString() }),
  ],
  ['exceptions port', (s) => s.exceptions('reviewer-1', {})],
];

describe('R24 money reads and authority', () => {
  it.each(readCalls)(
    '%s rejects a revoked base role even when a separate money grant remains',
    async (name, call) => {
      const f = fixture();
      f.db.user.findFirst.mockResolvedValue(null);
      await expect(call(f.service)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      const reviewer = name.startsWith('review') || name.endsWith(' port');
      expect(f.db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: reviewer ? 'reviewer-1' : 'owner-1',
          status: 'ACTIVE',
          isActive: true,
          deletedAt: null,
          userRoles: { some: { role: { name: reviewer ? 'admin' : 'provider', deletedAt: null } } },
        },
        select: { id: true },
      });
      for (const [name, delegate] of Object.entries(f.db)) {
        if (name === 'user') continue;
        for (const query of Object.values(delegate)) expect(query).not.toHaveBeenCalled();
      }
    },
  );

  it.each(readCalls)('%s denies absent grants before accessing money data', async (_name, call) => {
    const f = fixture([]);
    await expect(call(f.service)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(f.permissions.resolveFreshForUser).toHaveBeenCalledTimes(1);
    for (const delegate of Object.values(f.db)) {
      for (const query of Object.values(delegate)) expect(query).not.toHaveBeenCalled();
    }
  });

  it('observes a revoked grant on the next request despite the same actor and resource', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue(intent());
    await expect(f.service.intent('owner-1', 'intent-1')).resolves.toMatchObject({
      id: 'intent-1',
    });
    f.permissions.resolveFreshForUser.mockResolvedValue(new Set());
    await expect(f.service.intent('owner-1', 'intent-1')).rejects.toMatchObject({ status: 403 });
    expect(f.permissions.resolveFreshForUser).toHaveBeenNthCalledWith(2, 'owner-1');
    expect(f.db.moneyPaymentIntent.findFirst).toHaveBeenCalledTimes(1);
  });

  it('uses the current user to resolve ownership and excludes deleted provider profiles', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue(intent());
    await f.service.intent('owner-1', 'intent-1');
    expect(f.db.providerProfile.findFirst).toHaveBeenCalledWith({
      where: { userId: 'owner-1', deletedAt: null },
      select: { id: true },
    });
    expect(f.db.moneyPaymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'intent-1',
          providerProfileId: 'provider-1',
          providerProfile: { userId: 'owner-1', deletedAt: null },
        },
      }),
    );
  });

  it('does not reveal whether a foreign intent exists', async () => {
    const f = fixture();
    await expect(f.service.intent('owner-1', 'foreign-intent')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Money resource not found.',
    });
    expect(f.db.moneyPaymentIntent.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign-intent',
      providerProfileId: 'provider-1',
    });
  });

  it('refuses a missing provider before querying a money resource', async () => {
    const f = fixture();
    f.db.providerProfile.findFirst.mockResolvedValue(null);
    await expect(f.service.intent('owner-1', 'intent-1')).rejects.toMatchObject({ status: 404 });
    expect(f.db.moneyPaymentIntent.findFirst).not.toHaveBeenCalled();
  });

  it('preserves bigint precision and projects only the frozen safe intent fields', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue(intent());
    const wire = await f.service.intent('owner-1', 'intent-1');
    expect(wire.total).toEqual({ amountMinor: '9007199254740993', currency: 'XTS' });
    expect(wire).toMatchObject({
      contractVersion: 'hsm.money.v1',
      status: 'CREATED',
      createdAt: AT.toISOString(),
    });
    expect(JSON.stringify(wire)).not.toMatch(/private-|idempotencyKey|requestDigest|accountId/);
    expect(f.db.moneyPaymentIntent.findFirst.mock.calls[0][0].select).not.toHaveProperty(
      'requestDigest',
    );
  });

  it('keeps transport UNKNOWN distinct from a still-started payment attempt', async () => {
    const f = fixture();
    f.db.moneyPaymentAttempt.findFirst.mockResolvedValue({
      id: 'attempt-1',
      paymentIntentId: 'intent-1',
      attemptNo: 1,
      status: 'STARTED',
      externalAttemptId: 'external-opaque-id',
      createdAt: AT,
      dispatch: {
        status: 'UNKNOWN',
        claimId: 'secret-claim',
        providerIdempotencyKey: 'secret-key',
        observation: { credentials: 'secret' },
      },
    });
    const wire = await f.service.attempt('owner-1', 'attempt-1');
    expect(wire).toMatchObject({
      status: 'STARTED',
      dispatchStatus: 'UNKNOWN',
      externalAttemptId: 'external-opaque-id',
    });
    expect(JSON.stringify(wire)).not.toMatch(/claim|providerIdempotencyKey|observation|secret/);
    expect(f.db.moneyPaymentAttempt.findFirst.mock.calls[0][0].select.dispatch).toEqual({
      select: { status: true },
    });
    expect(f.transactions.run).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(f.permissions.resolveFreshForUser).toHaveBeenCalledWith('owner-1', f.db);
  });

  it('does not look up a dispatch for an inaccessible attempt', async () => {
    const f = fixture();
    await expect(f.service.attempt('owner-1', 'foreign-attempt')).rejects.toMatchObject({
      status: 404,
    });
    expect(f.db.moneyPaymentAttempt.findFirst.mock.calls[0][0].where.paymentIntent).toEqual({
      providerProfileId: 'provider-1',
      providerProfile: { userId: 'owner-1', deletedAt: null },
    });
    expect(f.db.moneyDispatch.findUnique).not.toHaveBeenCalled();
  });

  it('returns a pending policy request without implying a refund or leaking reviewer internals', async () => {
    const f = fixture();
    f.db.moneyRefundRequest.findFirst.mockResolvedValue(refund());
    const wire = await f.service.refundRequest('owner-1', 'request-1');
    expect(wire).toEqual({
      contractVersion: 'hsm.money.v1',
      id: 'request-1',
      paymentConfirmationId: 'confirmation-1',
      amount: { amountMinor: '9007199254740993', currency: 'XTS' },
      reasonCode: 'DUPLICATE_PURCHASE',
      status: 'PENDING_POLICY',
      refundId: null,
    });
    expect(f.db.moneyRefundRequest.findFirst.mock.calls[0][0].where).toEqual({
      id: 'request-1',
      providerProfileId: 'provider-1',
      providerProfile: { userId: 'owner-1', deletedAt: null },
    });
  });

  it('requires the distinct review capability even when the reviewer can read their own money', async () => {
    const f = fixture(['money:read:self']);
    await expect(f.service.reviewIntents('owner-1')).rejects.toMatchObject({ status: 403 });
    await expect(f.service.reviewRefundRequests('owner-1')).rejects.toMatchObject({ status: 403 });
    expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
    expect(f.db.moneyRefundRequest.findMany).not.toHaveBeenCalled();
  });

  it('fails safely on an unrepresentable stored amount instead of rounding it', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue({
      ...intent(),
      totalMinor: 9223372036854775808n,
    });
    await expect(f.service.intent('owner-1', 'intent-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'The stored money projection cannot be represented.',
    });
  });
});

describe('R24 bounded and scoped pagination', () => {
  it.each([0, -1, 51, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid limit %s without reading a page',
    async (limit) => {
      const f = fixture();
      await expect(f.service.listIntents('owner-1', { limit })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
      expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
    },
  );

  it('uses a strict date/id boundary for equal-timestamp rows with no offset pagination', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValueOnce([
      intent('intent-3'),
      intent('intent-2'),
      intent('intent-1'),
    ]);
    const first = await f.service.listIntents('owner-1', { limit: 2, currency: 'XTS' });
    expect(first.items.map((row) => row.id)).toEqual(['intent-3', 'intent-2']);
    expect(first.nextCursor).not.toBeNull();
    f.db.moneyPaymentIntent.findFirst.mockResolvedValue({ id: 'intent-2', createdAt: AT });
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('intent-1')]);
    const second = await f.service.listIntents('owner-1', {
      limit: 2,
      currency: 'XTS',
      cursor: first.nextCursor!,
    });
    expect(second.items.map((row) => row.id)).toEqual(['intent-1']);
    expect(second.nextCursor).toBeNull();
    const query = f.db.moneyPaymentIntent.findMany.mock.calls[1][0];
    expect(query).toMatchObject({
      take: 3,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      where: {
        AND: [
          { providerProfileId: 'provider-1', currency: 'XTS' },
          {
            OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lt: 'intent-2' } }],
          },
        ],
      },
    });
    expect(query).not.toHaveProperty('skip');
    expect(f.db.moneyPaymentIntent.findFirst.mock.calls[0][0].where.AND[0]).toMatchObject({
      providerProfileId: 'provider-1',
      currency: 'XTS',
    });
  });

  it.each(['owner', 'resource', 'currency'] as const)(
    'refuses reuse of a cursor across a different %s scope',
    async (changed) => {
      const f = fixture();
      f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('intent-2'), intent('intent-1')]);
      const page = await f.service.listIntents('owner-1', { limit: 1, currency: 'XTS' });
      if (changed === 'owner')
        f.db.providerProfile.findFirst.mockResolvedValue({ id: 'provider-2' });
      const next: MoneyPageQuery = {
        limit: 1,
        currency: changed === 'currency' ? 'XXX' : 'XTS',
        cursor: page.nextCursor!,
      };
      const action =
        changed === 'resource'
          ? f.service.listRefundRequests('owner-1', next)
          : f.service.listIntents('owner-1', next);
      await expect(action).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(f.db.moneyPaymentIntent.findFirst).not.toHaveBeenCalled();
      expect(f.db.moneyRefundRequest.findFirst).not.toHaveBeenCalled();
      expect(f.db.moneyPaymentIntent.findMany).toHaveBeenCalledTimes(1);
    },
  );

  it('also rejects a validly encoded cursor whose anchor is outside the current database scope', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('intent-2'), intent('intent-1')]);
    const page = await f.service.listIntents('owner-1', { limit: 1 });
    await expect(
      f.service.listIntents('owner-1', { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.moneyPaymentIntent.findMany).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'not-json', '%%%', 'a'.repeat(2049)])(
    'rejects malformed or overlong cursor input',
    async (cursor) => {
      const f = fixture();
      await expect(f.service.listIntents('owner-1', { cursor })).rejects.toMatchObject({
        status: 400,
      });
      expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
    },
  );

  it.each(['xts', 'XTS ', 'US', 'XXXX'])('rejects a noncanonical currency %s', async (currency) => {
    const f = fixture();
    await expect(f.service.listIntents('owner-1', { currency })).rejects.toMatchObject({
      status: 400,
    });
    expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
  });

  it('applies the same bounded page and currency filter to refund requests', async () => {
    const f = fixture();
    f.db.moneyRefundRequest.findMany.mockResolvedValue([refund('request-2'), refund('request-1')]);
    const page = await f.service.listRefundRequests('owner-1', { limit: 1, currency: 'XTS' });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect(f.db.moneyRefundRequest.findMany.mock.calls[0][0]).toMatchObject({
      take: 2,
      where: { AND: [{ providerProfileId: 'provider-1', currency: 'XTS' }, {}] },
    });
    f.db.moneyRefundRequest.findFirst.mockResolvedValue({ id: 'request-2', createdAt: AT });
    f.db.moneyRefundRequest.findMany.mockResolvedValue([refund('request-1')]);
    const second = await f.service.listRefundRequests('owner-1', {
      limit: 1,
      currency: 'XTS',
      cursor: page.nextCursor!,
    });
    expect(second.items[0].id).toBe('request-1');
    expect(second.nextCursor).toBeNull();
  });

  it('binds review pagination to the current reviewer and rechecks revocation', async () => {
    const f = fixture();
    f.db.moneyPaymentIntent.findMany.mockResolvedValue([intent('intent-2'), intent('intent-1')]);
    const page = await f.service.reviewIntents('reviewer-1', { limit: 1 });
    await expect(
      f.service.reviewIntents('reviewer-2', { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    f.permissions.resolveFreshForUser.mockResolvedValue(new Set());
    await expect(
      f.service.reviewIntents('reviewer-1', { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.db.moneyPaymentIntent.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('R24 subscription and grouped usage projections', () => {
  it('reads the immutable purchased version and one latest confirmed period without policy invention', async () => {
    const f = fixture();
    f.db.providerSubscription.findFirst.mockResolvedValue(subscription());
    const wire = await f.service.subscription('owner-1', 'subscription-1');
    expect(wire).toEqual({
      contractVersion: 'hsm.money.v1',
      id: 'subscription-1',
      providerProfileId: 'provider-1',
      planVersionId: 'plan-v1',
      status: 'ACTIVE',
      startsAt: AT.toISOString(),
      endsAt: LATER.toISOString(),
    });
    expect(f.db.providerSubscription.findFirst.mock.calls[0][0].select.periods).toMatchObject({
      take: 1,
      where: { paymentConfirmation: { ledgerTransaction: { status: 'POSTED' } } },
      orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
    });
    expect(JSON.stringify(wire)).not.toMatch(/do-not-project|entitlements|allowed|remaining/);
  });

  it('returns no invented activation dates when there is no confirmed period', async () => {
    const f = fixture();
    f.db.providerSubscription.findFirst.mockResolvedValue({
      ...subscription(),
      status: 'PENDING_PAYMENT',
      periods: [],
    });
    await expect(f.service.subscription('owner-1', 'subscription-1')).resolves.toMatchObject({
      status: 'PENDING_PAYMENT',
      startsAt: null,
      endsAt: null,
    });
  });

  it('bounds subscription lists and filters currency through the purchased plan version', async () => {
    const f = fixture();
    f.db.providerSubscription.findMany.mockResolvedValue([subscription()]);
    await f.service.subscriptions('owner-1', { limit: 5, currency: 'XTS' });
    expect(f.db.providerSubscription.findMany.mock.calls[0][0]).toMatchObject({
      take: 6,
      where: {
        AND: [
          {
            providerProfileId: 'provider-1',
            providerProfile: { userId: 'owner-1', deletedAt: null },
            planVersion: { currency: 'XTS' },
          },
          {},
        ],
      },
    });
  });

  it('groups complete entitlement counts and pages by entitlement key rather than raw events', async () => {
    const f = fixture();
    f.db.providerSubscription.findFirst.mockResolvedValue(subscription());
    f.db.moneyEntitlementUsage.groupBy.mockResolvedValueOnce([
      { entitlementKey: 'bids', _count: { _all: 7 } },
      { entitlementKey: 'photos', _count: { _all: 3 } },
      { entitlementKey: 'requests', _count: { _all: 2 } },
    ]);
    const first = await f.service.usage('owner-1', 'subscription-1', { limit: 2 });
    expect(first.items).toEqual([
      { entitlementKey: 'bids', used: 7 },
      { entitlementKey: 'photos', used: 3 },
    ]);
    expect(f.db.moneyEntitlementUsage.groupBy.mock.calls[0][0]).toEqual({
      by: ['entitlementKey'],
      where: {
        subscriptionId: 'subscription-1',
        subscription: {
          providerProfileId: 'provider-1',
          providerProfile: { userId: 'owner-1', deletedAt: null },
        },
      },
      orderBy: { entitlementKey: 'asc' },
      take: 3,
      _count: { _all: true },
    });
    f.db.moneyEntitlementUsage.findFirst.mockResolvedValue({ entitlementKey: 'photos' });
    f.db.moneyEntitlementUsage.groupBy.mockResolvedValue([
      { entitlementKey: 'requests', _count: { _all: 2 } },
    ]);
    const second = await f.service.usage('owner-1', 'subscription-1', {
      limit: 2,
      cursor: first.nextCursor!,
    });
    expect(second.items).toEqual([{ entitlementKey: 'requests', used: 2 }]);
    expect(second.nextCursor).toBeNull();
    expect(f.db.moneyEntitlementUsage.groupBy.mock.calls[1][0].where).toEqual({
      subscriptionId: 'subscription-1',
      subscription: {
        providerProfileId: 'provider-1',
        providerProfile: { userId: 'owner-1', deletedAt: null },
      },
      entitlementKey: { gt: 'photos' },
    });
  });

  it('rejects a usage cursor from another subscription and a mismatched currency', async () => {
    const f = fixture();
    f.db.providerSubscription.findFirst.mockResolvedValue(subscription());
    f.db.moneyEntitlementUsage.groupBy.mockResolvedValue([
      { entitlementKey: 'bids', _count: { _all: 7 } },
      { entitlementKey: 'photos', _count: { _all: 3 } },
    ]);
    const page = await f.service.usage('owner-1', 'subscription-1', { limit: 1 });
    f.db.providerSubscription.findFirst.mockResolvedValue(subscription('subscription-2'));
    await expect(
      f.service.usage('owner-1', 'subscription-2', { cursor: page.nextCursor! }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.service.usage('owner-1', 'subscription-2', { currency: 'XXX' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.moneyEntitlementUsage.groupBy).toHaveBeenCalledTimes(1);
  });

  it('does not query usage at all for a foreign subscription', async () => {
    const f = fixture();
    await expect(f.service.usage('owner-1', 'foreign-subscription')).rejects.toMatchObject({
      status: 404,
    });
    expect(f.db.moneyEntitlementUsage.groupBy).not.toHaveBeenCalled();
  });
});

describe('R24 ledger review projection and exception port', () => {
  it('derives separate currency totals from posted confirmed ledger and succeeded compensation only', async () => {
    const f = fixture();
    f.db.ledgerEntry.groupBy
      .mockResolvedValueOnce([
        { currency: 'XTS', _sum: { amountMinor: 9007199254740993n } },
        { currency: 'XXX', _sum: { amountMinor: 500n } },
      ])
      .mockResolvedValueOnce([{ currency: 'XXX', _sum: { amountMinor: 200n } }]);
    const wire = await f.service.reviewFinancials('reviewer-1', { asOf: LATER.toISOString() });
    expect(wire).toEqual({
      contractVersion: 'hsm.money.v1',
      source: 'LEDGER',
      asOf: LATER.toISOString(),
      totals: [
        {
          currency: 'XTS',
          captured: { amountMinor: '9007199254740993', currency: 'XTS' },
          refunded: { amountMinor: '0', currency: 'XTS' },
        },
        {
          currency: 'XXX',
          captured: { amountMinor: '500', currency: 'XXX' },
          refunded: { amountMinor: '200', currency: 'XXX' },
        },
      ],
    });
    expect(f.transactions.run).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(f.permissions.resolveFreshForUser).toHaveBeenCalledWith('reviewer-1', f.db);
    expect(f.db.ledgerEntry.groupBy.mock.calls[0][0]).toMatchObject({
      by: ['currency'],
      where: {
        side: 'CREDIT',
        transaction: {
          status: 'POSTED',
          bookingId: null,
          postedAt: { lte: LATER },
          moneyConfirmation: { is: { confirmedAt: { lte: LATER } } },
        },
      },
      _sum: { amountMinor: true },
    });
    expect(f.db.ledgerEntry.groupBy.mock.calls[1][0].where.transaction).toMatchObject({
      status: 'POSTED',
      bookingId: null,
      moneyRefundCompensation: {
        is: {
          status: 'SUCCEEDED',
          updatedAt: { lte: LATER },
          paymentConfirmation: {
            ledgerTransaction: { status: 'POSTED', bookingId: null, postedAt: { lte: LATER } },
          },
        },
      },
    });
    expect(f.db.moneyPaymentIntent.findMany).not.toHaveBeenCalled();
    expect(f.db.moneyRefundRequest.findMany).not.toHaveBeenCalled();
  });

  it('the frozen finance port filters both aggregates to its explicit currency', async () => {
    const f = fixture();
    const wire = await f.service.financialProjection('reviewer-1', {
      currency: 'XTS',
      asOf: AT.toISOString(),
    });
    expect(wire.totals).toEqual([
      {
        currency: 'XTS',
        captured: { amountMinor: '0', currency: 'XTS' },
        refunded: { amountMinor: '0', currency: 'XTS' },
      },
    ]);
    for (const [query] of f.db.ledgerEntry.groupBy.mock.calls)
      expect(query.where.currency).toBe('XTS');
  });

  it.each(['not-a-date', '2026-01-01', '2999-01-01T00:00:00.000Z'])(
    'refuses an invalid/future projection timestamp %s',
    async (asOf) => {
      const f = fixture();
      await expect(f.service.reviewFinancials('reviewer-1', { asOf })).rejects.toMatchObject({
        status: 400,
      });
      expect(f.db.ledgerEntry.groupBy).not.toHaveBeenCalled();
    },
  );

  it('fails closed if aggregate totals exceed the frozen wire range', async () => {
    const f = fixture();
    f.db.ledgerEntry.groupBy.mockResolvedValueOnce([
      { currency: 'XTS', _sum: { amountMinor: 9223372036854775808n } },
    ]);
    await expect(f.service.reviewFinancials('reviewer-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
  });

  it('projects safe exception fields with a deterministic detectedAt/id continuation', async () => {
    const f = fixture();
    f.db.moneyReconciliationException.findMany.mockResolvedValueOnce([
      exception('exception-2'),
      exception('exception-1'),
    ]);
    const first = await f.service.exceptions('reviewer-1', { limit: 1 });
    expect(first.items[0]).toEqual({
      contractVersion: 'hsm.money.v1',
      id: 'exception-2',
      kind: 'CONFIRMATION_WITHOUT_POSTING',
      subjectType: 'PaymentConfirmation',
      subjectId: 'confirmation-1',
      detectedAt: AT.toISOString(),
      resolvedAt: null,
    });
    expect(JSON.stringify(first)).not.toContain('private-operator-note');
    f.db.moneyReconciliationException.findUnique.mockResolvedValue({
      id: 'exception-2',
      detectedAt: AT,
    });
    f.db.moneyReconciliationException.findMany.mockResolvedValue([exception('exception-1')]);
    const second = await f.service.reviewExceptions('reviewer-1', {
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items[0].id).toBe('exception-1');
    expect(second.nextCursor).toBeNull();
    expect(f.db.moneyReconciliationException.findMany.mock.calls[1][0]).toMatchObject({
      where: {
        OR: [{ detectedAt: { lt: AT } }, { detectedAt: AT, id: { lt: 'exception-2' } }],
      },
      orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
  });

  it('refuses an unsupported exception currency filter instead of returning an unfiltered list', async () => {
    const f = fixture();
    await expect(
      f.service.reviewExceptions('reviewer-1', { currency: 'XTS' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.db.moneyReconciliationException.findMany).not.toHaveBeenCalled();
  });

  it('does not leak an arbitrary stored subject type through the frozen exception contract', async () => {
    const f = fixture();
    f.db.moneyReconciliationException.findMany.mockResolvedValue([
      { ...exception(), subjectType: 'RestrictedReceiptContents' },
    ]);
    await expect(f.service.reviewExceptions('reviewer-1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 500,
    });
  });
});
