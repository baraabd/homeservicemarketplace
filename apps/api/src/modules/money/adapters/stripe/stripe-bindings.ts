import { createHash } from 'node:crypto';
import { z } from 'zod';
import { fromMoneyWire, toMoneyWire, type MoneyWire } from '@homeservicemarketplace/contracts';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { MoneyCollectionCommand, MoneyTransportBinding } from '../../ports/collection.port';
import type { MoneyRefundTransportCommand } from '../../ports/refund.port';
import { sameBinding, stripeError } from './stripe-sandbox.config';

export function bindingDigest(binding: MoneyTransportBinding): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        binding.planVersionId,
        binding.method,
        binding.currency,
        binding.adapterId,
        binding.mode,
        binding.accountReference,
        binding.debitAccountId,
        binding.creditAccountId,
        binding.configVersion,
      ]),
    )
    .digest('hex');
}
export function stripeAmount(amount: MoneyWire): number {
  try {
    const parsed = fromMoneyWire(amount);
    if (parsed.amountMinor <= 0n || parsed.amountMinor > 99_999_999n) throw new Error();
    return Number(parsed.amountMinor);
  } catch {
    throw stripeError('STRIPE_AMOUNT_INVALID');
  }
}
export function collectionMetadata(command: MoneyCollectionCommand): Record<string, string> {
  return {
    hsm_intent: command.paymentIntentId,
    hsm_attempt: command.paymentAttemptId,
    hsm_binding: bindingDigest(command.binding),
  };
}
export const paymentSchema = z.object({
  id: z.string().regex(/^pi_[A-Za-z0-9]{1,180}$/u),
  object: z.literal('payment_intent'),
  livemode: z.literal(false),
  amount: z.number().int().positive().max(99_999_999),
  amount_received: z.number().int().min(0).max(99_999_999),
  amount_capturable: z.number().int().min(0),
  currency: z.string().regex(/^[a-z]{3}$/u),
  capture_method: z.literal('automatic'),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'canceled',
    'succeeded',
  ]),
  latest_charge: z
    .string()
    .regex(/^ch_[A-Za-z0-9]{1,180}$/u)
    .nullable(),
  metadata: z.record(z.string(), z.string()),
});
export function validatePayment(value: unknown, command: MoneyCollectionCommand) {
  const parsed = paymentSchema.safeParse(value);
  if (!parsed.success) throw stripeError('STRIPE_PAYMENT_INVALID');
  const payment = parsed.data;
  if (
    payment.amount !== stripeAmount(command.amount) ||
    payment.currency.toUpperCase() !== command.amount.currency ||
    (command.externalOperationId && payment.id !== command.externalOperationId) ||
    Object.entries(collectionMetadata(command)).some(
      ([key, value]) => payment.metadata[key] !== value,
    ) ||
    (payment.status === 'succeeded' &&
      (payment.amount_received !== payment.amount || payment.amount_capturable !== 0))
  )
    throw stripeError('STRIPE_PAYMENT_BINDING_MISMATCH');
  return payment;
}
type Intent = {
  id: string;
  planVersionId: string;
  method: string;
  currency: string;
  totalMinor: bigint;
  binding: {
    adapterId: string;
    mode: string;
    accountReference: string;
    debitAccountId: string;
    creditAccountId: string;
    configVersion: string;
  } | null;
};
function validateIntent(intent: Intent, binding: MoneyTransportBinding): void {
  if (
    !intent.binding ||
    !sameBinding(
      {
        ...intent.binding,
        planVersionId: intent.planVersionId,
        method: intent.method,
        currency: intent.currency,
      } as MoneyTransportBinding,
      binding,
    )
  )
    throw stripeError('STRIPE_DURABLE_BINDING_MISMATCH');
}

