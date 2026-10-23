import { z } from 'zod';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type {
  MoneyBindingConfiguration,
  MoneyConfigurationPort,
  MoneyTransportBinding,
} from '../../ports/collection.port';
import { AppError } from '../../../../shared/errors/app-error';

export const STRIPE_ADAPTER_ID = 'hsm.stripe.v1';
export const STRIPE_API_VERSION = '2026-09-30.endive';
export const STRIPE_SDK_VERSION = '23.0.1';
export const STRIPE_BODY_LIMIT = 65_536;
export const STRIPE_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);
const bindingSchema = z
  .object({
    planVersionId: id,
    method: z.literal('STRIPE'),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    adapterId: z.literal(STRIPE_ADAPTER_ID),
    mode: z.literal('SANDBOX'),
    accountReference: z.string().regex(/^acct_[A-Za-z0-9]{1,180}$/u),
    debitAccountId: id,
    creditAccountId: id,
    configVersion: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/u),
    quoteTtlSeconds: z.number().int().min(60).max(3600),
  })
  .strict();
const settingsSchema = z
  .object({
    enabled: z.literal(true),
    secretKey: z.string().regex(/^(?:sk|rk)_test_[A-Za-z0-9]{16,200}$/u),
    webhookSecret: z.string().regex(/^whsec_[A-Za-z0-9]{16,200}$/u),
    accountReference: z.string().regex(/^acct_[A-Za-z0-9]{1,180}$/u),
    expiresAt: z.string().datetime(),
    signatureToleranceSeconds: z.number().int().min(30).max(300),
    bindings: z.array(bindingSchema).min(1).max(100),
  })
  .strict();
export type StripeSandboxSettings = z.infer<typeof settingsSchema>;

export function stripeError(reason: string, status = 409): AppError {
  return new AppError(
    status === 503 ? 'DEPENDENCY_UNAVAILABLE' : status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT',
    'Stripe sandbox operation could not be verified.',
    status,
    { reason },
  );
}

/** Explicit server configuration only. No env reads, automatic currency/price or live mode. */
export class StripeSandboxConfiguration implements MoneyConfigurationPort {
  private readonly settings: StripeSandboxSettings | null;
  constructor(
    input: unknown = null,
    private readonly now: () => number = Date.now,
  ) {
    if (input === null) {
      this.settings = null;
      return;
    }
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) throw stripeError('STRIPE_CONFIGURATION_INVALID', 503);
    const value = parsed.data;
    const expires = Date.parse(value.expiresAt);
    if (
      expires <= now() ||
      expires - now() > 86_400_000 ||
      new Set(value.bindings.map((b) => b.planVersionId)).size !== value.bindings.length ||
      value.bindings.some(
        (b) =>
          b.accountReference !== value.accountReference || b.debitAccountId === b.creditAccountId,
      )
    )
      throw stripeError('STRIPE_CONFIGURATION_INVALID', 503);
    this.settings = value;
  }
  isEnabled(): boolean {
    return this.settings !== null && Date.parse(this.settings.expiresAt) > this.now();
  }
  requireEnabled(): StripeSandboxSettings {
    if (!this.isEnabled()) throw stripeError('STRIPE_SANDBOX_UNAVAILABLE', 503);
    // Do not let callers mutate the validated configuration or credential expiry.
    return structuredClone(this.settings!);
  }
  toJSON(): object {
    return { enabled: this.isEnabled(), adapterId: STRIPE_ADAPTER_ID };
  }
  isConfigured(binding: MoneyTransportBinding): boolean {
    return this.isEnabled() && this.settings!.bindings.some((b) => sameBinding(b, binding));
  }
  async resolve(
    input: { planVersionId: string; method: string },
    _tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null> {
    const binding =
      this.isEnabled() && input.method === 'STRIPE'
        ? this.settings!.bindings.find((b) => b.planVersionId === input.planVersionId)
        : null;
    return binding ? { ...binding } : null;
  }
  async resolveBinding(
    binding: MoneyTransportBinding,
    _tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null> {
    const value = this.isEnabled()
      ? this.settings!.bindings.find((b) => sameBinding(b, binding))
      : null;
    return value ? { ...value } : null;
  }
}
export function sameBinding(a: MoneyTransportBinding, b: MoneyTransportBinding): boolean {
  return [
    'planVersionId',
    'method',
    'currency',
    'adapterId',
    'mode',
    'accountReference',
    'debitAccountId',
    'creditAccountId',
    'configVersion',
  ].every((key) => a[key as keyof MoneyTransportBinding] === b[key as keyof MoneyTransportBinding]);
}
