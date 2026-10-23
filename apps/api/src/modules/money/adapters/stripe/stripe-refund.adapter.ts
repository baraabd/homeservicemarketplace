import { z } from 'zod';
import type { MoneyExternalEventInput, MoneyTransportBinding } from '../../ports/collection.port';
import type {
  MoneyRefundAdapterPort,
  MoneyRefundObservation,
  MoneyRefundTransportCommand,
} from '../../ports/refund.port';
import { bindingDigest, StripeBindings, stripeAmount } from './stripe-bindings';
import { StripeSdk } from './stripe-sdk';
import {
  STRIPE_ADAPTER_ID,
  STRIPE_REPLAY_WINDOW_MS,
  StripeSandboxConfiguration,
  stripeError,
} from './stripe-sandbox.config';

const refundSchema = z.object({
  id: z.string().regex(/^re_[A-Za-z0-9]{1,180}$/u),
  object: z.literal('refund'),
  payment_intent: z.string().regex(/^pi_[A-Za-z0-9]{1,180}$/u),
  amount: z.number().int().positive().max(99_999_999),
  currency: z.string().regex(/^[a-z]{3}$/u),
  status: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
  metadata: z.record(z.string(), z.string()),
});
function metadata(command: MoneyRefundTransportCommand): Record<string, string> {
  return {
    hsm_refund: command.refundId,
    hsm_confirmation: command.paymentConfirmationId,
    hsm_binding: bindingDigest(command.binding),
  };
}
export class StripeRefundAdapter implements MoneyRefundAdapterPort {
  constructor(
    private readonly config: StripeSandboxConfiguration,
    private readonly sdk: StripeSdk,
    private readonly bindings: StripeBindings,
    private readonly now: () => number = Date.now,
  ) {}
  isConfigured(binding: MoneyTransportBinding): boolean {
    return this.config.isConfigured(binding);
  }
  private observation(
    command: MoneyRefundTransportCommand,
    status: MoneyRefundObservation['status'],
    externalOperationId = command.externalOperationId,
  ): MoneyRefundObservation {
    return {
      status,
      externalOperationId,
      refundId: command.refundId,
      paymentConfirmationId: command.paymentConfirmationId,
      adapterId: command.binding.adapterId,
      mode: command.binding.mode,
      accountReference: command.binding.accountReference,
      amount: { ...command.amount },
    };
  }
  private normalize(
    value: unknown,
    command: MoneyRefundTransportCommand,
    paymentId: string,
  ): MoneyRefundObservation {
    const parsed = refundSchema.safeParse(value);
    if (!parsed.success) throw stripeError('STRIPE_REFUND_INVALID');
    const refund = parsed.data;
    if (
      refund.payment_intent !== paymentId ||
      refund.amount !== stripeAmount(command.amount) ||
      refund.currency.toUpperCase() !== command.amount.currency ||
      (command.externalOperationId && refund.id !== command.externalOperationId) ||
      Object.entries(metadata(command)).some(([key, value]) => refund.metadata[key] !== value)
    )
      throw stripeError('STRIPE_REFUND_BINDING_MISMATCH');
    return this.observation(
      command,
      refund.status === 'succeeded'
        ? 'SUCCEEDED'
        : ['failed', 'canceled'].includes(refund.status)
          ? 'FAILED'
          : 'PENDING',
      refund.id,
    );
  }
  async submit(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    if (!this.isConfigured(command.binding)) throw stripeError('STRIPE_BINDING_UNAVAILABLE', 503);
    const context = await this.bindings.refund(command);
    if (command.externalOperationId) return this.query(command);
    if (
      this.now() < context.createdAt.getTime() ||
      this.now() - context.createdAt.getTime() >= STRIPE_REPLAY_WINDOW_MS
    )
      return this.query(command);
    try {
      const client = await this.sdk.transport();
      return this.normalize(
        await client.refunds.create(
          {
            payment_intent: context.paymentId,
            amount: stripeAmount(command.amount),
            metadata: metadata(command),
          },
          { idempotencyKey: command.providerIdempotencyKey },
        ),
        command,
        context.paymentId,
      );
    } catch {
      return this.observation(command, 'UNKNOWN');
    }
  }
  async query(command: MoneyRefundTransportCommand): Promise<MoneyRefundObservation> {
    if (!this.isConfigured(command.binding)) throw stripeError('STRIPE_BINDING_UNAVAILABLE', 503);
    const context = await this.bindings.refund(command);
    try {
      const client = await this.sdk.transport();
      if (command.externalOperationId)
        return this.normalize(
          await client.refunds.retrieve(command.externalOperationId),
          command,
          context.paymentId,
        );
      let after: string | undefined;
      let found: MoneyRefundObservation | undefined;
      const seen = new Set<string>();
      // A bounded incomplete search is UNKNOWN, never proof of failure/absence.
      for (let pageNo = 0; pageNo < 10; pageNo++) {
        const page = z
          .object({
            object: z.literal('list'),
            has_more: z.boolean(),
            data: z.array(refundSchema).max(100),
          })
          .parse(
            await client.refunds.list({
              payment_intent: context.paymentId,
              limit: 100,
              ...(after ? { starting_after: after } : {}),
            }),
          );
        for (const refund of page.data) {
          if (seen.has(refund.id)) throw stripeError('STRIPE_REFUND_PAGING_UNCERTAIN');
          seen.add(refund.id);
          if (refund.metadata.hsm_refund === command.refundId) {
            if (found) throw stripeError('STRIPE_REFUND_DUPLICATE');
            found = this.normalize(refund, command, context.paymentId);
          }
        }
        if (!page.has_more) return found ?? this.observation(command, 'UNKNOWN');
        if (!page.data.length) break;
        after = page.data[page.data.length - 1]!.id;
      }
    } catch {
      /* Provider failures/ambiguous pages never release the reservation. */
    }
    return this.observation(command, 'UNKNOWN');
  }
  /** Verification only. Coordinator must durably store through R32 before ACK.
   * The public collection endpoint deliberately does not subscribe to refunds. */
  async normalizeSignedEvent(
    input: MoneyExternalEventInput,
    command: MoneyRefundTransportCommand,
  ): Promise<MoneyRefundObservation> {
    const settings = this.config.requireEnabled();
    if (
      !this.isConfigured(command.binding) ||
      input.adapterId !== STRIPE_ADAPTER_ID ||
      input.mode !== 'SANDBOX' ||
      input.accountReference !== settings.accountReference
    )
      throw stripeError('STRIPE_EVENT_SCOPE_MISMATCH');
    const event = this.sdk.verify(input.payload, input.headers['stripe-signature']);
    if (!['refund.created', 'refund.updated', 'refund.failed'].includes(event.type))
      throw stripeError('STRIPE_EVENT_NOT_REFUND', 400);
    const context = await this.bindings.refund(command);
    return this.normalize(event.data.object, command, context.paymentId);
  }
}
