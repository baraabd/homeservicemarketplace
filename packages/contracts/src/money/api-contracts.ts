// R24 additive HTTP/application surface. Existing hsm.money.v1 financial
// states retain their R19 meaning; transport knowledge is a separate field.
// These capability definitions are registered but granted to no role.
import type { MoneyContractVersion, PaymentAttemptWireV1 } from './financial-contracts';
import type { PaymentMethod } from './index';
import type { MoneyWire } from './wire';

export const MONEY_API_CAPABILITIES = [
  'money:purchase:self',
  'money:read:self',
  'money:refund:request:self',
  'money:review:read',
  'money:receipt:review',
  'money:receipt:view',
  'money:receipt:settlement',
  'money:refund:review',
] as const;
export type MoneyApiCapability = (typeof MONEY_API_CAPABILITIES)[number];

/** The server resolves the owner, price, currency, mode and accounts. */
export interface MoneyPurchaseRequestV1 {
  contractVersion: MoneyContractVersion;
  planVersionId: string;
  method: PaymentMethod;
  couponCode?: string;
}

/** Accepted work is not confirmation, activation or a completed refund. */
export interface MoneyCommandAcceptedV1 {
  contractVersion: MoneyContractVersion;
  commandId: string;
  resourceType: 'COLLECTION' | 'REFUND' | 'RECEIPT';
  resourceId: string;
  status: 'ACCEPTED';
}

export const MONEY_DISPATCH_STATUSES = [
  'NOT_DISPATCHED',
  'PENDING',
  'UNKNOWN',
  'SUCCEEDED',
  'FAILED',
] as const;
export type MoneyDispatchStatusV1 = (typeof MONEY_DISPATCH_STATUSES)[number];

export interface MoneyAttemptStatusWireV1 extends PaymentAttemptWireV1 {
  /** UNKNOWN retains the same attempt and external idempotency identity. */
  dispatchStatus: MoneyDispatchStatusV1 | null;
}

export interface MoneyRefundRequestV1 {
  contractVersion: MoneyContractVersion;
  paymentConfirmationId: string;
  amount: MoneyWire;
  reasonCode: string;
}

export interface MoneyRefundRequestWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  paymentConfirmationId: string;
  amount: MoneyWire;
  reasonCode: string;
  status: 'PENDING_POLICY' | 'AUTHORIZED' | 'REJECTED';
  refundId: string | null;
}

/** Reasons are carried in the repository error envelope's details.reason. */
export const MONEY_API_FAILURE_REASONS = [
  'MONEY_CONFIGURATION_UNAVAILABLE',
  'MONEY_COLLECTION_UNAVAILABLE',
  'MONEY_ACTIVATION_UNAVAILABLE',
  'MONEY_RECEIPT_UNAVAILABLE',
  'MONEY_REFUND_POLICY_UNAVAILABLE',
  'MONEY_REFUND_ADAPTER_UNAVAILABLE',
  'MONEY_LIVE_DISABLED',
  'MONEY_IDEMPOTENCY_CONFLICT',
  'MONEY_BINDING_MISMATCH',
  'MONEY_INTERNAL_KEY_RESERVED',
  'MONEY_CONFIRMATION_RECONCILIATION_REQUIRED',
  'MONEY_REFUND_OUTCOME_CONFLICT',
] as const;
