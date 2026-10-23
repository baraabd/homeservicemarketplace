import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import { z } from 'zod';
import type {
  MoneyCollectionAdapterPort,
  MoneyCollectionCommand,
  MoneyCollectionObservation,
  MoneyExternalEventInput,
  MoneyTransportBinding,
  NormalizedMoneyExternalEvent,
} from '../../ports/collection.port';
import {
  StripeBindings,
  collectionMetadata,
  paymentSchema,
  stripeAmount,
  validatePayment,
} from './stripe-bindings';
import { StripeSdk } from './stripe-sdk';
import {
  STRIPE_ADAPTER_ID,
  STRIPE_REPLAY_WINDOW_MS,
  StripeSandboxConfiguration,
  stripeError,
} from './stripe-sandbox.config';

export class StripeCollectionAdapter implements MoneyCollectionAdapterPort {
  constructor(
    private readonly config: StripeSandboxConfiguration,
    private readonly sdk: StripeSdk,
    private readonly bindings: StripeBindings,
    private readonly now: () => number = Date.now,
  ) {}
  isConfigured(binding: MoneyTransportBinding): boolean {
    return this.config.isConfigured(binding);
  }
  async createOrResume(command: MoneyCollectionCommand): Promise<MoneyCollectionObservation> {
    if (!this.isConfigured(command.binding)) throw stripeError('STRIPE_BINDING_UNAVAILABLE', 503);
    const { createdAt } = await this.bindings.collection(command);
    const unknown = {
      status: 'UNKNOWN' as const,
      externalOperationId: command.externalOperationId,
    };
    // Stripe may prune keys after 24h. Never recreate an unknown old obligation.
    if (
      !command.externalOperationId &&
      (this.now() < createdAt.getTime() ||
        this.now() - createdAt.getTime() >= STRIPE_REPLAY_WINDOW_MS)
    )
      return unknown;
    try {
      const client = await this.sdk.transport();
      const payment = validatePayment(
        command.externalOperationId
          ? await client.paymentIntents.retrieve(command.externalOperationId)
          : await client.paymentIntents.create(
              {
                amount: stripeAmount(command.amount),
                currency: command.amount.currency.toLowerCase(),
                capture_method: 'automatic',
                payment_method_types: ['card'],
                metadata: collectionMetadata(command),
              },
              { idempotencyKey: command.providerIdempotencyKey },
            ),
        command,
      );
      return {
        status:
          payment.status === 'succeeded'
            ? 'SUCCEEDED'
            : payment.status === 'canceled'
              ? 'FAILED'
              : 'PENDING',
        externalOperationId: payment.id,
      };
    } catch {
      return unknown;
    } // No raw provider error or client_secret leaves the transport.
  }
  async validateAndNormalizeExternalEvent(
    input: MoneyExternalEventInput,
  ): Promise<NormalizedMoneyExternalEvent> {
    const settings = this.config.requireEnabled();
    if (
      input.adapterId !== STRIPE_ADAPTER_ID ||
      input.mode !== 'SANDBOX' ||
      input.accountReference !== settings.accountReference
    )
      throw stripeError('STRIPE_EVENT_SCOPE_MISMATCH');
    const event = this.sdk.verify(input.payload, input.headers['stripe-signature']);
    if (event.type !== 'payment_intent.succeeded')
      throw stripeError('STRIPE_EVENT_NOT_CONFIRMATION', 400);
    const parsed = paymentSchema.safeParse(event.data.object);
    if (!parsed.success || parsed.data.status !== 'succeeded')
      throw stripeError('STRIPE_EVENT_NOT_PAID', 400);
    const command = await this.bindings.eventCommand(
      parsed.data.metadata.hsm_intent ?? '',
      parsed.data.metadata.hsm_attempt ?? '',
    );
    if (!this.isConfigured(command.binding)) throw stripeError('STRIPE_BINDING_UNAVAILABLE', 503);
    const payment = validatePayment(event.data.object, command);
    if (!payment.latest_charge) throw stripeError('STRIPE_CAPTURE_MISSING');
    const client = await this.sdk.transport();
    let charge: { created: number };
    try {
      charge = z
        .object({
          id: z.literal(payment.latest_charge),
          object: z.literal('charge'),
          payment_intent: z.literal(payment.id),
          livemode: z.literal(false),
          paid: z.literal(true),
          captured: z.literal(true),
          amount: z.literal(payment.amount),
          amount_captured: z.literal(payment.amount),
          currency: z.literal(payment.currency),
          created: z
            .number()
            .int()
            .positive()
            .max(Math.floor(this.now() / 1000) + 300),
        })
        .parse(await client.charges.retrieve(payment.latest_charge));
    } catch {
      throw stripeError('STRIPE_CAPTURE_UNVERIFIED', 503);
    }
    return {
      contractVersion: MONEY_CONTRACT_VERSION,
      adapterId: STRIPE_ADAPTER_ID,
      mode: 'SANDBOX',
      accountReference: settings.accountReference,
      externalEventId: event.id,
      externalConfirmationId: payment.id,
      externalOperationId: payment.id,
      paymentIntentId: command.paymentIntentId,
      paymentAttemptId: command.paymentAttemptId,
      source: 'PROVIDER_WEBHOOK',
      amount: command.amount,
      // Different event deliveries must retain the same economic timestamp.
      confirmedAt: new Date(charge.created * 1000).toISOString(),
      receiptMediaAssetId: null,
      reviewerUserId: null,
    };
  }
}
