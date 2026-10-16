// Compile-time consumer fixture only. Not a payment adapter or runtime evidence.
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { QuoteWireV1, ReceiptReviewDecisionV1 } from '@homeservicemarketplace/contracts';
import type {
  MoneyCommandContextV1,
  QuoteCreationPortV1,
  PaymentLifecyclePortV1,
  ReceiptReviewPortV1,
  RefundPortV1,
  FinancialProjectionPortV1,
  ReconciliationPortV1,
} from '../../src/modules/money/domain/money-ports.v1';

export async function moneyPortConsumerFixture(
  ports: {
    quote: QuoteCreationPortV1;
    lifecycle: PaymentLifecyclePortV1;
    receipt: ReceiptReviewPortV1;
    refund: RefundPortV1;
    projection: FinancialProjectionPortV1;
    reconciliation: ReconciliationPortV1;
  },
  context: MoneyCommandContextV1,
  quote: QuoteWireV1,
  receipt: ReceiptReviewDecisionV1,
  tx: PrismaTx,
) {
  await ports.quote.quote(
    {
      ...context,
      providerProfileId: 'synthetic-provider',
      planVersionId: 'synthetic-plan',
      method: 'STRIPE',
    },
    tx,
  );
  await ports.lifecycle.createIntent(
    { ...context, providerProfileId: 'synthetic-provider', quote },
    tx,
  );
  await ports.lifecycle.startAttempt({ ...context, paymentIntentId: 'synthetic-intent' }, tx);
  await ports.lifecycle.recordAttempt(
    { ...context, attemptId: 'synthetic-attempt', outcome: 'FAILED' },
    tx,
  );
  await ports.lifecycle.cancelIntent({ ...context, paymentIntentId: 'synthetic-intent' }, tx);
  await ports.receipt.review({ ...context, ...receipt, reviewerUserId: 'synthetic-reviewer' }, tx);
  await ports.refund.reserve(
    {
      ...context,
      paymentConfirmationId: 'synthetic-confirmation',
      amountMinor: 9007199254740993n,
      currency: 'XTS',
      reasonCode: 'SYNTHETIC',
    },
    tx,
  );
  await ports.refund.dispatch({ ...context, refundId: 'synthetic-refund' }); // no transaction across network
  await ports.refund.recordResult(
    {
      ...context,
      refundId: 'synthetic-refund',
      externalRefundId: 'synthetic-external',
      outcome: 'FAILED',
      compensatingLedgerTransactionId: null,
    },
    tx,
  );
  await ports.projection.read(
    { contractVersion: 'hsm.money.v1', currency: 'XTS', asOf: '2026-10-16T00:00:00Z' },
    tx,
  );
  await ports.reconciliation.record(
    {
      ...context,
      kind: 'REFUND_WITHOUT_COMPENSATION',
      subjectType: 'Refund',
      subjectId: 'synthetic-refund',
    },
    tx,
  );
  await ports.reconciliation.list({ contractVersion: 'hsm.money.v1', limit: 10 });
}
