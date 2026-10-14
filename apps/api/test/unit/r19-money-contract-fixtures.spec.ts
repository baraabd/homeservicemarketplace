// R19 — consumer fixtures for hsm.money.v1 (docs/production-readiness/r19/
// contract-fixtures). Later lanes (R24 ports, rail adapters, subscription
// engine, refunds, financial UI) build against these files. Each fixture's key
// set is tied to its TypeScript interface at compile time (`satisfies
// Record<keyof I, true>`), and every amount is parsed by the real wire
// helpers. No payment-provider credential or network is involved.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  fromMoneyWire,
  MONEY_CONTRACT_VERSION,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_CONFIRMATION_SOURCES,
  PAYMENT_INTENT_STATUSES,
  PAYMENT_METHODS,
  RECONCILIATION_EXCEPTION_KINDS,
  REFUND_STATUSES,
  SUBSCRIPTION_STATUSES,
  BILLING_INTERVALS,
  type FinancialProjectionV1,
  type PaymentAttemptWireV1,
  type PaymentConfirmationCommandV1,
  type PaymentIntentWireV1,
  type QuoteWireV1,
  type ReceiptReviewDecisionV1,
  type ReconciliationExceptionWireV1,
  type RefundReservationCommandV1,
  type RefundWireV1,
  type SubscriptionActivationResultV1,
  type SubscriptionPeriodWireV1,
} from '@homeservicemarketplace/contracts';

const DIR = join(
  __dirname,
  '../../../../docs/production-readiness/r19/contract-fixtures/hsm.money.v1',
);
const load = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DIR, file), 'utf8'));

const QUOTE = {
  contractVersion: true,
  planVersionId: true,
  paymentMethod: true,
  subtotal: true,
  discount: true,
  total: true,
  couponId: true,
  expiresAt: true,
} satisfies Record<keyof QuoteWireV1, true>;
const INTENT = {
  contractVersion: true,
  id: true,
  providerProfileId: true,
  planVersionId: true,
  method: true,
  status: true,
  subtotal: true,
  discount: true,
  total: true,
  expiresAt: true,
  createdAt: true,
} satisfies Record<keyof PaymentIntentWireV1, true>;
const ATTEMPT = {
  contractVersion: true,
  id: true,
  paymentIntentId: true,
  attemptNo: true,
  status: true,
  externalAttemptId: true,
  createdAt: true,
} satisfies Record<keyof PaymentAttemptWireV1, true>;
const CONFIRMATION = {
  contractVersion: true,
  idempotencyKey: true,
  paymentIntentId: true,
  source: true,
  externalConfirmationId: true,
  amount: true,
  confirmedAt: true,
  receiptMediaAssetId: true,
  reviewerUserId: true,
} satisfies Record<keyof PaymentConfirmationCommandV1, true>;
const REVIEW = {
  contractVersion: true,
  paymentIntentId: true,
  receiptMediaAssetId: true,
  decision: true,
  reasonCode: true,
} satisfies Record<keyof ReceiptReviewDecisionV1, true>;
const ACTIVATION = {
  contractVersion: true,
  paymentConfirmationId: true,
  subscriptionId: true,
  subscriptionPeriodId: true,
  ledgerTransactionId: true,
  periodStartsAt: true,
  periodEndsAt: true,
  status: true,
  replayed: true,
} satisfies Record<keyof SubscriptionActivationResultV1, true>;
const RESERVATION = {
  contractVersion: true,
  idempotencyKey: true,
  paymentConfirmationId: true,
  amount: true,
  reasonCode: true,
} satisfies Record<keyof RefundReservationCommandV1, true>;
const REFUND = {
  contractVersion: true,
  id: true,
  paymentConfirmationId: true,
  amount: true,
  status: true,
  externalRefundId: true,
  compensatingLedgerTransactionId: true,
} satisfies Record<keyof RefundWireV1, true>;
const PROJECTION = {
  contractVersion: true,
  source: true,
  totals: true,
  asOf: true,
} satisfies Record<keyof FinancialProjectionV1, true>;
const EXCEPTION = {
  contractVersion: true,
  id: true,
  kind: true,
  subjectType: true,
  subjectId: true,
  detectedAt: true,
  resolvedAt: true,
} satisfies Record<keyof ReconciliationExceptionWireV1, true>;
const PERIOD = {
  contractVersion: true,
  id: true,
  subscriptionId: true,
  paymentConfirmationId: true,
  billingInterval: true,
  startsAt: true,
  endsAt: true,
} satisfies Record<keyof SubscriptionPeriodWireV1, true>;

