import type { MoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { unavailableMoneyPort, type MoneyTransportBinding } from './collection.port';

export const MONEY_REFUND_POLICY = Symbol('MONEY_REFUND_POLICY');
export const MONEY_REFUND_ADAPTER = Symbol('MONEY_REFUND_ADAPTER');

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

export interface MoneyRefundTransportCommand {
  binding: MoneyTransportBinding;
  refundId: string;
  paymentConfirmationId: string;
  providerIdempotencyKey: string;
  amount: MoneyWire;
  externalOperationId: string | null;
}

/** R29/R30 normalize and verify scope, correlation, amount, and finality.
 * SUCCEEDED still requires R24's compensating ledger transaction before the
 * stored financial refund can become SUCCEEDED. Timeout is UNKNOWN.
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
  /** No transaction is held during either transport operation. */
  submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation>;
  query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation>;
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
