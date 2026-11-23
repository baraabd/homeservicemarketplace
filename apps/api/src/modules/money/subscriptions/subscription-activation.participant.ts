import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { AppError } from '../../../shared/errors/app-error';
import { parsePlanEntitlements } from '../entitlements/entitlement-policy';
import type {
  MoneyActivationParticipantPort,
  MoneyPeriodActivation,
} from '../ports/activation.port';
import { SubscriptionLifecycleService } from './subscription-lifecycle.service';

/** R31 participates in the R24 caller transaction and consumes R19's period.
 * It never creates a period, posts money, changes a purchased plan, grants a
 * permission or writes identity/work-access/provider-status state. */
@Injectable()
export class SubscriptionActivationParticipant implements MoneyActivationParticipantPort {
  constructor(private readonly lifecycle: SubscriptionLifecycleService) {}

  isConfigured(): boolean {
    return true;
  }

  async activatePeriod(input: MoneyPeriodActivation, tx: PrismaTx): Promise<void> {
    if (
      !tx ||
      !input ||
      ![
        'providerProfileId',
        'planVersionId',
        'paymentConfirmationId',
        'subscriptionId',
        'subscriptionPeriodId',
      ].every(
        (key) =>
          typeof input[key as keyof MoneyPeriodActivation] === 'string' &&
          /^[A-Za-z0-9_-]{1,64}$/u.test(input[key as keyof MoneyPeriodActivation]),
      )
    )
      throw mismatch();
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ProviderSubscription" WHERE "id" = ${input.subscriptionId} FOR UPDATE
    `;
    if (locked.length !== 1) throw mismatch();
    const period = await tx.subscriptionPeriod.findUnique({
      where: { id: input.subscriptionPeriodId },
      include: {
        subscription: { include: { planVersion: true } },
        paymentConfirmation: { include: { paymentIntent: true, ledgerTransaction: true } },
      },
    });
    if (!period) throw mismatch();
    const subscription = period.subscription;
    const confirmation = period.paymentConfirmation;
    const intent = confirmation.paymentIntent;
    const posting = confirmation.ledgerTransaction;
    if (
      period.subscriptionId !== input.subscriptionId ||
      period.paymentConfirmationId !== input.paymentConfirmationId ||
      subscription.providerProfileId !== input.providerProfileId ||
      subscription.planVersionId !== input.planVersionId ||
      intent.providerProfileId !== input.providerProfileId ||
      intent.planVersionId !== input.planVersionId ||
      intent.status !== 'SUCCEEDED' ||
      confirmation.amountMinor !== intent.totalMinor ||
      confirmation.currency !== intent.currency ||
      posting.currency !== intent.currency ||
      posting.status !== 'POSTED' ||
      posting.kind !== 'STANDARD' ||
      period.startsAt.toISOString() !== input.periodStartsAt ||
      period.endsAt.toISOString() !== input.periodEndsAt ||
      period.endsAt <= period.startsAt ||
      subscription.status !== 'ACTIVE'
    )
      throw mismatch();
    parsePlanEntitlements(subscription.planVersion.entitlements);
    await this.lifecycle.schedulePeriod(period, tx);
  }
}

function mismatch(): AppError {
  return new AppError(
    'CONFLICT',
    'Subscription activation does not match the confirmed obligation.',
    409,
    { reason: 'MONEY_BINDING_MISMATCH' },
  );
}
