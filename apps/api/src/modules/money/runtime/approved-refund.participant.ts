import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { unavailableMoneyPort } from '../ports/collection.port';
import type {
  MoneyConfirmedRefund,
  MoneyRefundConfirmationParticipantPort,
} from '../ports/refund.port';
import {
  SubscriptionLifecycleService,
  unresolvedSubscriptionPolicy,
} from '../subscriptions/subscription-lifecycle.service';
import { ApprovedRefundPolicySource } from './approved-refund-policy.source';

@Injectable()
export class ApprovedRefundParticipant implements MoneyRefundConfirmationParticipantPort {
  constructor(
    private readonly source: ApprovedRefundPolicySource,
    private readonly lifecycle: SubscriptionLifecycleService,
  ) {}
  // Implementation is mounted. Each call must still resolve an approved scope/version.
  isConfigured(): boolean {
    return true;
  }
  async applyConfirmedRefund(input: MoneyConfirmedRefund, tx: PrismaTx): Promise<void> {
    const approved = await this.source.byVersion(input.policyVersion, tx);
    const original = await tx.moneyPaymentConfirmation.findUnique({
      where: { id: input.paymentConfirmationId },
      include: { paymentIntent: { include: { binding: true } } },
    });
    if (
      !approved ||
      !original?.paymentIntent.binding ||
      original.paymentIntent.binding.mode !== 'SANDBOX' ||
      approved.policy.planVersionId !== original.paymentIntent.planVersionId ||
      approved.policy.method !== original.paymentIntent.method ||
      approved.policy.currency !== original.currency
    ) {
      throw unavailableMoneyPort('MONEY_REFUND_POLICY_UNAVAILABLE');
    }
    // The existing R31 authority validates compensation, locks the subscription,
    // applies only this explicit whole-subscription effect and records its receipt.
    await this.lifecycle.applyConfirmedRefund(input, tx, {
      ...unresolvedSubscriptionPolicy,
      version: approved.policy.version,
      refundEffect: approved.effect,
    });
  }
}
