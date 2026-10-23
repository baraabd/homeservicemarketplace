import {
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type MoneyPurchaseRequestV1,
} from '@homeservicemarketplace/contracts';
import {
  MoneyCommandService,
  moneyCommandDigest,
  validateMoneyPurchase,
} from './money-command.service';
import {
  PrismaMoneyCatalogFactory,
  UnavailableMoneyCollectionAdapter,
  UnavailableMoneyConfiguration,
  UnavailableMoneyReceiptAcceptance,
} from '../ports/collection.port';
import { UnavailableMoneyActivationParticipant } from '../ports/activation.port';
import { UnavailableMoneyRefundAdapter, UnavailableMoneyRefundPolicy } from '../ports/refund.port';

// Contract components only. PostgreSQL concurrency/rollback and real HTTP
// guards are exercised by test/integration/r24-money-api.integration.spec.ts.
const KEY = 'r24_unit_command_000001';
const REQUEST: MoneyPurchaseRequestV1 = {
  contractVersion: MONEY_CONTRACT_VERSION,
  planVersionId: 'plan-v1',
  method: 'STRIPE',
};
const BINDING = {
  planVersionId: 'plan-v1',
  method: 'STRIPE' as const,
  currency: 'XTS',
  adapterId: 'r24.contract-component',
  mode: 'SANDBOX' as const,
  accountReference: 'r24.synthetic-account',
  debitAccountId: 'debit-account',
  creditAccountId: 'credit-account',
  configVersion: 'r24.synthetic-v1',
  quoteTtlSeconds: 300,
};

function harness() {
  const commands = new Map<string, Record<string, unknown>>();
  const baseRoles = new Set(['provider', 'admin']);
  const rights = new Set([
    'money:purchase:self',
    'money:refund:request:self',
    'money:receipt:review',
    'money:refund:review',
  ]);
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    user: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; userRoles?: { some: { role: { name: string } } } };
        }) => {
          const requiredRole = where.userRoles?.some.role.name;
          return requiredRole && !baseRoles.has(requiredRole) ? null : { id: where.id };
        },
      ),
    },
    providerProfile: {
      findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve({
          id: `provider-${where.userId}`,
          userId: where.userId,
          status: 'ACTIVE',
          deletedAt: null,
        }),
      ),
    },
    moneyCommand: {
      findUnique: jest.fn(({ where }: { where: { idempotencyKey: string } }) =>
        Promise.resolve(commands.get(where.idempotencyKey) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        commands.set(data.idempotencyKey as string, data);
        return Promise.resolve(data);
      }),
    },
    moneyPaymentIntent: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          ...data,
          id: 'intent-a',
          status: 'CREATED',
          createdAt: new Date('2026-10-01T00:00:00Z'),
        }),
      ),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    moneyIntentBinding: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue(BINDING),
    },
    moneyPaymentAttempt: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    moneyDispatch: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    moneyExternalEvent: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    moneyPaymentConfirmation: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    moneyRefund: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
    mediaAsset: { findUnique: jest.fn() },
  };
  const tx = { run: jest.fn((fn: (t: unknown) => unknown) => fn(db)) };
  const permissions = {
    resolveFreshForUser: jest.fn().mockImplementation(() => Promise.resolve(new Set(rights))),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const ledger = { post: jest.fn() };
  const activation = { confirmAndActivate: jest.fn() };
  const configuration = { resolve: jest.fn().mockResolvedValue(BINDING) };
  const catalog = {
    findPublishedPlanVersion: jest.fn().mockResolvedValue({
      id: 'plan-v1',
      planId: 'synthetic',
      billingInterval: 'MONTHLY',
      priceMinor: 9007199254740993n,
      currency: 'XTS',
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      retiredAt: null,
    }),
    findCouponByCode: jest.fn().mockResolvedValue(null),
    countCouponRedemptions: jest.fn().mockResolvedValue(0),
    countProviderCouponRedemptions: jest.fn().mockResolvedValue(0),
  };
  const catalogFactory = { forTransaction: jest.fn(() => catalog) };
  const collection = {
    isConfigured: jest.fn().mockReturnValue(true),
    createOrResume: jest.fn(),
    validateAndNormalizeExternalEvent: jest.fn(),
  };
  const receipts = { isConfigured: jest.fn().mockReturnValue(false), accept: jest.fn() };
  const participant = { isConfigured: jest.fn().mockReturnValue(false), activatePeriod: jest.fn() };
  const refundPolicy = { authorizeReservation: jest.fn() };
  const refunds = {
    isConfigured: jest.fn().mockReturnValue(false),
    submit: jest.fn(),
    query: jest.fn(),
  };
  const service = new MoneyCommandService(
    { client: db } as never,
    tx as never,
    permissions as never,
    audit as never,
    ledger as never,
    activation as never,
    configuration as never,
    catalogFactory as never,
    collection as never,
    receipts as never,
    participant as never,
    refundPolicy as never,
    refunds as never,
  );
  return {
    service,
    db,
    tx,
    permissions,
    rights,
    baseRoles,
    commands,
    audit,
    ledger,
    activation,
    configuration,
    catalog,
    catalogFactory,
    collection,
    receipts,
    participant,
    refundPolicy,
    refunds,
  };
}

