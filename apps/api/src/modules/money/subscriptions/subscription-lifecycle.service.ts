import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  fromMoneyWire,
  MONEY_CONTRACT_VERSION,
  toMoneyWire,
  type MoneyMyPlanPaymentWireV1,
  type MoneyMyPlanWireV1,
  type MoneySubscriptionPresentationState,
  type PaymentAttemptStatus,
  type SubscriptionPeriodWireV1,
  type SubscriptionStatus,
} from '@homeservicemarketplace/contracts';
import {
  Prisma,
  type MoneyPaymentIntent,
  type PrismaTx,
  type SubscriptionPeriod,
} from '@homeservicemarketplace/database';

import { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../../infrastructure/outbox/outbox.tokens';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditService } from '../../iam/audit/audit.service';
import type { MoneyConfirmedRefund } from '../ports/refund.port';
import {
  SUBSCRIPTION_CLOCK,
  subscriptionNow,
  type SubscriptionClock,
} from '../entitlements/entitlement-policy';
import {
  EntitlementUsageService,
  type SubscriptionWithPlan,
} from '../entitlements/entitlement-usage.service';
import { PlanVersionService, planVersionWire } from './plan-version.service';

export const SUBSCRIPTION_LIFECYCLE_POLICY = Symbol('SUBSCRIPTION_LIFECYCLE_POLICY');
export interface SubscriptionLifecyclePolicy {
  version: string | null;
  reminderLeadTimeMs: number | null;
  cancellation: 'BLOCKED' | 'IMMEDIATE';
  suspension: 'BLOCKED' | 'SUSPEND';
  refundEffect: 'BLOCKED' | 'SUSPEND_SUBSCRIPTION' | 'CANCEL_SUBSCRIPTION';
}
export const unresolvedSubscriptionPolicy: Readonly<SubscriptionLifecyclePolicy> = Object.freeze({
  version: null,
  reminderLeadTimeMs: null,
  cancellation: 'BLOCKED',
  suspension: 'BLOCKED',
  refundEffect: 'BLOCKED',
});

const POLICY_BLOCKERS = [
  'COMMERCIAL_POLICY_UNAPPROVED',
  'CANCELLATION_POLICY_UNAPPROVED',
  'RENEWAL_CONSENT_UNAPPROVED',
  'GRACE_POLICY_UNAPPROVED',
  'REFUND_EFFECT_POLICY_UNAPPROVED',
  'USAGE_RESET_POLICY_UNAPPROVED',
] as const;

export interface ApprovedSubscriptionTransition {
  operationId: string;
  subscriptionId: string;
  subscriptionPeriodId: string;
  policyVersion: string;
  action: 'CANCEL' | 'SUSPEND';
  reasonCode: string;
}
interface LifecycleResult {
  contractVersion: typeof MONEY_CONTRACT_VERSION;
  subscriptionId: string;
  subscriptionPeriodId: string;
  status: SubscriptionStatus;
  changed: boolean;
  policyVersion: string;
}
const LIFECYCLE_ACTOR = 'money.subscription-lifecycle';

@Injectable()
export class SubscriptionLifecycleService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly plans: PlanVersionService,
    private readonly usage: EntitlementUsageService,
    private readonly outbox: OutboxRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: SubscriptionClock,
    @Inject(SUBSCRIPTION_LIFECYCLE_POLICY) private readonly policy: SubscriptionLifecyclePolicy,
  ) {}

  myPlan(userId: string, subscriptionId?: string): Promise<MoneyMyPlanWireV1> {
    if (subscriptionId !== undefined) validId(subscriptionId);
    return this.transactions.run(
      async (tx) => {
        const providerProfileId = await this.plans.owner(userId, tx);
        const now = subscriptionNow(this.clock);
        const include = { planVersion: true } as const;
        let subscription: SubscriptionWithPlan | null;
        if (subscriptionId) {
          subscription = await tx.providerSubscription.findFirst({
            where: { id: subscriptionId, providerProfileId },
            include,
          });
          if (!subscription) throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
        } else {
          subscription =
            (await tx.providerSubscription.findFirst({
              where: {
                providerProfileId,
                status: 'ACTIVE',
                periods: {
                  some: { startsAt: { lte: now }, endsAt: { gt: now }, ...paidPeriodWhere() },
                },
              },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              include,
            })) ??
            (await tx.providerSubscription.findFirst({
              where: { providerProfileId },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              include,
            }));
        }
        const payment = await tx.moneyPaymentIntent.findFirst({
          where: {
            providerProfileId,
            ...(subscriptionId && subscription
              ? { planVersionId: subscription.planVersionId }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: {
            attempts: { orderBy: { attemptNo: 'desc' }, take: 1, select: { status: true } },
          },
        });
        const [current, next, history, entitlements] = subscription
          ? await Promise.all([
              tx.subscriptionPeriod.findFirst({
                where: {
                  subscriptionId: subscription.id,
                  startsAt: { lte: now },
                  endsAt: { gt: now },
                  ...paidPeriodWhere(),
                },
                orderBy: { startsAt: 'desc' },
              }),
              tx.subscriptionPeriod.findFirst({
                where: {
                  subscriptionId: subscription.id,
                  startsAt: { gt: now },
                  ...paidPeriodWhere(),
                },
                orderBy: { startsAt: 'asc' },
              }),
              tx.subscriptionPeriod.findMany({
                where: { subscriptionId: subscription.id },
                orderBy: [{ startsAt: 'desc' }, { id: 'desc' }],
                take: 51,
              }),
              this.usage.decisions(tx, subscription, now),
            ])
          : [null, null, [], []];
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          asOf: now.toISOString(),
          status: presentationState(
            subscription,
            current,
            next,
            payment,
            payment?.attempts[0]?.status,
          ),
          subscription: subscription
            ? {
                id: subscription.id,
                status: subscription.status,
                plan: planVersionWire(subscription.planVersion),
                currentPeriod: current ? periodWire(current, subscription) : null,
                nextPeriod: next ? periodWire(next, subscription) : null,
              }
            : null,
          entitlements,
          history: subscription
            ? history.slice(0, 50).map((period) => periodWire(period, subscription))
            : [],
          historyHasMore: history.length > 50,
          payment: payment ? paymentWire(payment, payment.attempts[0]?.status ?? null) : null,
          policy: {
            state: 'POLICY_BLOCKED',
            blockers: [...POLICY_BLOCKERS],
            canCancel: false,
            canRenew: false,
            canApplyCoupon: false,
          },
          grantsIdentityVerification: false,
          grantsWorkAccess: false,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** Called only after activation has verified this existing immutable period.
   * Enqueue uses the caller transaction, never an independent side effect. */
  async schedulePeriod(period: SubscriptionPeriod, tx: PrismaTx): Promise<void> {
    await this.enqueueOnce(
      OutboxEventType.MONEY_SUBSCRIPTION_EXPIRY_DUE,
      period,
      period.endsAt,
      tx,
    );
    if (this.policy.reminderLeadTimeMs === null) return;
    if (
      !approvedVersion(this.policy.version) ||
      !Number.isSafeInteger(this.policy.reminderLeadTimeMs) ||
      this.policy.reminderLeadTimeMs < 0
    )
      throw policyBlocked('REMINDER_POLICY_UNAPPROVED');
    const due = new Date(
      Math.max(period.startsAt.getTime(), period.endsAt.getTime() - this.policy.reminderLeadTimeMs),
    );
    if (!Number.isFinite(due.getTime())) throw policyBlocked('REMINDER_POLICY_UNAPPROVED');
    await this.enqueueOnce(OutboxEventType.MONEY_SUBSCRIPTION_REMINDER_DUE, period, due, tx);
  }

  /** Row lock is shared with usage and R19 period insertion. A replay of an old
   * period cannot expire an active or future confirmed renewal. There is no
   * implicit grace, trial extension, auto-renewal or new financial posting. */
  async expirePeriod(subscriptionId: string, periodId: string, tx: PrismaTx): Promise<boolean> {
    // A later refund removes paid capability, but does not erase the original
    // immutable confirmation or prevent a suspended period from expiring.
    const { subscription, period } = await this.lockPeriod(subscriptionId, periodId, tx, true);
    const now = subscriptionNow(this.clock);
    if (period.endsAt > now) throw new AppError('CONFLICT', 'Subscription expiry is not due.', 409);
    if (!['ACTIVE', 'SUSPENDED'].includes(subscription.status)) return false;
    const renewed = await tx.subscriptionPeriod.findFirst({
      where: { subscriptionId, endsAt: { gt: now }, ...paidPeriodWhere() },
      select: { id: true },
    });
    if (renewed) return false;
    await tx.providerSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'EXPIRED' },
    });
    return true;
  }

  async remindPeriod(subscriptionId: string, periodId: string, tx: PrismaTx): Promise<boolean> {
    if (
      !approvedVersion(this.policy.version) ||
      this.policy.reminderLeadTimeMs === null ||
      !Number.isSafeInteger(this.policy.reminderLeadTimeMs) ||
      this.policy.reminderLeadTimeMs < 0
    ) {
      throw policyBlocked('REMINDER_POLICY_UNAPPROVED');
    }
    const { subscription, period } = await this.lockPeriod(subscriptionId, periodId, tx);
    const now = subscriptionNow(this.clock);
    const due = Math.max(
      period.startsAt.getTime(),
      period.endsAt.getTime() - this.policy.reminderLeadTimeMs,
    );
    if (now.getTime() < due)
      throw new AppError('CONFLICT', 'Subscription reminder is not due.', 409);
    if (subscription.status !== 'ACTIVE' || period.startsAt > now || period.endsAt <= now)
      return false;
    const renewed = await tx.subscriptionPeriod.findFirst({
      where: { subscriptionId, startsAt: { gte: period.endsAt }, ...paidPeriodWhere() },
      select: { id: true },
    });
    if (renewed) return false;
    const provider = await tx.providerProfile.findUnique({
      where: { id: subscription.providerProfileId },
      include: { user: true },
    });
    if (
      !provider ||
      !provider.user ||
      !provider.userId ||
      provider.deletedAt ||
      provider.user.deletedAt ||
      !provider.user.isActive ||
      provider.user.status !== 'ACTIVE'
    )
      return false;
    await this.notifications.createForUser(
      {
        userId: provider.userId,
        type: 'SYSTEM',
        dedupeKey: `money.subscription.reminder.v1:${period.id}`,
        deepLink: `/provider/my-plan?subscriptionId=${encodeURIComponent(subscription.id)}`,
        title: 'Subscription period reminder / تذكير بمدة الاشتراك',
        body: 'Review your current subscription period in My Plan. / راجع مدة اشتراكك الحالية في صفحة خطتي.',
      },
      tx,
    );
    return true;
  }

  /** Trusted server composition only. The named, explicitly configured policy
   * is checked before mutation and replay. There is no user-facing endpoint.
   * The expected latest period prevents a delayed command targeting an old
   * purchase from cancelling or suspending a newly renewed period. */
  applyApprovedTransition(input: ApprovedSubscriptionTransition, tx: PrismaTx) {
    if (
      !tx ||
      !input ||
      !approvedVersion(this.policy.version) ||
      input.policyVersion !== this.policy.version ||
      (input.action === 'CANCEL'
        ? this.policy.cancellation !== 'IMMEDIATE'
        : input.action === 'SUSPEND'
          ? this.policy.suspension !== 'SUSPEND'
          : true)
    ) {
      throw policyBlocked('SUBSCRIPTION_LIFECYCLE_POLICY_UNAPPROVED');
    }
    validId(input.subscriptionId);
    validId(input.subscriptionPeriodId);
    if (
      !/^[A-Za-z0-9_.:-]{1,128}$/u.test(input.operationId) ||
      !/^[A-Z][A-Z0-9_]{1,63}$/u.test(input.reasonCode)
    ) {
      throw new AppError('VALIDATION_ERROR', 'Invalid subscription policy operation.', 400);
    }
    return this.withReceipt(
      `transition:${input.operationId}`,
      `subscription.${input.action.toLowerCase()}`,
      input,
      tx,
      async () => {
        const { subscription, period } = await this.lockPeriod(
          input.subscriptionId,
          input.subscriptionPeriodId,
          tx,
        );
        const latest = await tx.subscriptionPeriod.findFirst({
          where: { subscriptionId: subscription.id },
          orderBy: [{ endsAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (latest?.id !== period.id)
          throw new AppError(
            'CONFLICT',
            'A newer subscription period requires a new policy decision.',
            409,
          );
        const target = input.action === 'CANCEL' ? 'CANCELLED' : 'SUSPENDED';
        const changed = await this.setPolicyStatus(
          subscription.id,
          subscription.status,
          target,
          tx,
        );
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          subscriptionId: subscription.id,
          subscriptionPeriodId: period.id,
          status: changed ? target : subscription.status,
          changed,
          policyVersion: input.policyVersion,
        };
      },
    );
  }

  /** R32 may compose this only after its approved policy and successful refund
   * compensation are already present in the same caller transaction. */
  applyConfirmedRefund(input: MoneyConfirmedRefund, tx: PrismaTx) {
    if (
      !tx ||
      !input ||
      !approvedVersion(this.policy.version) ||
      input.policyVersion !== this.policy.version ||
      this.policy.refundEffect === 'BLOCKED'
    )
      throw policyBlocked('REFUND_EFFECT_POLICY_UNAPPROVED');
    for (const value of [
      input.refundId,
      input.refundRequestId,
      input.paymentConfirmationId,
      input.compensatingLedgerTransactionId,
    ])
      validId(value);
    const amount = fromMoneyWire(input.amount);
    return this.withReceipt(
      `refund:${input.refundId}`,
      'subscription.refund-effect',
      input,
      tx,
      async () => {
        const refund = await tx.moneyRefund.findUnique({
          where: { id: input.refundId },
          include: {
            request: true,
            compensatingLedgerTxn: true,
            paymentConfirmation: { include: { period: true } },
          },
        });
        const period = refund?.paymentConfirmation.period;
        if (
          !refund ||
          !period ||
          refund.status !== 'SUCCEEDED' ||
          refund.amountMinor !== amount.amountMinor ||
          refund.currency !== amount.currency ||
          refund.paymentConfirmationId !== input.paymentConfirmationId ||
          refund.compensatingLedgerTransactionId !== input.compensatingLedgerTransactionId ||
          refund.compensatingLedgerTxn?.status !== 'POSTED' ||
          refund.request?.id !== input.refundRequestId ||
          refund.request.policyVersion !== input.policyVersion ||
          refund.request.status !== 'AUTHORIZED'
        ) {
          throw new AppError(
            'CONFLICT',
            'Refund consequences require matching confirmed compensation.',
            409,
          );
        }
        // A refund policy here explicitly names the whole subscription effect.
        // Its immutable receipt prevents a duplicate delivery from suspending a
        // later renewal a second time; no implicit partial-refund rule exists.
        await tx.$queryRaw`SELECT "id" FROM "ProviderSubscription" WHERE "id" = ${period.subscriptionId} FOR UPDATE`;
        const subscription = await tx.providerSubscription.findUniqueOrThrow({
          where: { id: period.subscriptionId },
        });
        const target =
          this.policy.refundEffect === 'CANCEL_SUBSCRIPTION' ? 'CANCELLED' : 'SUSPENDED';
        const changed = await this.setPolicyStatus(
          subscription.id,
          subscription.status,
          target,
          tx,
        );
        return {
          contractVersion: MONEY_CONTRACT_VERSION,
          subscriptionId: subscription.id,
          subscriptionPeriodId: period.id,
          status: changed ? target : subscription.status,
          changed,
          policyVersion: input.policyVersion,
        };
      },
    );
  }

  private async enqueueOnce(
    eventType: string,
    period: SubscriptionPeriod,
    availableAt: Date,
    tx: PrismaTx,
  ) {
    const dedupeKey = `${eventType}:${period.id}`;
    const existing = await tx.outboxEvent.findUnique({ where: { dedupeKey } });
    if (existing) {
      if (
        existing.aggregateId !== period.subscriptionId ||
        existing.eventType !== eventType ||
        existing.aggregateType !== 'ProviderSubscription' ||
        canonicalJson(existing.payload) !==
          canonicalJson({
            contractVersion: MONEY_CONTRACT_VERSION,
            subscriptionId: period.subscriptionId,
            subscriptionPeriodId: period.id,
            paymentConfirmationId: period.paymentConfirmationId,
          })
      ) {
        throw new AppError(
          'CONFLICT',
          'Subscription event identity conflicts with stored history.',
          409,
        );
      }
      return;
    }
    await this.outbox.enqueue(
      {
        aggregateType: 'ProviderSubscription',
        aggregateId: period.subscriptionId,
        eventType,
        payload: {
          contractVersion: MONEY_CONTRACT_VERSION,
          subscriptionId: period.subscriptionId,
          subscriptionPeriodId: period.id,
          paymentConfirmationId: period.paymentConfirmationId,
        },
        dedupeKey,
        availableAt,
      },
      tx,
    );
  }

  private async setPolicyStatus(
    id: string,
    current: SubscriptionStatus,
    target: 'CANCELLED' | 'SUSPENDED',
    tx: PrismaTx,
  ) {
    if (current === target || current === 'CANCELLED' || current === 'EXPIRED') return false;
    if (target === 'SUSPENDED' && current !== 'ACTIVE') {
      throw new AppError('CONFLICT', 'This subscription cannot be suspended.', 409);
    }
    await tx.providerSubscription.update({ where: { id }, data: { status: target } });
    return true;
  }

  private async withReceipt(
    identity: string,
    action: string,
    request: object,
    tx: PrismaTx,
    apply: () => Promise<LifecycleResult>,
  ): Promise<LifecycleResult & { replayed: boolean }> {
    const idempotencyKey = `r31_${createHash('sha256').update(identity).digest('hex')}`;
    const requestDigest = createHash('sha256')
      .update(
        canonicalJson({
          action,
          request,
          policy: this.policy,
          contractVersion: MONEY_CONTRACT_VERSION,
        }),
      )
      .digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`;
    const existing = await tx.moneyCommand.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.actorSystem !== LIFECYCLE_ACTOR ||
        existing.actorUserId !== null ||
        existing.action !== action ||
        existing.requestDigest !== requestDigest ||
        existing.contractVersion !== MONEY_CONTRACT_VERSION
      ) {
        throw new AppError(
          'CONFLICT',
          'Subscription operation identity has already been used.',
          409,
        );
      }
      const response = existing.response as unknown as LifecycleResult;
      if (
        !response ||
        response.contractVersion !== MONEY_CONTRACT_VERSION ||
        typeof response.subscriptionId !== 'string' ||
        typeof response.subscriptionPeriodId !== 'string' ||
        typeof response.changed !== 'boolean' ||
        response.policyVersion !== this.policy.version ||
        !['ACTIVE', 'PENDING_PAYMENT', 'CANCELLED', 'SUSPENDED', 'EXPIRED'].includes(
          response.status,
        )
      ) {
        throw new AppError('CONFLICT', 'Subscription operation receipt is invalid.', 409);
      }
      return { ...response, replayed: true };
    }
    const response = await apply();
    const command = await tx.moneyCommand.create({
      data: {
        idempotencyKey,
        actorSystem: LIFECYCLE_ACTOR,
        action,
        contractVersion: MONEY_CONTRACT_VERSION,
        requestDigest,
        response: response as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(
      {
        type: 'MONEY_COMMAND_ACCEPTED',
        metadata: {
          moneyCommandId: command.id,
          moneyAction: action,
          subscriptionId: response.subscriptionId,
          subscriptionPeriodId: response.subscriptionPeriodId,
          actorSystem: LIFECYCLE_ACTOR,
          policyVersion: response.policyVersion,
        },
      },
      tx,
    );
    return { ...response, replayed: false };
  }

  private async lockPeriod(
    subscriptionId: string,
    periodId: string,
    tx: PrismaTx,
    allowRefunded = false,
  ) {
    validId(subscriptionId);
    validId(periodId);
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ProviderSubscription" WHERE "id" = ${subscriptionId} FOR UPDATE
    `;
    if (locked.length !== 1) throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
    const subscription = await tx.providerSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    const period = await tx.subscriptionPeriod.findFirst({
      where: { id: periodId, subscriptionId, ...paidPeriodWhere(allowRefunded) },
    });
    if (!period)
      throw new AppError('CONFLICT', 'Subscription period has no matching confirmation.', 409);
    return { subscription, period };
  }
}

function paidPeriodWhere(allowRefunded = false): Prisma.SubscriptionPeriodWhereInput {
  return {
    paymentConfirmation: {
      paymentIntent: { status: 'SUCCEEDED' },
      ledgerTransaction: { status: 'POSTED', kind: 'STANDARD' },
      ...(allowRefunded ? {} : { refunds: { none: { status: 'SUCCEEDED' } } }),
    },
  };
}

function periodWire(
  period: SubscriptionPeriod,
  subscription: SubscriptionWithPlan,
): SubscriptionPeriodWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: period.id,
    subscriptionId: period.subscriptionId,
    paymentConfirmationId: period.paymentConfirmationId,
    billingInterval: subscription.planVersion.billingInterval,
    startsAt: period.startsAt.toISOString(),
    endsAt: period.endsAt.toISOString(),
  };
}

function paymentWire(
  payment: MoneyPaymentIntent,
  latestAttemptStatus: PaymentAttemptStatus | null,
): MoneyMyPlanPaymentWireV1 {
  return {
    contractVersion: MONEY_CONTRACT_VERSION,
    id: payment.id,
    providerProfileId: payment.providerProfileId,
    planVersionId: payment.planVersionId,
    method: payment.method,
    status: payment.status,
    latestAttemptStatus,
    subtotal: toMoneyWire({ amountMinor: payment.subtotalMinor, currency: payment.currency }),
    discount: toMoneyWire({ amountMinor: payment.discountMinor, currency: payment.currency }),
    total: toMoneyWire({ amountMinor: payment.totalMinor, currency: payment.currency }),
    expiresAt: payment.expiresAt.toISOString(),
    createdAt: payment.createdAt.toISOString(),
  };
}

function presentationState(
  subscription: SubscriptionWithPlan | null,
  current: SubscriptionPeriod | null,
  next: SubscriptionPeriod | null,
  payment: MoneyPaymentIntent | null,
  latestAttemptStatus?: PaymentAttemptStatus,
): MoneySubscriptionPresentationState {
  if (subscription) {
    if (
      subscription.status === 'CANCELLED' ||
      subscription.status === 'SUSPENDED' ||
      subscription.status === 'EXPIRED'
    )
      return subscription.status;
    if (subscription.status === 'ACTIVE')
      return current ? 'ACTIVE' : next ? 'SCHEDULED' : 'EXPIRED';
  }
  if (!payment) return subscription ? 'PENDING_PAYMENT' : 'NONE';
  if (payment.status === 'FAILED' || payment.status === 'CANCELLED' || payment.status === 'EXPIRED')
    return payment.status;
  // R24 records a failed collection on the attempt while retaining its intent
  // for an explicit retry. Present that recorded failure without rewriting the
  // payment intent or revoking a separately confirmed active period.
  if (payment.status === 'PROCESSING' && latestAttemptStatus === 'FAILED') return 'FAILED';
  return payment.status === 'PROCESSING' ? 'PENDING_PAYMENT' : 'ACTION_REQUIRED';
}

function validId(value: string): void {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(value)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid subscription identity.', 400);
  }
}
function approvedVersion(value: string | null): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/u.test(value);
}
function policyBlocked(reason: string): AppError {
  return new AppError('DEPENDENCY_UNAVAILABLE', 'The subscription policy is not approved.', 503, {
    reason,
  });
}
