import type { PrismaTx } from '@homeservicemarketplace/database';
import { unavailableMoneyPort } from './collection.port';

export const MONEY_ACTIVATION_PARTICIPANT = Symbol('MONEY_ACTIVATION_PARTICIPANT');

export interface MoneyPeriodActivation {
  providerProfileId: string;
  planVersionId: string;
  paymentConfirmationId: string;
  subscriptionId: string;
  subscriptionPeriodId: string;
  periodStartsAt: string;
  periodEndsAt: string;
}

/** R31 consumes the existing R19 period, never creates a second billing period.
 * All effects enlist in tx; subscriptionPeriodId is the durable dedupe identity.
 * Returning resolves a provisional participant result, not a separate commit.
 */
export interface MoneyActivationParticipantPort {
  isConfigured(): boolean;
  activatePeriod(input: MoneyPeriodActivation, tx: PrismaTx): Promise<void>;
}

export class UnavailableMoneyActivationParticipant implements MoneyActivationParticipantPort {
  isConfigured(): boolean {
    return false;
  }
  async activatePeriod(): Promise<never> {
    throw unavailableMoneyPort('MONEY_ACTIVATION_UNAVAILABLE');
  }
}