describe('R24 money command boundary (contract components)', () => {
  it.each(['r24_event_', 'r24_process_', 'r24_refund_result_', 'r31_'])(
    'reserves the exact internal command namespace %s before transaction access',
    async (prefix) => {
      const h = harness();
      await expect(
        h.service.quote('user-a', `${prefix}1234567890123456`, REQUEST),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { reason: 'MONEY_INTERNAL_KEY_RESERVED' },
      });
      expect(h.tx.run).not.toHaveBeenCalled();
    },
  );

  it.each([
    { amountMinor: '1' },
    { currency: 'USD' },
    { actorId: 'another-user' },
    { providerProfileId: 'another-provider' },
    { accountId: 'unowned-account' },
    { mode: 'LIVE' },
    { total: { amountMinor: '1', currency: 'XTS' } },
    { contractVersion: 'hsm.money.v2' },
    { method: 'toString' },
    { planVersionId: '' },
  ])('rejects an untrusted purchase selector %j before opening a transaction', async (change) => {
    const h = harness();
    await expect(
      h.service.createIntent('user-a', KEY, { ...REQUEST, ...change } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(h.tx.run).not.toHaveBeenCalled();
  });

  it('canonicalizes a coupon selector without accepting a quoted total', () => {
    expect(validateMoneyPurchase({ ...REQUEST, couponCode: '  coupon_a  ' })).toEqual({
      ...REQUEST,
      couponCode: 'COUPON_A',
    });
  });

  it('canonicalizes an omitted coupon emitted as an own undefined DTO field', async () => {
    const h = harness();
    const dto = { ...REQUEST, couponCode: undefined };
    expect(Object.hasOwn(dto, 'couponCode')).toBe(true);
    const first = await h.service.quote('user-a', KEY, dto);
    expect(await h.service.quote('user-a', KEY, REQUEST)).toEqual(first);
    expect(h.db.moneyCommand.create).toHaveBeenCalledTimes(1);
    expect(Object.hasOwn(validateMoneyPurchase(dto), 'couponCode')).toBe(false);
  });

  it('returns exact large server prices and keeps the private binding out of the wire', async () => {
    const h = harness();
    const quote = await h.service.quote('user-a', KEY, REQUEST);
    expect(quote.total).toEqual({ amountMinor: '9007199254740993', currency: 'XTS' });
    expect(JSON.stringify(quote)).not.toContain('synthetic-account');
    expect(h.catalogFactory.forTransaction).toHaveBeenCalledWith(h.db);
    expect(h.permissions.resolveFreshForUser).toHaveBeenCalledWith('user-a', h.db);
    expect(h.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ moneyAction: 'QUOTE' }) }),
      h.db,
    );
  });

  it('replays the immutable original quote after configuration and catalog change', async () => {
    const h = harness();
    const first = await h.service.quote('user-a', KEY, REQUEST);
    h.configuration.resolve.mockResolvedValue(null);
    h.catalog.findPublishedPlanVersion.mockResolvedValue(null);
    expect(await h.service.quote('user-a', KEY, REQUEST)).toEqual(first);
    expect(h.configuration.resolve).toHaveBeenCalledTimes(1);
    expect(h.catalog.findPublishedPlanVersion).toHaveBeenCalledTimes(1);
    expect(h.db.moneyCommand.create).toHaveBeenCalledTimes(1);
    expect(h.permissions.resolveFreshForUser).toHaveBeenCalledTimes(2);
  });

  it('takes the amount and binding from the server when creating an intent', async () => {
    const h = harness();
    const response = await h.service.createIntent('user-a', KEY, REQUEST);
    expect(response.total.amountMinor).toBe('9007199254740993');
    expect(h.db.moneyIntentBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentIntentId: 'intent-a',
        accountReference: BINDING.accountReference,
        mode: 'SANDBOX',
      }),
    });
    const saved = h.commands.get(KEY)!;
    expect(h.db.moneyPaymentIntent.create.mock.calls[0]?.[0].data.requestDigest).toBe(
      saved.requestDigest,
    );
    expect(JSON.stringify(response)).not.toContain('accountReference');
    const envelope = saved.response as { value: unknown; request: unknown; authority: unknown };
    expect(envelope.value).toEqual(response);
    expect(saved.requestDigest).toBe(
      moneyCommandDigest({ userId: 'user-a' }, 'CREATE_INTENT', REQUEST, envelope.authority),
    );
  });

  it.each(['money:purchase:self', 'all'])(
    'checks a revoked grant before reading a stored response (%s)',
    async () => {
      const h = harness();
      await h.service.quote('user-a', KEY, REQUEST);
      h.rights.clear();
      await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(h.db.moneyCommand.findUnique).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses a no-longer-active user even when permission lookup returns a grant', async () => {
    const h = harness();
    h.db.user.findFirst.mockResolvedValue(null);
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.db.moneyCommand.create).not.toHaveBeenCalled();
  });

  it('does not replay a command after the provider ownership link disappears', async () => {
    const h = harness();
    await h.service.quote('user-a', KEY, REQUEST);
    h.db.providerProfile.findUnique.mockResolvedValue(null as never);
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an immutable command replay after the base provider role is revoked', async () => {
    const h = harness();
    await h.service.quote('user-a', KEY, REQUEST);
    h.baseRoles.delete('provider');
    expect(h.rights.has('money:purchase:self')).toBe(true);
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.db.moneyCommand.findUnique).toHaveBeenCalledTimes(1);
    expect(h.db.user.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'user-a',
        status: 'ACTIVE',
        isActive: true,
        deletedAt: null,
        userRoles: { some: { role: { name: 'provider', deletedAt: null } } },
      },
      select: { id: true },
    });
  });

  it('requires the current admin base role even if a custom role retains receipt-review permission', async () => {
    const h = harness();
    h.baseRoles.delete('admin');
    expect(h.rights.has('money:receipt:review')).toBe(true);
    await expect(
      h.service.acceptReceipt('user-a', KEY, {
        contractVersion: MONEY_CONTRACT_VERSION,
        paymentIntentId: 'intent-a',
        receiptMediaAssetId: 'receipt-a',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(h.receipts.accept).not.toHaveBeenCalled();
    expect(h.db.moneyCommand.findUnique).not.toHaveBeenCalled();
  });

  it.each(['actor', 'action', 'plan', 'coupon'])(
    'conflicts when a global command key changes %s',
    async (change) => {
      const h = harness();
      await h.service.quote('user-a', KEY, REQUEST);
      const promise =
        change === 'action'
          ? h.service.createIntent('user-a', KEY, REQUEST)
          : h.service.quote(
              change === 'actor' ? 'user-b' : 'user-a',
              KEY,
              change === 'plan'
                ? { ...REQUEST, planVersionId: 'plan-v2' }
                : change === 'coupon'
                  ? { ...REQUEST, couponCode: 'DIFFERENT' }
                  : REQUEST,
            );
      await expect(promise).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'MONEY_IDEMPOTENCY_CONFLICT' },
      });
      expect(h.db.moneyCommand.create).toHaveBeenCalledTimes(1);
      expect(h.db.moneyPaymentIntent.create).not.toHaveBeenCalled();
    },
  );

  it('detects corruption of the frozen private authority snapshot before replay', async () => {
    const h = harness();
    await h.service.quote('user-a', KEY, REQUEST);
    (h.commands.get(KEY)!.response as { authority: unknown }).authority = { amount: '1' };
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it.each([
    { configuration: null, reason: 'MONEY_CONFIGURATION_UNAVAILABLE' },
    { configuration: { ...BINDING, mode: 'LIVE' }, reason: 'MONEY_LIVE_DISABLED' },
  ])(
    'fails closed without approved sandbox configuration: $reason',
    async ({ configuration, reason }) => {
      const h = harness();
      h.configuration.resolve.mockResolvedValue(configuration);
      await expect(h.service.createIntent('user-a', KEY, REQUEST)).rejects.toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        details: { reason },
      });
      expect(h.db.moneyPaymentIntent.create).not.toHaveBeenCalled();
      expect(h.collection.createOrResume).not.toHaveBeenCalled();
    },
  );

  it.each([
    { currency: 'XXX' },
    { planVersionId: 'plan-other' },
    { debitAccountId: BINDING.creditAccountId },
    { quoteTtlSeconds: 0 },
  ])('rejects a mismatched server binding %j', async (change) => {
    const h = harness();
    h.configuration.resolve.mockResolvedValue({ ...BINDING, ...change });
    await expect(h.service.createIntent('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'MONEY_BINDING_MISMATCH' },
    });
    expect(h.db.moneyPaymentIntent.create).not.toHaveBeenCalled();
  });

  it.each([{ adapterId: 'a'.repeat(81) }, { configVersion: 'v'.repeat(101) }])(
    'validates bounded configuration identifiers before persistence: %j',
    async (change) => {
      const h = harness();
      h.configuration.resolve.mockResolvedValue({ ...BINDING, ...change });
      await expect(h.service.createIntent('user-a', KEY, REQUEST)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(h.db.moneyPaymentIntent.create).not.toHaveBeenCalled();
    },
  );

  it('accepts a two-character controlled refund reason before fresh authorization', async () => {
    const h = harness();
    h.rights.clear();
    await expect(
      h.service.requestRefund('user-a', KEY, {
        contractVersion: MONEY_CONTRACT_VERSION,
        paymentConfirmationId: 'confirmation-a',
        amount: toMoneyWire({ amountMinor: 1n, currency: 'XTS' }),
        reasonCode: 'AB',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('never advertises an unconfigured collection component as operational', async () => {
    const h = harness();
    h.collection.isConfigured.mockReturnValue(false);
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toMatchObject({
      status: 503,
      details: { reason: 'MONEY_COLLECTION_UNAVAILABLE' },
    });
    expect(h.db.moneyCommand.create).not.toHaveBeenCalled();
  });

  it('rejects zero-price activation intent creation without selecting a free-plan policy', async () => {
    const h = harness();
    h.catalog.findPublishedPlanVersion.mockResolvedValue({
      ...(await h.catalog.findPublishedPlanVersion()),
      priceMinor: 0n,
    });
    await expect(h.service.createIntent('user-a', KEY, REQUEST)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { reason: 'MONEY_ZERO_TOTAL_POLICY_BLOCKED' },
    });
    expect(h.db.moneyPaymentIntent.create).not.toHaveBeenCalled();
  });

  it('does not cross an owner boundary to resume an attempt', async () => {
    const h = harness();
    h.db.moneyPaymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-foreign',
      paymentIntentId: 'intent-foreign',
    });
    h.db.moneyPaymentIntent.findFirst.mockResolvedValue(null);
    await expect(
      h.service.resumeCollection('user-a', KEY, 'attempt-foreign'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(h.db.moneyDispatch.findUnique).not.toHaveBeenCalled();
    expect(h.collection.createOrResume).not.toHaveBeenCalled();
  });

  it.each(['1.0', '01', '-1', '9223372036854775808', '1e3'])(
    'rejects a noncanonical refund amount %s',
    async (amountMinor) => {
      const h = harness();
      await expect(
        h.service.requestRefund('user-a', KEY, {
          contractVersion: MONEY_CONTRACT_VERSION,
          paymentConfirmationId: 'confirmation-a',
          amount: { amountMinor, currency: 'XTS' },
          reasonCode: 'TEST_REQUEST',
        } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(h.tx.run).not.toHaveBeenCalled();
    },
  );

  it('does not persist a malformed adapter event or call activation', async () => {
    const h = harness();
    h.collection.validateAndNormalizeExternalEvent.mockResolvedValue({
      status: 'SUCCEEDED',
      paymentIntentId: 'intent-a',
    });
    await expect(
      h.service.acceptExternalEvent({
        adapterId: BINDING.adapterId,
        mode: 'SANDBOX',
        accountReference: BINDING.accountReference,
        payload: {},
        headers: {},
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.db.moneyExternalEvent.create).not.toHaveBeenCalled();
    expect(h.activation.confirmAndActivate).not.toHaveBeenCalled();
  });

  it('rejects live events before invoking external validation', async () => {
    const h = harness();
    await expect(
      h.service.acceptExternalEvent({
        adapterId: BINDING.adapterId,
        mode: 'LIVE',
        accountReference: BINDING.accountReference,
        payload: {},
        headers: {},
      }),
    ).rejects.toMatchObject({ details: { reason: 'MONEY_LIVE_DISABLED' } });
    expect(h.collection.validateAndNormalizeExternalEvent).not.toHaveBeenCalled();
  });

  it('propagates a failed command audit instead of claiming acceptance', async () => {
    const h = harness();
    h.audit.record.mockRejectedValue(new Error('contract audit failure'));
    await expect(h.service.quote('user-a', KEY, REQUEST)).rejects.toThrow('contract audit failure');
    // This double checks error propagation only. Atomic rollback is a real DB test.
  });
});

describe('R24 evidence recovery (contract components)', () => {
  const intent = {
    id: 'intent-a',
    providerProfileId: 'provider-user-a',
    planVersionId: BINDING.planVersionId,
    method: BINDING.method,
    currency: 'XTS',
    totalMinor: 1000n,
    status: 'PROCESSING',
  };
  const event = {
    id: 'event-a',
    adapterId: BINDING.adapterId,
    mode: BINDING.mode,
    accountReference: BINDING.accountReference,
    externalEventId: 'event-external-a',
    externalConfirmationId: 'economic-confirmation-a',
    externalOperationId: 'operation-a',
    paymentIntentId: intent.id,
    paymentAttemptId: 'attempt-a',
    source: 'PROVIDER_WEBHOOK',
    amountMinor: 1000n,
    currency: 'XTS',
    confirmedAt: new Date('2026-10-01T00:00:00Z'),
    receiptMediaAssetId: null,
    reviewerUserId: null,
    status: 'RECEIVED',
    response: null,
  };
  const result = {
    contractVersion: MONEY_CONTRACT_VERSION,
    paymentConfirmationId: 'confirmation-a',
    subscriptionId: 'subscription-a',
    subscriptionPeriodId: 'period-a',
    ledgerTransactionId: 'posting-a',
    periodStartsAt: '2026-10-01T00:00:00.000Z',
    periodEndsAt: '2026-11-01T00:00:00.000Z',
    status: 'ACTIVE',
    replayed: false,
  };

  function eventHarness() {
    const h = harness();
    h.db.moneyPaymentIntent.findUnique.mockResolvedValue(intent);
    h.db.moneyPaymentAttempt.findUnique.mockResolvedValue({
      id: 'attempt-a',
      paymentIntentId: intent.id,
      status: 'STARTED',
    });
    h.db.moneyDispatch.findUnique.mockResolvedValue({
      id: 'dispatch-a',
      kind: 'COLLECTION',
      paymentIntentId: intent.id,
      paymentAttemptId: 'attempt-a',
      externalOperationId: 'operation-a',
    });
    h.db.moneyExternalEvent.findUnique.mockResolvedValue(event);
    h.db.moneyExternalEvent.findUniqueOrThrow.mockResolvedValue(event);
    h.db.moneyExternalEvent.create.mockResolvedValue(event);
    h.participant.isConfigured.mockReturnValue(true);
    h.activation.confirmAndActivate.mockResolvedValue(result);
    return h;
  }

  it('rechecks the manual-event reviewer base role before activation processing', async () => {
    const h = eventHarness();
    const manual = {
      ...event,
      source: 'MANUAL_REVIEW',
      paymentAttemptId: null,
      externalOperationId: null,
      receiptMediaAssetId: 'receipt-a',
      reviewerUserId: 'reviewer-a',
    };
    h.db.moneyExternalEvent.findUnique.mockResolvedValue(manual);
    h.db.moneyExternalEvent.findUniqueOrThrow.mockResolvedValue(manual);
    h.db.moneyPaymentIntent.findUnique.mockResolvedValue({ ...intent, method: 'CASH_OFFICE' });
    h.db.providerProfile.findUnique.mockResolvedValue({
      id: intent.providerProfileId,
      userId: 'user-a',
      status: 'ACTIVE',
      deletedAt: null,
    });
    h.db.mediaAsset.findUnique.mockResolvedValue({
      ownerUserId: 'user-a',
      visibility: 'RESTRICTED',
      scanState: 'CLEAN',
      uploadCompletedAt: event.confirmedAt,
      sha256: 'a'.repeat(64),
      deletedAt: null,
      erasureStartedAt: null,
    });
    h.baseRoles.delete('admin');
    await expect(h.service.processExternalEvent(manual.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.activation.confirmAndActivate).not.toHaveBeenCalled();
    expect(h.participant.activatePeriod).not.toHaveBeenCalled();
    expect(h.db.moneyExternalEvent.update).not.toHaveBeenCalled();
  });

  it.each(['CASH_OFFICE', 'SHAM_CASH', 'SYRIATEL_CASH'])(
    'requires receipt-review evidence for a %s obligation',
    async (method) => {
      const h = eventHarness();
      h.db.moneyPaymentIntent.findUnique.mockResolvedValue({ ...intent, method });
      h.collection.validateAndNormalizeExternalEvent.mockResolvedValue({
        contractVersion: MONEY_CONTRACT_VERSION,
        adapterId: event.adapterId,
        mode: event.mode,
        accountReference: event.accountReference,
        externalEventId: event.externalEventId,
        externalConfirmationId: event.externalConfirmationId,
        externalOperationId: event.externalOperationId,
        paymentIntentId: event.paymentIntentId,
        paymentAttemptId: event.paymentAttemptId,
        source: event.source,
        amount: { amountMinor: '1000', currency: 'XTS' },
        confirmedAt: event.confirmedAt.toISOString(),
        receiptMediaAssetId: null,
        reviewerUserId: null,
      });
      await expect(
        h.service.acceptExternalEvent({
          adapterId: BINDING.adapterId,
          mode: BINDING.mode,
          accountReference: BINDING.accountReference,
          payload: {},
          headers: {},
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'MONEY_BINDING_MISMATCH' } });
      expect(h.db.moneyExternalEvent.create).not.toHaveBeenCalled();
      expect(h.activation.confirmAndActivate).not.toHaveBeenCalled();
    },
  );

  it('reuses the economic confirmation across distinct delivery events and proves prior activation', async () => {
    const h = eventHarness();
    await expect(h.service.processExternalEvent(event.id)).resolves.toEqual(result);
    const second = { ...event, id: 'event-b', externalEventId: 'event-external-b' };
    h.db.moneyExternalEvent.findUnique.mockResolvedValue(second);
    h.db.moneyExternalEvent.findUniqueOrThrow.mockResolvedValue(second);
    h.db.moneyExternalEvent.findFirst.mockResolvedValue({
      ...event,
      status: 'PROCESSED',
      response: result,
    });
    h.activation.confirmAndActivate.mockResolvedValue({ ...result, replayed: true });
    h.participant.isConfigured.mockReturnValue(false);
    await expect(h.service.processExternalEvent(second.id)).resolves.toEqual({
      ...result,
      replayed: true,
    });
    expect(h.activation.confirmAndActivate.mock.calls[0]?.[0].idempotencyKey).toBe(
      h.activation.confirmAndActivate.mock.calls[1]?.[0].idempotencyKey,
    );
    expect(h.participant.activatePeriod).toHaveBeenCalledTimes(1);
    expect(h.db.moneyExternalEvent.update).toHaveBeenCalledTimes(2);
    expect(h.db.moneyExternalEvent.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: 'PROCESSED',
        paymentIntentId: intent.id,
        externalConfirmationId: event.externalConfirmationId,
        adapterId: event.adapterId,
        mode: event.mode,
        accountReference: event.accountReference,
      }),
    });
  });

  it.each([
    null,
    {
      ...event,
      status: 'PROCESSED',
      response: { ...result, subscriptionPeriodId: 'orphan-period' },
    },
  ])(
    'refuses to acknowledge a replayed R19 confirmation without matching completed R24 evidence',
    async (prior) => {
      const h = eventHarness();
      h.activation.confirmAndActivate.mockResolvedValue({ ...result, replayed: true });
      h.db.moneyExternalEvent.findFirst.mockResolvedValue(prior);
      await expect(h.service.processExternalEvent(event.id)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'MONEY_CONFIRMATION_RECONCILIATION_REQUIRED' },
      });
      expect(h.participant.activatePeriod).not.toHaveBeenCalled();
      expect(h.db.moneyExternalEvent.update).not.toHaveBeenCalled();
    },
  );

  it('retains verified refund evidence on a local result failure and resumes locally through an adapter outage', async () => {
    const h = harness();
    const refund = {
      id: 'refund-a',
      paymentConfirmationId: 'confirmation-a',
      amountMinor: 250n,
      currency: 'XTS',
      status: 'RESERVED',
    };
    const dispatch: Record<string, unknown> = {
      id: 'dispatch-a',
      kind: 'REFUND',
      refundId: refund.id,
      paymentIntentId: intent.id,
      providerIdempotencyKey: 'r24_refund_provider_key_a',
      status: 'NOT_DISPATCHED',
      claimId: null,
      leaseUntil: null,
      externalOperationId: null,
      observation: null,
    };
    const observed = {
      status: 'SUCCEEDED',
      refundId: refund.id,
      paymentConfirmationId: 'confirmation-a',
      adapterId: BINDING.adapterId,
      mode: BINDING.mode,
      accountReference: BINDING.accountReference,
      amount: toMoneyWire({ amountMinor: 250n, currency: 'XTS' }),
      externalOperationId: 'refund-operation-a',
    };
    h.db.moneyPaymentIntent.findUniqueOrThrow.mockResolvedValue(intent);
    h.db.moneyPaymentConfirmation.findUniqueOrThrow.mockResolvedValue({
      id: 'confirmation-a',
      paymentIntentId: intent.id,
    });
    h.db.moneyRefund.findUnique.mockResolvedValue(refund);
    h.db.moneyRefund.findUniqueOrThrow.mockResolvedValue(refund);
    h.db.moneyDispatch.findUnique.mockImplementation(async () => ({ ...dispatch }));
    h.db.moneyDispatch.findUniqueOrThrow.mockImplementation(async () => ({ ...dispatch }));
    h.db.moneyDispatch.update.mockImplementation(async ({ data }: { data: object }) =>
      Object.assign(dispatch, data),
    );
    h.db.moneyDispatch.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { claimId?: string; status?: { in: string[] } };
        data: object;
      }) => {
        if (
          (where.claimId && where.claimId !== dispatch.claimId) ||
          (where.status && !where.status.in.includes(String(dispatch.status)))
        )
          return { count: 0 };
        Object.assign(dispatch, data);
        return { count: 1 };
      },
    );
    h.refunds.isConfigured.mockReturnValue(true);
    h.refunds.submit.mockResolvedValue(observed);
    const resultCall = jest
      .spyOn(h.service, 'recordRefundResult')
      .mockRejectedValueOnce(new Error('synthetic local posting failure'))
      .mockResolvedValue({
        contractVersion: MONEY_CONTRACT_VERSION,
        id: refund.id,
        paymentConfirmationId: 'confirmation-a',
        amount: observed.amount,
        status: 'SUCCEEDED',
        externalRefundId: 'scoped-refund-a',
        compensatingLedgerTransactionId: 'compensation-a',
      });
    await expect(h.service.dispatchRefund('user-a', KEY, refund.id)).resolves.toMatchObject({
      status: 'ACCEPTED',
    });
    expect(dispatch).toMatchObject({
      status: 'UNKNOWN',
      observation: observed,
      externalOperationId: 'refund-operation-a',
      claimId: null,
      leaseUntil: null,
    });
    const configurationCalls = h.configuration.resolve.mock.calls.length;
    const readinessCalls = h.refunds.isConfigured.mock.calls.length;
    h.configuration.resolve.mockResolvedValue(null);
    h.refunds.isConfigured.mockReturnValue(false);
    await expect(h.service.queryRefund('user-a', `${KEY}_retry`, refund.id)).resolves.toMatchObject(
      { status: 'ACCEPTED' },
    );
    expect(resultCall).toHaveBeenLastCalledWith('dispatch-a', observed);
    expect(resultCall).toHaveBeenCalledTimes(2);
    expect(h.configuration.resolve).toHaveBeenCalledTimes(configurationCalls);
    expect(h.refunds.isConfigured).toHaveBeenCalledTimes(readinessCalls);
    expect(h.refunds.submit).toHaveBeenCalledTimes(1);
    expect(h.refunds.query).not.toHaveBeenCalled();
    expect(h.permissions.resolveFreshForUser).toHaveBeenCalledTimes(2);
  });
});

