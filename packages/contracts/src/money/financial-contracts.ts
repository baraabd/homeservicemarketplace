// R19 — frozen financial contracts, version hsm.money.v1.
//
// Scope: provider subscriptions paid TO HSM. Nothing here describes customer
// booking funds, escrow, provider payouts or withdrawals (R16, policy-blocked),
// and nothing here selects a price, currency, tax, discount or account
// purpose. Types plus constant arrays only (like index.ts); no logic.
//
// Wire rule: every amount crossing JSON is a MoneyWire (decimal string, see
// wire.ts). Internal (server) shapes use bigint.

import type {
  BillingInterval,
  PaymentIntentStatus,
  PaymentMethod,
  SubscriptionStatus,
} from './index';
import type { MoneyWire } from './wire';

export type MoneyContractVersion = 'hsm.money.v1';

// ── Quote ──────────────────────────────────────────────────────────────────

export interface QuoteWireV1 {
  contractVersion: MoneyContractVersion;
  planVersionId: string;
  paymentMethod: PaymentMethod;
  subtotal: MoneyWire;
  discount: MoneyWire;
  total: MoneyWire;
  couponId: string | null;
  expiresAt: string;
}

// ── PaymentIntent and attempts ─────────────────────────────────────────────

/** One provider purchase of one immutable plan version. Status from PAYMENT_INTENT_STATUSES. */
export interface PaymentIntentWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  providerProfileId: string;
  planVersionId: string;
  method: PaymentMethod;
  status: PaymentIntentStatus;
  subtotal: MoneyWire;
  discount: MoneyWire;
  total: MoneyWire;
  expiresAt: string;
  createdAt: string;
}

export const PAYMENT_ATTEMPT_STATUSES = ['STARTED', 'FAILED', 'SUCCEEDED', 'CANCELLED'] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

/** One try against a rail. Many attempts may exist; at most one succeeds. */
export interface PaymentAttemptWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  paymentIntentId: string;
  attemptNo: number;
  status: PaymentAttemptStatus;
  externalAttemptId: string | null;
  createdAt: string;
}

// ── Authoritative confirmation (ADR 0014 decision 6) ───────────────────────

/**
 * PROVIDER_WEBHOOK: a verified, idempotent server-side webhook from the rail.
 * MANUAL_REVIEW: an authorized admin review of a durable receipt reference.
 * A browser success page is never a confirmation source.
 */
export const PAYMENT_CONFIRMATION_SOURCES = ['PROVIDER_WEBHOOK', 'MANUAL_REVIEW'] as const;
export type PaymentConfirmationSource = (typeof PAYMENT_CONFIRMATION_SOURCES)[number];

export interface PaymentConfirmationCommandV1 {
  contractVersion: MoneyContractVersion;
  /** Client-chosen, 16-128 of [A-Za-z0-9_-]; replay returns the stored result. */
  idempotencyKey: string;
  paymentIntentId: string;
  source: PaymentConfirmationSource;
  /** The rail's own identifier for this payment (webhook event or receipt reference). */
  externalConfirmationId: string;
  /** Must equal the intent's total, in the intent's currency. */
  amount: MoneyWire;
  confirmedAt: string;
  /** MANUAL_REVIEW only: the restricted receipt MediaAsset and the reviewer. */
  receiptMediaAssetId: string | null;
  reviewerUserId: string | null;
}

export interface ReceiptReviewDecisionV1 {
  contractVersion: MoneyContractVersion;
  paymentIntentId: string;
  receiptMediaAssetId: string;
  decision: 'APPROVED' | 'REJECTED';
  /** Controlled code, never free text from the receipt. */
  reasonCode: string;
}

// ── Activation result (one period per confirmation, one posting) ──────────

export interface SubscriptionActivationResultV1 {
  contractVersion: MoneyContractVersion;
  paymentConfirmationId: string;
  subscriptionId: string;
  subscriptionPeriodId: string;
  ledgerTransactionId: string;
  periodStartsAt: string;
  periodEndsAt: string;
  status: SubscriptionStatus;
  /** True when this result is the stored one returned for a replayed key. */
  replayed: boolean;
}

// ── Refunds of subscription payments (not booking refunds) ─────────────────

export const REFUND_STATUSES = [
  'RESERVED',
  'DISPATCHED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/**
 * A refund reserves part or all of one confirmed payment. The sum of open and
 * succeeded refunds can never exceed the confirmed amount. A full refund may
 * use the ledger's exact REVERSAL; a partial refund is a separate, linked
 * compensating STANDARD posting. Dispatching it is a separate step outside
 * any database lock.
 */
export interface RefundReservationCommandV1 {
  contractVersion: MoneyContractVersion;
  idempotencyKey: string;
  paymentConfirmationId: string;
  amount: MoneyWire;
  /** Controlled code; the refund and entitlement policy is not yet decided. */
  reasonCode: string;
}

export interface RefundWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  paymentConfirmationId: string;
  amount: MoneyWire;
  status: RefundStatus;
  externalRefundId: string | null;
  compensatingLedgerTransactionId: string | null;
}

// ── Financial projections (read models) ────────────────────────────────────

/** Totals are per currency. A projection never sums across currencies. */
export interface FinancialProjectionV1 {
  contractVersion: MoneyContractVersion;
  /** Derived from posted ledger rows only. */
  source: 'LEDGER';
  totals: readonly Readonly<{ currency: string; captured: MoneyWire; refunded: MoneyWire }>[];
  asOf: string;
}

// ── Reconciliation exceptions ──────────────────────────────────────────────

export const RECONCILIATION_EXCEPTION_KINDS = [
  'CONFIRMATION_WITHOUT_POSTING',
  'POSTING_WITHOUT_CONFIRMATION',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'DUPLICATE_EXTERNAL_CONFIRMATION',
  'REFUND_WITHOUT_COMPENSATION',
  'PERIOD_WITHOUT_CONFIRMATION',
  'TIMING_DIFFERENCE',
  'MISSING_EXTERNAL_EFFECT',
  'UNMATCHED_EXTERNAL_REFERENCE',
  'MISSING_ACTIVATION',
  'AMBIGUOUS_REFUND_OUTCOME',
] as const;
export type ReconciliationExceptionKind = (typeof RECONCILIATION_EXCEPTION_KINDS)[number];

export interface ReconciliationExceptionWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  kind: ReconciliationExceptionKind;
  subjectType: 'PaymentConfirmation' | 'LedgerTransaction' | 'Refund' | 'SubscriptionPeriod';
  subjectId: string;
  detectedAt: string;
  resolvedAt: string | null;
}

// ── Subscription view ──────────────────────────────────────────────────────

export interface SubscriptionPeriodWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  subscriptionId: string;
  paymentConfirmationId: string;
  billingInterval: BillingInterval;
  startsAt: string;
  endsAt: string;
}