const CASES: Array<[string, Record<string, true>, (f: Record<string, unknown>) => void]> = [
  [
    'quote.json',
    QUOTE,
    (f) => {
      expect(PAYMENT_METHODS).toContain(f.paymentMethod);
      const [subtotal, discount, total] = [f.subtotal, f.discount, f.total].map(fromMoneyWire);
      expect(subtotal.amountMinor - discount.amountMinor).toBe(total.amountMinor);
      expect(new Set([subtotal.currency, discount.currency, total.currency]).size).toBe(1);
    },
  ],
  [
    'payment-intent.json',
    INTENT,
    (f) => {
      expect(PAYMENT_METHODS).toContain(f.method);
      expect(PAYMENT_INTENT_STATUSES).toContain(f.status);
      [f.subtotal, f.discount, f.total].forEach(fromMoneyWire);
    },
  ],
  ['payment-attempt.json', ATTEMPT, (f) => expect(PAYMENT_ATTEMPT_STATUSES).toContain(f.status)],
  [
    'confirmation-webhook.json',
    CONFIRMATION,
    (f) => {
      expect(f.source).toBe('PROVIDER_WEBHOOK');
      expect([f.receiptMediaAssetId, f.reviewerUserId]).toEqual([null, null]);
      fromMoneyWire(f.amount);
    },
  ],
  [
    'confirmation-manual.json',
    CONFIRMATION,
    (f) => {
      expect(PAYMENT_CONFIRMATION_SOURCES).toContain(f.source);
      expect(f.source).toBe('MANUAL_REVIEW');
      expect(f.receiptMediaAssetId && f.reviewerUserId).toBeTruthy();
      fromMoneyWire(f.amount);
    },
  ],
  ['receipt-review.json', REVIEW, (f) => expect(['APPROVED', 'REJECTED']).toContain(f.decision)],
  ['activation-result.json', ACTIVATION, (f) => expect(SUBSCRIPTION_STATUSES).toContain(f.status)],
  [
    'refund-reservation.json',
    RESERVATION,
    (f) => expect(fromMoneyWire(f.amount).amountMinor).toBeGreaterThan(0n),
  ],
  [
    'refund.json',
    REFUND,
    (f) => {
      expect(REFUND_STATUSES).toContain(f.status);
      fromMoneyWire(f.amount);
    },
  ],
  [
    'financial-projection.json',
    PROJECTION,
    (f) => {
      const totals = f.totals as Array<Record<string, unknown>>;
      // One row per currency, each amount in its own row's currency.
      expect(new Set(totals.map((t) => t.currency)).size).toBe(totals.length);
      for (const row of totals) {
        expect(fromMoneyWire(row.captured).currency).toBe(row.currency);
        expect(fromMoneyWire(row.refunded).currency).toBe(row.currency);
      }
      // Precision beyond 2^53 survives the wire.
      expect(fromMoneyWire(totals[0].captured).amountMinor).toBe(9007199254740993n);
    },
  ],
  [
    'reconciliation-exception.json',
    EXCEPTION,
    (f) => expect(RECONCILIATION_EXCEPTION_KINDS).toContain(f.kind),
  ],
  [
    'subscription-period.json',
    PERIOD,
    (f) => expect(BILLING_INTERVALS).toContain(f.billingInterval),
  ],
];

describe('R19 hsm.money.v1 consumer fixtures', () => {
  it('every fixture file is covered by a case, and every case has a file', () => {
    const files = readdirSync(DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(files).toEqual(CASES.map(([file]) => file).sort());
  });

  it.each(CASES)('%s matches its frozen contract exactly', (file, keys, check) => {
    const fixture = load(file);
    expect(String(fixture._fixture)).toMatch(/^NON_PRODUCTION/u);
    const { _fixture, ...body } = fixture;
    void _fixture;
    expect(Object.keys(body).sort()).toEqual(Object.keys(keys).sort());
    expect(body.contractVersion).toBe(MONEY_CONTRACT_VERSION);
    check(body);
  });
});