describe('R24 fingerprints and unavailable port defaults', () => {
  it.each([
    { amount: '1001' },
    { currency: 'XXX' },
    { accountReference: 'other-account' },
    { mode: 'LIVE' },
    { obligation: 'intent-b' },
  ])('binds a changed authoritative field %j into the fingerprint', (change) => {
    const authority = {
      amount: '1000',
      currency: 'XTS',
      accountReference: 'account-a',
      mode: 'SANDBOX',
      obligation: 'intent-a',
    };
    expect(moneyCommandDigest({ userId: 'user-a' }, 'CREATE_INTENT', REQUEST, authority)).not.toBe(
      moneyCommandDigest({ userId: 'user-a' }, 'CREATE_INTENT', REQUEST, {
        ...authority,
        ...change,
      }),
    );
  });

  it('keeps canonical key order independent while distinguishing action and actor', () => {
    const first = moneyCommandDigest(
      { userId: 'user-a' },
      'QUOTE',
      { a: 1, b: 2 },
      { value: '10' },
    );
    expect(first).toBe(
      moneyCommandDigest({ userId: 'user-a' }, 'QUOTE', { b: 2, a: 1 }, { value: '10' }),
    );
    expect(first).not.toBe(
      moneyCommandDigest({ userId: 'user-b' }, 'QUOTE', { a: 1, b: 2 }, { value: '10' }),
    );
    expect(first).not.toBe(
      moneyCommandDigest({ userId: 'user-a' }, 'CREATE_INTENT', { a: 1, b: 2 }, { value: '10' }),
    );
  });

  it('filters future and retired plan versions at the transaction-bound catalog boundary', async () => {
    const tx = { subscriptionPlanVersion: { findFirst: jest.fn().mockResolvedValue(null) } };
    const catalog = new PrismaMoneyCatalogFactory().forTransaction(tx as never);
    expect(await catalog.findPublishedPlanVersion('plan-future')).toBeNull();
    expect(tx.subscriptionPlanVersion.findFirst).toHaveBeenCalledWith({
      where: { id: 'plan-future', retiredAt: null, publishedAt: { lte: expect.any(Date) } },
    });
  });

  it('has no configured default adapter, receipt processor, activation or refund policy', async () => {
    expect(await new UnavailableMoneyConfiguration().resolve()).toBeNull();
    expect(new UnavailableMoneyCollectionAdapter().isConfigured()).toBe(false);
    expect(new UnavailableMoneyReceiptAcceptance().isConfigured()).toBe(false);
    expect(new UnavailableMoneyActivationParticipant().isConfigured()).toBe(false);
    expect(new UnavailableMoneyRefundAdapter().isConfigured()).toBe(false);
    const calls = [
      new UnavailableMoneyCollectionAdapter().createOrResume(),
      new UnavailableMoneyCollectionAdapter().validateAndNormalizeExternalEvent(),
      new UnavailableMoneyReceiptAcceptance().accept(),
      new UnavailableMoneyActivationParticipant().activatePeriod(),
      new UnavailableMoneyRefundPolicy().authorizeReservation(),
      new UnavailableMoneyRefundAdapter().submit(),
      new UnavailableMoneyRefundAdapter().query(),
    ];
    const results = await Promise.allSettled(calls);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
    }
  });
});
