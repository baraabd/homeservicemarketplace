// Compile-time consumer fixture only. Never invoked by tests or runtime code.
// Synthetic identifiers and XTS select no policy, market, price or rail account.
import { toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type {
  MoneyActivationParticipantPort,
  MoneyPeriodActivation,
} from '../../src/modules/money/ports/activation.port';
import type {
  MoneyCollectionAdapterPort,
  MoneyCollectionCommand,
  MoneyExternalEventInput,
  MoneyReceiptAcceptancePort,
  MoneyTransportBinding,
} from '../../src/modules/money/ports/collection.port';
import type { MoneyFinanceReadPort } from '../../src/modules/money/ports/finance-read.port';
import type {
  MoneyConfirmedRefund,
  MoneyRefundAdapterPort,
  MoneyRefundConfirmationParticipantPort,
  MoneyRefundObservation,
  MoneyRefundPolicyPort,
  MoneyRefundTransportCommand,
} from '../../src/modules/money/ports/refund.port';

export async function g2MoneyPortsConsumerFixture(
  ports: {
    collection: MoneyCollectionAdapterPort;
    receipt: MoneyReceiptAcceptancePort;
    activation: MoneyActivationParticipantPort;
    refundPolicy: MoneyRefundPolicyPort;
    refund: MoneyRefundAdapterPort;
    refundConfirmation: MoneyRefundConfirmationParticipantPort;
    finance: MoneyFinanceReadPort;
  },
  tx: PrismaTx,
) {
  const binding: MoneyTransportBinding = {
    planVersionId: 'synthetic-plan',
    method: 'STRIPE',
    currency: 'XTS',
    adapterId: 'synthetic-adapter',
    mode: 'SANDBOX',
    accountReference: 'synthetic-account',
    debitAccountId: 'synthetic-debit',
    creditAccountId: 'synthetic-credit',
    configVersion: 'synthetic-binding-v1',
  };
  const collection: MoneyCollectionCommand = {
    binding,
    paymentIntentId: 'synthetic-intent',
    paymentAttemptId: 'synthetic-attempt',
    providerIdempotencyKey: 'synthetic-collection-0001',
    amount: toMoneyWire({ amountMinor: 9007199254740993n, currency: 'XTS' }),
    externalOperationId: null,
  };
  const externalEvent: MoneyExternalEventInput = {
    adapterId: binding.adapterId,
    mode: binding.mode,
    accountReference: binding.accountReference,
    payload: { id: 'synthetic-event' },
    headers: {},
  };
  ports.collection.isConfigured(binding);
  await ports.collection.createOrResume(collection);
  await ports.collection.validateAndNormalizeExternalEvent(externalEvent);

  const receipt: Parameters<MoneyReceiptAcceptancePort['accept']>[0] = {
    binding: { ...binding, method: 'CASH_OFFICE' },
    paymentIntentId: 'synthetic-manual-intent',
    receiptMediaAssetId: 'synthetic-receipt',
    ownerUserId: 'synthetic-provider-user',
    reviewerUserId: 'synthetic-reviewer',
    idempotencyKey: 'synthetic-receipt-0001',
  };
  ports.receipt.isConfigured(receipt.binding);
  await ports.receipt.accept(receipt, tx);

  const period: MoneyPeriodActivation = {
    providerProfileId: 'synthetic-provider',
    planVersionId: binding.planVersionId,
    paymentConfirmationId: 'synthetic-confirmation',
    subscriptionId: 'synthetic-subscription',
    subscriptionPeriodId: 'synthetic-period',
    periodStartsAt: '2026-10-17T00:00:00Z',
    periodEndsAt: '2026-11-17T00:00:00Z',
  };
  ports.activation.isConfigured();
  await ports.activation.activatePeriod(period, tx);

  const reservation: Parameters<MoneyRefundPolicyPort['authorizeReservation']>[0] = {
    refundRequestId: 'synthetic-refund-request',
    paymentConfirmationId: period.paymentConfirmationId,
    providerProfileId: period.providerProfileId,
    requestedByUserId: receipt.ownerUserId,
    reviewerUserId: receipt.reviewerUserId,
    amount: toMoneyWire({ amountMinor: 300n, currency: 'XTS' }),
    reasonCode: 'SYNTHETIC',
  };
  const approval = await ports.refundPolicy.authorizeReservation(reservation, tx);
  const refund: MoneyRefundTransportCommand = {
    binding,
    refundId: 'synthetic-refund',
    paymentConfirmationId: reservation.paymentConfirmationId,
    providerIdempotencyKey: 'synthetic-refund-0001',
    amount: reservation.amount,
    externalOperationId: null,
  };
  ports.refund.isConfigured(binding);
  const submitted: MoneyRefundObservation = await ports.refund.submit(refund);
  const queried: MoneyRefundObservation = await ports.refund.query(refund);
  const unknown: MoneyRefundObservation = {
    status: 'UNKNOWN',
    refundId: refund.refundId,
    paymentConfirmationId: refund.paymentConfirmationId,
    adapterId: binding.adapterId,
    mode: binding.mode,
    accountReference: binding.accountReference,
    amount: refund.amount,
    externalOperationId: null,
  };

  // Signature proof only: no observation above authorizes a real consequence.
  const confirmed: MoneyConfirmedRefund = {
    refundId: refund.refundId,
    refundRequestId: reservation.refundRequestId,
    paymentConfirmationId: refund.paymentConfirmationId,
    policyVersion: approval.policyVersion,
    amount: refund.amount,
    compensatingLedgerTransactionId: 'synthetic-compensation',
  };
  ports.refundConfirmation.isConfigured();
  await ports.refundConfirmation.applyConfirmedRefund(confirmed, tx);

  await ports.finance.financialProjection('synthetic-reviewer', {
    currency: 'XTS',
    asOf: '2026-10-17T00:00:00Z',
  });
  await ports.finance.exceptions('synthetic-reviewer', { limit: 10 });

  // Negative type controls protect the transaction/network boundary.
  // @ts-expect-error A provider collection operation must not take PrismaTx.
  await ports.collection.createOrResume(collection, tx);
  // @ts-expect-error A provider refund submission must not take PrismaTx.
  await ports.refund.submit(refund, tx);
  // @ts-expect-error A provider refund query must not take PrismaTx.
  await ports.refund.query(refund, tx);
  // @ts-expect-error Receipt acceptance must enlist in the caller's transaction.
  await ports.receipt.accept(receipt);
  // @ts-expect-error Period activation must enlist in the caller's transaction.
  await ports.activation.activatePeriod(period);
  // @ts-expect-error Reservation policy must read authority in the caller's transaction.
  await ports.refundPolicy.authorizeReservation(reservation);
  // @ts-expect-error Confirmed-refund consequences require the caller's transaction.
  await ports.refundConfirmation.applyConfirmedRefund(confirmed);

  return { submitted, queried, unknown };
}