/** Read existing R24 authority; never creates an inbox, financial row or transaction. */
export class StripeBindings {
  constructor(private readonly prisma: PrismaService) {}
  async collection(command: MoneyCollectionCommand): Promise<{ createdAt: Date }> {
    const attempt = await this.prisma.client.moneyPaymentAttempt.findUnique({
      where: { id: command.paymentAttemptId },
      include: { dispatch: true, paymentIntent: { include: { binding: true } } },
    });
    if (
      !attempt ||
      !attempt.dispatch ||
      attempt.paymentIntentId !== command.paymentIntentId ||
      !['STARTED', 'SUCCEEDED'].includes(attempt.status) ||
      attempt.dispatch.kind !== 'COLLECTION' ||
      attempt.dispatch.providerIdempotencyKey !== command.providerIdempotencyKey ||
      attempt.dispatch.externalOperationId !== command.externalOperationId ||
      attempt.paymentIntent.totalMinor !== BigInt(stripeAmount(command.amount)) ||
      attempt.paymentIntent.currency !== command.amount.currency
    )
      throw stripeError('STRIPE_DURABLE_ATTEMPT_REQUIRED');
    validateIntent(attempt.paymentIntent, command.binding);
    return { createdAt: attempt.dispatch.createdAt };
  }
  async eventCommand(intentId: string, attemptId: string): Promise<MoneyCollectionCommand> {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(intentId) || !/^[A-Za-z0-9_-]{1,64}$/u.test(attemptId))
      throw stripeError('STRIPE_CORRELATION_INVALID');
    const attempt = await this.prisma.client.moneyPaymentAttempt.findUnique({
      where: { id: attemptId },
      include: { dispatch: true, paymentIntent: { include: { binding: true } } },
    });
    if (
      !attempt?.dispatch ||
      !attempt.paymentIntent.binding ||
      attempt.paymentIntentId !== intentId
    )
      throw stripeError('STRIPE_CORRELATION_MISSING');
    const intent = attempt.paymentIntent;
    const command: MoneyCollectionCommand = {
      paymentIntentId: intent.id,
      paymentAttemptId: attempt.id,
      providerIdempotencyKey: attempt.dispatch.providerIdempotencyKey,
      externalOperationId: attempt.dispatch.externalOperationId,
      amount: toMoneyWire({ amountMinor: intent.totalMinor, currency: intent.currency }),
      binding: {
        ...intent.binding!,
        planVersionId: intent.planVersionId,
        method: intent.method,
        currency: intent.currency,
      },
    };
    await this.collection(command);
    return command;
  }
  async refund(
    command: MoneyRefundTransportCommand,
  ): Promise<{ paymentId: string; createdAt: Date }> {
    const refund = await this.prisma.client.moneyRefund.findUnique({
      where: { id: command.refundId },
      include: {
        dispatch: true,
        paymentConfirmation: { include: { paymentIntent: { include: { binding: true } } } },
      },
    });
    if (
      !refund?.dispatch ||
      !['RESERVED', 'DISPATCHED', 'SUCCEEDED', 'FAILED'].includes(refund.status) ||
      refund.paymentConfirmationId !== command.paymentConfirmationId ||
      refund.amountMinor !== BigInt(stripeAmount(command.amount)) ||
      refund.currency !== command.amount.currency ||
      refund.dispatch.kind !== 'REFUND' ||
      refund.dispatch.providerIdempotencyKey !== command.providerIdempotencyKey ||
      refund.dispatch.externalOperationId !== command.externalOperationId ||
      refund.paymentConfirmation.source !== 'PROVIDER_WEBHOOK' ||
      refund.amountMinor > refund.paymentConfirmation.amountMinor
    )
      throw stripeError('STRIPE_REFUND_RESERVATION_REQUIRED');
    validateIntent(refund.paymentConfirmation.paymentIntent, command.binding);
    const events = await this.prisma.client.moneyExternalEvent.findMany({
      where: {
        paymentIntentId: refund.paymentConfirmation.paymentIntentId,
        status: 'PROCESSED',
        source: 'PROVIDER_WEBHOOK',
        adapterId: command.binding.adapterId,
        mode: 'SANDBOX',
        accountReference: command.binding.accountReference,
      },
      select: { externalOperationId: true, externalConfirmationId: true },
      distinct: ['externalOperationId'],
      take: 2,
    });
    const paymentId = events[0]?.externalOperationId;
    if (
      events.length !== 1 ||
      !paymentId ||
      !/^pi_[A-Za-z0-9]{1,180}$/u.test(paymentId) ||
      events[0]!.externalConfirmationId !== paymentId
    )
      throw stripeError('STRIPE_ORIGINAL_PAYMENT_UNPROVEN');
    return { paymentId, createdAt: refund.dispatch.createdAt };
  }
}
