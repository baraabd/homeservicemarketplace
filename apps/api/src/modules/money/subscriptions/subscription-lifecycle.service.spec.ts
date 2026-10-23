import type { PrismaTx, SubscriptionPeriod } from '@homeservicemarketplace/database';
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../../infrastructure/outbox/outbox.tokens';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { AuditService } from '../../iam/audit/audit.service';
import type { EntitlementUsageService } from '../entitlements/entitlement-usage.service';
import type { PlanVersionService } from './plan-version.service';
import {
  SubscriptionLifecycleService,
  unresolvedSubscriptionPolicy,
  type ApprovedSubscriptionTransition,
  type SubscriptionLifecyclePolicy,
} from './subscription-lifecycle.service';

const now = new Date('2030-01-15T00:00:00.000Z');
const period: SubscriptionPeriod = {
  id: 'period',
  subscriptionId: 'subscription',
  paymentConfirmationId: 'confirmation',
  startsAt: new Date('2030-01-01T00:00:00.000Z'),
  endsAt: new Date('2030-02-01T00:00:00.000Z'),
  createdAt: now,
};
const approved: SubscriptionLifecyclePolicy = {
  version: 'test-policy-v1',
  reminderLeadTimeMs: 86_400_000,
  cancellation: 'IMMEDIATE',
  suspension: 'SUSPEND',
  refundEffect: 'SUSPEND_SUBSCRIPTION',
};
const transition: ApprovedSubscriptionTransition = {
  operationId: 'operation_one',
  subscriptionId: 'subscription',
  subscriptionPeriodId: 'period',
  policyVersion: 'test-policy-v1',
  action: 'SUSPEND',
  reasonCode: 'TEST_POLICY',
};

function fixture(policy: SubscriptionLifecyclePolicy = unresolvedSubscriptionPolicy) {
  const subscription = {
    id: 'subscription',
    providerProfileId: 'provider',
    planVersionId: 'plan',
    status: 'ACTIVE',
    planVersion: {
      id: 'plan',
      planKey: 'test-plan',
      version: 1,
      billingInterval: 'MONTHLY',
      priceMinor: 100n,
      currency: 'XTS',
      entitlements: [],
      publishedAt: now,
      retiredAt: null,
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'subscription' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    providerSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(subscription),
      update: jest.fn().mockResolvedValue({}),
    },
    subscriptionPeriod: {
      findFirst: jest.fn().mockResolvedValue(period),
      findMany: jest.fn().mockResolvedValue([]),
    },
    moneyPaymentIntent: { findFirst: jest.fn().mockResolvedValue(null) },
    outboxEvent: { findUnique: jest.fn().mockResolvedValue(null) },
    moneyCommand: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'receipt' }),
    },
    moneyRefund: { findUnique: jest.fn().mockResolvedValue(null) },
    providerProfile: {
      findUnique: jest.fn().mockResolvedValue({
        userId: 'user',
        deletedAt: null,
        user: { deletedAt: null, isActive: true, status: 'ACTIVE' },
      }),
    },
  };
  const run = jest.fn((operation: (arg: PrismaTx) => unknown) =>
    operation(tx as unknown as PrismaTx),
  );
  const owner = jest.fn().mockResolvedValue('provider');
  const decisions = jest.fn().mockResolvedValue([]);
  const enqueue = jest.fn().mockResolvedValue({ id: 'event' });
  const createForUser = jest.fn().mockResolvedValue({ id: 'notification' });
  const record = jest.fn().mockResolvedValue(undefined);
  const clock = { now: jest.fn(() => now) };
  const service = new SubscriptionLifecycleService(
    { run } as unknown as TransactionRunner,
    { owner } as unknown as PlanVersionService,
    { decisions } as unknown as EntitlementUsageService,
    { enqueue } as unknown as OutboxRepository,
    { createForUser } as unknown as NotificationsService,
    { record } as unknown as AuditService,
    clock,
    policy,
  );
  return { service, tx, subscription, owner, enqueue, createForUser, record, clock };
}

