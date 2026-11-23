import { z } from 'zod';
import {
  STRIPE_API_VERSION,
  STRIPE_BODY_LIMIT,
  STRIPE_SDK_VERSION,
  StripeSandboxConfiguration,
  stripeError,
} from './stripe-sandbox.config';

/** Structural injection boundary for the official stripe-node client. The coordinator
 * owns its package/lockfile pin. No signature algorithm or HTTP SDK is reimplemented. */
export interface StripeClient {
  accounts: { retrieve(id: null): Promise<unknown> };
  charges: { retrieve(id: string): Promise<unknown> };
  paymentIntents: {
    create(
      params: {
        amount: number;
        currency: string;
        capture_method: 'automatic';
        payment_method_types: string[];
        metadata: Record<string, string>;
      },
      options: { idempotencyKey: string },
    ): Promise<unknown>;
    retrieve(id: string): Promise<unknown>;
  };
  refunds: {
    create(
      params: { payment_intent: string; amount: number; metadata: Record<string, string> },
      options: { idempotencyKey: string },
    ): Promise<unknown>;
    retrieve(id: string): Promise<unknown>;
    list(params: {
      payment_intent: string;
      limit: number;
      starting_after?: string;
    }): Promise<unknown>;
  };
  webhooks: {
    constructEvent(payload: Buffer, header: string, secret: string, tolerance: number): unknown;
  };
}
export interface StripeConstructor {
  PACKAGE_VERSION: string;
  new (
    secret: string,
    options: {
      apiVersion: typeof STRIPE_API_VERSION;
      timeout: number;
      maxNetworkRetries: number;
      telemetry: boolean;
    },
  ): StripeClient;
}
export const eventSchema = z.object({
  id: z.string().regex(/^evt_[A-Za-z0-9]{1,180}$/u),
  object: z.literal('event'),
  api_version: z.literal(STRIPE_API_VERSION),
  livemode: z.literal(false),
  account: z.string().optional(),
  context: z.string().optional(),
  created: z.number().int().positive(),
  type: z.string().max(100),
  data: z.object({ object: z.unknown() }),
});
export type StripeVerifiedEvent = z.infer<typeof eventSchema>;

export class StripeSdk {
  private readonly client: StripeClient | null;
  constructor(
    private readonly config: StripeSandboxConfiguration,
    sdk?: StripeConstructor,
    private readonly now: () => number = Date.now,
  ) {
    if (!config.isEnabled()) {
      this.client = null;
      return;
    }
    if (!sdk || sdk.PACKAGE_VERSION !== STRIPE_SDK_VERSION)
      throw stripeError('STRIPE_SDK_PIN_MISMATCH', 503);
    this.client = new sdk(config.requireEnabled().secretKey, {
      apiVersion: STRIPE_API_VERSION,
      timeout: 10_000,
      maxNetworkRetries: 0,
      telemetry: false,
    });
  }
  /** Account validation and all network I/O run outside database transactions. */
  async transport(): Promise<StripeClient> {
    const settings = this.config.requireEnabled();
    if (!this.client) throw stripeError('STRIPE_SDK_UNAVAILABLE', 503);
    const account = z
      .object({ id: z.string(), object: z.literal('account') })
      .safeParse(await this.client.accounts.retrieve(null));
    if (!account.success || account.data.id !== settings.accountReference)
      throw stripeError('STRIPE_ACCOUNT_MISMATCH');
    this.config.requireEnabled();
    return this.client;
  }
  verify(payload: unknown, signature: unknown): StripeVerifiedEvent {
    const settings = this.config.requireEnabled();
    if (!this.client) throw stripeError('STRIPE_SDK_UNAVAILABLE', 503);
    if (
      !Buffer.isBuffer(payload) ||
      payload.length === 0 ||
      payload.length > STRIPE_BODY_LIMIT ||
      typeof signature !== 'string' ||
      signature.length > 4096
    )
      throw stripeError('STRIPE_ENVELOPE_INVALID', 400);
    try {
      // Official verifier authenticates the exact Buffer. Additional future-time
      // validation also bounds signed fixtures whose timestamp is ahead of the clock.
      const verified = this.client.webhooks.constructEvent(
        payload,
        signature,
        settings.webhookSecret,
        settings.signatureToleranceSeconds,
      );
      const timestamps = signature
        .split(',')
        .filter((p) => p.startsWith('t='))
        .map((p) => p.slice(2));
      if (
        timestamps.length !== 1 ||
        !/^\d{1,12}$/u.test(timestamps[0]!) ||
        Math.abs(this.now() / 1000 - Number(timestamps[0])) > settings.signatureToleranceSeconds
      )
        throw new Error();
      const event = eventSchema.parse(verified);
      // Direct-account integration only: Connect and organization contexts are not authorized.
      if (
        event.account !== undefined ||
        event.context !== undefined ||
        event.created * 1000 > this.now() + 300_000
      )
        throw new Error();
      return event;
    } catch {
      throw stripeError('STRIPE_SIGNATURE_OR_SCOPE_INVALID', 400);
    }
  }
}
