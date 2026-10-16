import type {
  FinancialProjectionV1,
  MoneyContractVersion,
  PaymentAttemptWireV1,
  PaymentIntentWireV1,
  PaymentMethod,
  QuoteWireV1,
  ReceiptReviewDecisionV1,
  ReconciliationExceptionKind,
  ReconciliationExceptionWireV1,
  RefundWireV1,
  SubscriptionActivationResultV1,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { ConfirmAndActivateCommand } from './subscription-activation.service';

/** Frozen server ports for R24 and subsequent adapters. No HTTP or live implementation.
 * Consumers authorize fresh capabilities and resource ownership before calling.
 * Caller-owned tx results remain provisional until commit; network dispatch takes no tx.
 * Every write is idempotent: equal key/payload replays; changed payload conflicts.
 */
export interface MoneyCommandContextV1 {
  contractVersion: MoneyContractVersion;
  idempotencyKey: string;
  actor: { kind: 'USER'; userId: string } | { kind: 'SYSTEM'; system: string };
}
export interface QuoteCreationPortV1 {
  quote(
    command: MoneyCommandContextV1 & {
      providerProfileId: string;
      planVersionId: string;
      method: PaymentMethod;
      couponCode?: string;
    },
    tx?: PrismaTx,
  ): Promise<QuoteWireV1>;
}
export interface PaymentLifecyclePortV1 {
  createIntent(
    command: MoneyCommandContextV1 & {
      providerProfileId: string;
      quote: QuoteWireV1;
    },
    tx?: PrismaTx,
  ): Promise<PaymentIntentWireV1>;
  startAttempt(
    command: MoneyCommandContextV1 & { paymentIntentId: string },
    tx?: PrismaTx,
  ): Promise<PaymentAttemptWireV1>;
  recordAttempt(
    command: MoneyCommandContextV1 & {
      attemptId: string;
      outcome: 'FAILED' | 'CANCELLED';
      externalAttemptId?: string;
    },
    tx?: PrismaTx,
  ): Promise<PaymentAttemptWireV1>;
  cancelIntent(
    command: MoneyCommandContextV1 & { paymentIntentId: string },
    tx?: PrismaTx,
  ): Promise<PaymentIntentWireV1>;
}
export interface ReceiptReviewPortV1 {
  review(
    command: MoneyCommandContextV1 & ReceiptReviewDecisionV1 & { reviewerUserId: string },
    tx?: PrismaTx,
  ): Promise<ReceiptReviewDecisionV1>;
}
export interface SubscriptionActivationPortV1 {
  /** Only authoritative confirmation after adapter validation; never a browser acknowledgement. */
  confirmAndActivate(
    command: ConfirmAndActivateCommand,
    tx?: PrismaTx,
  ): Promise<SubscriptionActivationResultV1>;
}
export interface RefundPortV1 {
  reserve(
    command: MoneyCommandContextV1 & {
      paymentConfirmationId: string;
      amountMinor: bigint;
      currency: string;
      reasonCode: string;
    },
    tx?: PrismaTx,
  ): Promise<RefundWireV1>;
  /** Outside transaction locks; provider acceptance is not final financial success. */
  dispatch(
    command: MoneyCommandContextV1 & { refundId: string },
  ): Promise<{ refundId: string; externalRefundId: string; status: 'DISPATCHED' }>;
  recordResult(
    command: MoneyCommandContextV1 & {
      refundId: string;
      externalRefundId: string;
      outcome: 'SUCCEEDED' | 'FAILED';
      compensatingLedgerTransactionId: string | null;
    },
    tx?: PrismaTx,
  ): Promise<RefundWireV1>;
}
export interface FinancialProjectionPortV1 {
  read(
    input: {
      contractVersion: MoneyContractVersion;
      providerProfileId?: string;
      currency: string;
      asOf: string;
    },
    tx?: PrismaTx,
  ): Promise<FinancialProjectionV1>;
}
export interface ReconciliationPortV1 {
  record(
    command: MoneyCommandContextV1 & {
      kind: ReconciliationExceptionKind;
      subjectType: ReconciliationExceptionWireV1['subjectType'];
      subjectId: string;
    },
    tx?: PrismaTx,
  ): Promise<ReconciliationExceptionWireV1>;
  list(input: {
    contractVersion: MoneyContractVersion;
    limit: number;
    cursor?: string;
  }): Promise<{ items: ReconciliationExceptionWireV1[]; nextCursor: string | null }>;
}
