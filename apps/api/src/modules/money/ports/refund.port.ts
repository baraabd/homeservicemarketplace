import type { MoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { unavailableMoneyPort, type MoneyTransportBinding } from './collection.port';

export const MONEY_REFUND_POLICY = Symbol('MONEY_REFUND_POLICY');
export const MONEY_REFUND_ADAPTER = Symbol('MONEY_REFUND_ADAPTER');
export const MONEY_REFUND_CONFIRMATION_PARTICIPANT = Symbol(
  'MONEY_REFUND_CONFIRMATION_PARTICIPANT',
);

/** R32 owns eligibility and entitlement consequences. R24 never invents either. */
export interface MoneyRefundPolicyPort {
  authorizeReservation(
    input: {
      refundRequestId: string;
      paymentConfirmationId: string;
      providerProfileId: string;
      requestedByUserId: string;
      reviewerUserId: string;
      amount: MoneyWire;
      reasonCode: string;
    },
    tx: PrismaTx,
  ): Promise<{ policyVersion: string }>;
}

export interface MoneyConfirmedRefund {
  refundId: string;
  refundRequestId: string;
  paymentConfirmationId: string;
  policyVersion: string;
  /** The confirmed refund amount, not the original payment's full amount. */
  amount: MoneyWire;
  compensatingLedgerTransactionId: string;
}

/** G2 freezes this additive contract, not a refund policy implementation.
 * R32/coordinator integration must invoke it only for authoritative SUCCEEDED
 * evidence, after linked compensation and before the caller commits success.
 * Re-read the approved request/policy and original obligation using tx. All
 * consequences enlist in tx and deduplicate by refundId; returning is provisional
 * until commit. Failure must roll back local money/consequence state together.
 * No network calls, separate commits, verification/work-access grants or payouts.
 * MoneyCommandService does not invoke this participant until that integration.
 */
export interface MoneyRefundConfirmationParticipantPort {
  isConfigured(): boolean;
  applyConfirmedRefund(input: MoneyConfirmedRefund, tx: PrismaTx): Promise<void>;
}

export interface MoneyRefundTransportCommand {
  binding: MoneyTransportBinding;
  refundId: string;
  paymentConfirmationId: string;
  providerIdempotencyKey: string;
  amount: MoneyWire;
  externalOperationId: string | null;
}

/** R29/R30 normalize and verify scope, correlation, amount, and finality.
 * SUCCEEDED means authoritative return confirmation, never mere acceptance;
 * financial success still requires the local compensation/participant commit.
 * FAILED requires definitive evidence for the bound external operation. Both
 * terminal outcomes require its externalOperationId. PENDING/UNKNOWN retain the
 * reservation; timeout, lease expiry or inconclusive lookup never proves failure
 * or permits a new provider key. Missing authoritative absence proof is UNKNOWN.
 */
export interface MoneyRefundObservation {
  status: 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';
  refundId: string;
  paymentConfirmationId: string;
  adapterId: string;
  mode: 'SANDBOX' | 'LIVE';
  accountReference: string;
  amount: MoneyWire;
  externalOperationId: string | null;
}

export interface MoneyRefundAdapterPort {
  isConfigured(binding: MoneyTransportBinding): boolean;
  /** No transaction is held during either operation. Retries retain the stored
   * providerIdempotencyKey and any known externalOperationId. R32 recovery must
   * query an uncertain attempt before authorizing another external action; this
   * interface does not itself select or implement that recovery operation.
   */
  submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation>;
  query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation>;
}

export class UnavailableMoneyRefundConfirmationParticipant implements MoneyRefundConfirmationParticipantPort {
  isConfigured(): boolean {
    return false;
  }
  async applyConfirmedRefund(): Promise<never> {
    throw unavailableMoneyPort('MONEY_REFUND_POLICY_UNAVAILABLE');
  }
}

export class UnavailableMoneyRefundPolicy implements MoneyRefundPolicyPort {
  async authorizeReservation(): Promise<never> {
    throw unavailableMoneyPort('MONEY_REFUND_POLICY_UNAVAILABLE');
  }
}

export class UnavailableMoneyRefundAdapter implements MoneyRefundAdapterPort {
  isConfigured(): boolean {
    return false;
  }
  async submit(): Promise<never> {
    throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
  }
  async query(): Promise<never> {
    throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
  }
}