describe('R31 authoritative My Plan projection', () => {
  it('represents no paid purchase and every undecided public action explicitly', async () => {
    const h = fixture();
    await expect(h.service.myPlan('user')).resolves.toMatchObject({
      status: 'NONE',
      subscription: null,
      asOf: now.toISOString(),
      history: [],
      historyHasMore: false,
      policy: { state: 'POLICY_BLOCKED', canCancel: false, canRenew: false, canApplyCoupon: false },
      grantsIdentityVerification: false,
      grantsWorkAccess: false,
    });
  });

  it.each([
    ['CREATED', undefined, 'ACTION_REQUIRED'],
    ['PROCESSING', undefined, 'PENDING_PAYMENT'],
    ['PROCESSING', 'STARTED', 'PENDING_PAYMENT'],
    ['PROCESSING', 'FAILED', 'FAILED'],
    ['FAILED', undefined, 'FAILED'],
    ['CANCELLED', undefined, 'CANCELLED'],
    ['EXPIRED', undefined, 'EXPIRED'],
  ])(
    'projects payment %s / attempt %s as %s without activating',
    async (status, attempt, expected) => {
      const h = fixture();
      h.tx.moneyPaymentIntent.findFirst.mockResolvedValue({
        id: 'intent',
        providerProfileId: 'provider',
        planVersionId: 'plan',
        status,
        method: 'STRIPE',
        currency: 'XTS',
        subtotalMinor: 100n,
        discountMinor: 0n,
        totalMinor: 100n,
        createdAt: now,
        expiresAt: now,
        attempts: attempt ? [{ status: attempt }] : [],
      });
      const view = await h.service.myPlan('user');
      expect(view.status).toBe(expected);
      expect(view.payment).toMatchObject({
        id: 'intent',
        status,
        latestAttemptStatus: attempt ?? null,
      });
      expect(h.tx.providerSubscription.update).not.toHaveBeenCalled();
    },
  );

  it('preserves a confirmed active period while exposing a failed later payment attempt separately', async () => {
    const h = fixture();
    h.tx.providerSubscription.findFirst.mockResolvedValue(h.subscription);
    h.tx.subscriptionPeriod.findFirst.mockResolvedValueOnce(period).mockResolvedValueOnce(null);
    h.tx.moneyPaymentIntent.findFirst.mockResolvedValue({
      id: 'later_intent',
      providerProfileId: 'provider',
      planVersionId: 'plan',
      status: 'PROCESSING',
      method: 'STRIPE',
      currency: 'XTS',
      subtotalMinor: 100n,
      discountMinor: 0n,
      totalMinor: 100n,
      createdAt: now,
      expiresAt: now,
      attempts: [{ status: 'FAILED' }],
    });
    const view = await h.service.myPlan('user', 'subscription');
    expect(view).toMatchObject({
      status: 'ACTIVE',
      subscription: {
        id: 'subscription',
        status: 'ACTIVE',
        currentPeriod: { id: 'period', paymentConfirmationId: 'confirmation' },
      },
      payment: { id: 'later_intent', status: 'PROCESSING', latestAttemptStatus: 'FAILED' },
    });
    expect(h.tx.providerSubscription.update).not.toHaveBeenCalled();
  });

  it('rejects a selected foreign subscription without returning another purchase', async () => {
    const h = fixture();
    await expect(h.service.myPlan('user', 'foreign')).rejects.toMatchObject({ status: 404 });
    expect(h.tx.providerSubscription.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign', providerProfileId: 'provider' },
      include: { planVersion: true },
    });
  });

  it('keeps a confirmed future period scheduled and bounds its selected history', async () => {
    const h = fixture();
    h.tx.providerSubscription.findFirst.mockResolvedValue(h.subscription);
    h.tx.subscriptionPeriod.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(period);
    h.tx.subscriptionPeriod.findMany.mockResolvedValue(Array.from({ length: 51 }, () => period));
    const view = await h.service.myPlan('user', 'subscription');
    expect(view.status).toBe('SCHEDULED');
    expect(view.history).toHaveLength(50);
    expect(view.historyHasMore).toBe(true);
  });
});

