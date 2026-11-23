import { Inject, Injectable } from '@nestjs/common';
import type { EntitlementDecision } from '@homeservicemarketplace/contracts';
import type {
  PrismaTx,
  ProviderSubscription,
  SubscriptionPlanVersion,
} from '@homeservicemarketplace/database';

import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { PlanVersionService } from '../subscriptions/plan-version.service';
import {
  entitlementDecision,
  parsePlanEntitlements,
  SUBSCRIPTION_CLOCK,
  subscriptionNow,
  validEntitlementKey,
  type SubscriptionClock,
} from './entitlement-policy';

export interface ConsumeEntitlementInput {
  subscriptionId: string;
  entitlementKey: string;
  /** Stable domain operation identity, not a newly generated retry identifier. */
  usageKey: string;
}
export type SubscriptionWithPlan = ProviderSubscription & { planVersion: SubscriptionPlanVersion };

/** Paid limits only. Callers still enforce their own action authorization,
 * identity/work-access and compliance checks; this class grants none of them.
 * Frozen R19 usage is cumulative per subscription. No monthly reset is inferred. */
@Injectable()
export class EntitlementUsageService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly plans: PlanVersionService,
    @Inject(SUBSCRIPTION_CLOCK) private readonly clock: SubscriptionClock,
  ) {}

  consume(userId: string, input: ConsumeEntitlementInput, callerTx?: PrismaTx) {
    validate(input);
    const execute = (tx: PrismaTx) => this.consumeInside(userId, input, tx);
    return callerTx ? execute(callerTx) : this.transactions.run(execute);
  }

  async decisions(
    tx: PrismaTx,
    subscription: SubscriptionWithPlan,
    now: Date,
  ): Promise<EntitlementDecision[]> {
    const definitions = parsePlanEntitlements(subscription.planVersion.entitlements);
    const [active, groups] = await Promise.all([
      this.hasCurrentPaidPeriod(tx, subscription, now),
      tx.moneyEntitlementUsage.groupBy({
        by: ['entitlementKey'],
        where: { subscriptionId: subscription.id },
        _count: { _all: true },
      }),
    ]);
    const counts = new Map(groups.map((row) => [row.entitlementKey, row._count._all]));
    return definitions.map((definition) =>
      entitlementDecision(definitions, definition.key, counts.get(definition.key) ?? 0, active),
    );
  }

  async hasCurrentPaidPeriod(
    tx: PrismaTx,
    subscription: ProviderSubscription,
    now: Date,
  ): Promise<boolean> {
    if (subscription.status !== 'ACTIVE') return false;
    const period = await tx.subscriptionPeriod.findFirst({
      where: {
        subscriptionId: subscription.id,
        startsAt: { lte: now },
        endsAt: { gt: now },
        paymentConfirmation: {
          paymentIntent: {
            status: 'SUCCEEDED',
            providerProfileId: subscription.providerProfileId,
            planVersionId: subscription.planVersionId,
          },
          ledgerTransaction: { status: 'POSTED', kind: 'STANDARD' },
          // Until an approved refund-effect policy exists, a refunded obligation
          // cannot be used as affirmative evidence of paid capability.
          refunds: { none: { status: 'SUCCEEDED' } },
        },
      },
      select: { id: true },
    });
    return period !== null;
  }

  private async consumeInside(userId: string, input: ConsumeEntitlementInput, tx: PrismaTx) {
    const providerProfileId = await this.plans.owner(userId, tx);
    // Serialize all counters for one subscription and all lifecycle transitions.
    // The parameterized lock also protects the read/count/insert sequence from
    // concurrent distinct usage keys; a unique key alone only stops replays.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ProviderSubscription"
      WHERE "id" = ${input.subscriptionId} AND "providerProfileId" = ${providerProfileId}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new AppError('NOT_FOUND', 'Subscription not found.', 404);
    const subscription = await tx.providerSubscription.findUniqueOrThrow({
      where: { id: input.subscriptionId },
      include: { planVersion: true },
    });
    const definitions = parsePlanEntitlements(subscription.planVersion.entitlements);
    const now = subscriptionNow(this.clock);
    const active = await this.hasCurrentPaidPeriod(tx, subscription, now);
    const existing = await tx.moneyEntitlementUsage.findUnique({
      where: { subscriptionId_entitlementKey_usageKey: input },
      select: { id: true },
    });
    const used = await tx.moneyEntitlementUsage.count({
      where: { subscriptionId: input.subscriptionId, entitlementKey: input.entitlementKey },
    });
    const decision = entitlementDecision(definitions, input.entitlementKey, used, active);
    if (existing) {
      // A replay consumes nothing. Current expiry/revocation still denies access;
      // the stored usage is never interpreted as a perpetual capability grant.
      return active && decision.reason !== 'NOT_INCLUDED'
        ? consumedDecision(decision, true)
        : { ...decision, replayed: true };
    }
    if (!decision.allowed) {
      throw new AppError('CONFLICT', 'The paid entitlement is not available.', 409, {
        reason: decision.reason,
      });
    }
    if (used >= Number.MAX_SAFE_INTEGER) {
      throw new AppError('CONFLICT', 'Entitlement usage cannot be represented safely.', 409);
    }
    await tx.moneyEntitlementUsage.create({ data: input });
    return consumedDecision(
      entitlementDecision(definitions, input.entitlementKey, used + 1, active),
      false,
    );
  }
}

/** This operation succeeded even when it consumed the final available unit.
 * Remaining describes the next operation; a denial reason does not apply to
 * this already accepted or idempotently replayed operation. */
function consumedDecision(decision: EntitlementDecision, replayed: boolean) {
  return {
    allowed: true,
    key: decision.key,
    limit: decision.limit,
    used: decision.used,
    remaining: decision.remaining,
    replayed,
  };
}

function validate(input: ConsumeEntitlementInput): void {
  if (
    !input ||
    typeof input.subscriptionId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,64}$/u.test(input.subscriptionId) ||
    !validEntitlementKey(input.entitlementKey) ||
    typeof input.usageKey !== 'string' ||
    input.usageKey.length < 1 ||
    input.usageKey.length > 200 ||
    !/^[A-Za-z0-9_.:-]+$/u.test(input.usageKey)
  ) {
    throw new AppError('VALIDATION_ERROR', 'Invalid entitlement usage identity.', 400);
  }
}