describe('R31 due lifecycle and explicit policy receipts', () => {
  it('schedules only expiry by default and prechecks an exact existing event', async () => {
    const h = fixture();
    await h.service.schedulePeriod(period, h.tx as unknown as PrismaTx);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    const input = h.enqueue.mock.calls[0][0];
    expect(input).toMatchObject({
      eventType: OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE,
      availableAt: period.endsAt,
    });
    h.tx.outboxEvent.findUnique.mockResolvedValue(input);
    await h.service.schedulePeriod(period, h.tx as unknown as PrismaTx);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    h.tx.outboxEvent.findUnique.mockResolvedValue({ ...input, payload: { different: true } });
    await expect(
      h.service.schedulePeriod(period, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('does not expire before the exact boundary or expire a confirmed renewal', async () => {
    const h = fixture();
    await expect(
      h.service.expirePeriod('subscription', 'period', h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    h.clock.now.mockReturnValue(period.endsAt);
    h.tx.subscriptionPeriod.findFirst
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce({ id: 'renewal' });
    await expect(
      h.service.expirePeriod('subscription', 'period', h.tx as unknown as PrismaTx),
    ).resolves.toBe(false);
    expect(h.tx.providerSubscription.update).not.toHaveBeenCalled();
    h.tx.subscriptionPeriod.findFirst.mockResolvedValueOnce(period).mockResolvedValueOnce(null);
    await expect(
      h.service.expirePeriod('subscription', 'period', h.tx as unknown as PrismaTx),
    ).resolves.toBe(true);
    expect(h.tx.providerSubscription.update).toHaveBeenCalledWith({
      where: { id: 'subscription' },
      data: { status: 'EXPIRED' },
    });
  });

  it('has no default reminder, cancellation, suspension or refund side effect', async () => {
    const h = fixture();
    await expect(
      h.service.remindPeriod('subscription', 'period', h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 503 });
    expect(() =>
      h.service.applyApprovedTransition(transition, h.tx as unknown as PrismaTx),
    ).toThrow('not approved');
    expect(() =>
      h.service.applyConfirmedRefund(
        {
          refundId: 'refund',
          refundRequestId: 'request',
          paymentConfirmationId: 'confirmation',
          policyVersion: 'test-policy-v1',
          amount: toMoneyWire({ amountMinor: 100n, currency: 'XTS' }),
          compensatingLedgerTransactionId: 'compensation',
        },
        h.tx as unknown as PrismaTx,
      ),
    ).toThrow('not approved');
    expect(h.tx.$queryRaw).not.toHaveBeenCalled();
    expect(h.createForUser).not.toHaveBeenCalled();
  });

  it('refuses malformed reminder policy instead of silently treating it as due', async () => {
    const h = fixture({ ...approved, reminderLeadTimeMs: NaN });
    await expect(
      h.service.remindPeriod('subscription', 'period', h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.createForUser).not.toHaveBeenCalled();
  });

  it('writes a named-policy transition, immutable response and audit in the caller transaction', async () => {
    const h = fixture(approved);
    const result = await h.service.applyApprovedTransition(transition, h.tx as unknown as PrismaTx);
    expect(result).toMatchObject({ status: 'SUSPENDED', changed: true, replayed: false });
    expect(h.tx.moneyCommand.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^r31_[a-f0-9]{64}$/u),
        actorSystem: 'money.subscription-lifecycle',
        action: 'subscription.suspend',
        response: expect.objectContaining({ subscriptionPeriodId: 'period' }),
      }),
    });
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'MONEY_COMMAND_ACCEPTED' }),
      h.tx,
    );
    const stored = h.tx.moneyCommand.create.mock.calls[0][0].data;
    h.tx.moneyCommand.findUnique.mockResolvedValue({ ...stored, actorUserId: null });
    h.tx.providerSubscription.findUniqueOrThrow.mockResolvedValue({
      ...h.subscription,
      status: 'ACTIVE',
    });
    await expect(
      h.service.applyApprovedTransition(transition, h.tx as unknown as PrismaTx),
    ).resolves.toMatchObject({ replayed: true, status: 'SUSPENDED' });
    expect(h.tx.providerSubscription.update).toHaveBeenCalledTimes(1);
    await expect(
      h.service.applyApprovedTransition(
        { ...transition, reasonCode: 'DIFFERENT' },
        h.tx as unknown as PrismaTx,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rejects a delayed transition targeting an older purchased period', async () => {
    const h = fixture(approved);
    h.tx.subscriptionPeriod.findFirst
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce({ id: 'renewal' });
    await expect(
      h.service.applyApprovedTransition(transition, h.tx as unknown as PrismaTx),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.tx.providerSubscription.update).not.toHaveBeenCalled();
    expect(h.tx.moneyCommand.create).not.toHaveBeenCalled();
  });

  it('requires a succeeded refund and matching posted compensation before any policy effect', async () => {
    const h = fixture(approved);
    await expect(
      h.service.applyConfirmedRefund(
        {
          refundId: 'refund',
          refundRequestId: 'request',
          paymentConfirmationId: 'confirmation',
          policyVersion: 'test-policy-v1',
          amount: toMoneyWire({ amountMinor: 100n, currency: 'XTS' }),
          compensatingLedgerTransactionId: 'compensation',
        },
        h.tx as unknown as PrismaTx,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.tx.providerSubscription.update).not.toHaveBeenCalled();
  });
});
