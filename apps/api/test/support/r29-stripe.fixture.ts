import { toMoneyWire } from '@homeservicemarketplace/contracts';
import { randomBytes } from 'node:crypto';
import type { MoneyCollectionCommand } from '../../src/modules/money/ports/collection.port';
import type { MoneyRefundTransportCommand } from '../../src/modules/money/ports/refund.port';
import {
  bindingDigest,
  collectionMetadata,
  StripeBindings,
} from '../../src/modules/money/adapters/stripe/stripe-bindings';
import {
  STRIPE_API_VERSION,
  STRIPE_SDK_VERSION,
  StripeSandboxConfiguration,
} from '../../src/modules/money/adapters/stripe/stripe-sandbox.config';
import { StripeSdk } from '../../src/modules/money/adapters/stripe/stripe-sdk';

// Explicit SDK/DB contract doubles. Actual official-SDK signatures are tested
// separately by verify-sandbox.cjs --offline-signatures; neither is real funds.
export const clock = 1_792_800_000_000;
export function settings() {
  return {
    enabled: true as const,
    secretKey: ['sk', 'test', randomBytes(18).toString('hex')].join('_'),
    webhookSecret: ['whsec', randomBytes(18).toString('hex')].join('_'),
    accountReference: 'acct_fixture',
    expiresAt: new Date(clock + 3600_000).toISOString(),
    signatureToleranceSeconds: 300,
    bindings: [
      {
        planVersionId: 'plan',
        method: 'STRIPE' as const,
        currency: 'USD',
        adapterId: 'hsm.stripe.v1',
        mode: 'SANDBOX' as const,
        accountReference: 'acct_fixture',
        debitAccountId: 'clearing',
        creditAccountId: 'revenue',
        configVersion: 'fixture-v1',
        quoteTtlSeconds: 300,
      },
    ],
  };
}
export function fixture() {
  const input = settings();
  const config = new StripeSandboxConfiguration(input, () => clock);
  const command: MoneyCollectionCommand = {
    binding: { ...input.bindings[0]! },
    paymentIntentId: 'intent',
    paymentAttemptId: 'attempt',
    providerIdempotencyKey: 'r24_provider_stable_key_123',
    externalOperationId: null,
    amount: toMoneyWire({ amountMinor: 1234n, currency: 'USD' }),
  };
  const refundCommand: MoneyRefundTransportCommand = {
    binding: command.binding,
    refundId: 'refund',
    paymentConfirmationId: 'confirmation',
    providerIdempotencyKey: 'r24_refund_stable_key_123',
    externalOperationId: null,
    amount: toMoneyWire({ amountMinor: 234n, currency: 'USD' }),
  };
  const payment = {
    id: 'pi_fixture',
    object: 'payment_intent',
    livemode: false,
    amount: 1234,
    amount_received: 1234,
    amount_capturable: 0,
    currency: 'usd',
    capture_method: 'automatic',
    status: 'succeeded',
    latest_charge: 'ch_fixture',
    metadata: collectionMetadata(command),
  };
  const charge = {
    id: 'ch_fixture',
    object: 'charge',
    payment_intent: payment.id,
    livemode: false,
    paid: true,
    captured: true,
    amount: 1234,
    amount_captured: 1234,
    currency: 'usd',
    created: clock / 1000 - 10,
  };
  const refund = {
    id: 're_fixture',
    object: 'refund',
    payment_intent: payment.id,
    amount: 234,
    currency: 'usd',
    status: 'succeeded',
    metadata: {
      hsm_refund: refundCommand.refundId,
      hsm_confirmation: refundCommand.paymentConfirmationId,
      hsm_binding: bindingDigest(command.binding),
    },
  };
  const event = {
    id: 'evt_fixture',
    object: 'event',
    api_version: STRIPE_API_VERSION,
    livemode: false,
    created: clock / 1000,
    type: 'payment_intent.succeeded',
    data: { object: payment },
  };
  const client = {
    accounts: {
      retrieve: jest.fn().mockResolvedValue({ id: input.accountReference, object: 'account' }),
    },
    charges: { retrieve: jest.fn().mockResolvedValue(charge) },
    paymentIntents: {
      create: jest.fn().mockResolvedValue(payment),
      retrieve: jest.fn().mockResolvedValue(payment),
    },
    refunds: {
      create: jest.fn().mockResolvedValue(refund),
      retrieve: jest.fn().mockResolvedValue(refund),
      list: jest.fn().mockResolvedValue({ object: 'list', has_more: false, data: [refund] }),
    },
    webhooks: {
      constructEvent: jest.fn((bytes: Buffer) => JSON.parse(bytes.toString()) as unknown),
    },
  };
  class SdkDouble {
    static PACKAGE_VERSION = STRIPE_SDK_VERSION;
    constructor() {
      return client;
    }
    accounts = client.accounts;
    charges = client.charges;
    paymentIntents = client.paymentIntents;
    refunds = client.refunds;
    webhooks = client.webhooks;
  }
  const sdk = new StripeSdk(config, SdkDouble, () => clock);
  const bindings = {
    collection: jest.fn().mockResolvedValue({ createdAt: new Date(clock - 1000) }),
    eventCommand: jest.fn().mockResolvedValue(command),
    refund: jest
      .fn()
      .mockResolvedValue({ createdAt: new Date(clock - 1000), paymentId: payment.id }),
  };
  function envelope(value: unknown = event) {
    return {
      adapterId: 'hsm.stripe.v1',
      mode: 'SANDBOX' as const,
      accountReference: input.accountReference,
      payload: Buffer.from(JSON.stringify(value)),
      headers: { 'stripe-signature': `t=${clock / 1000},v1=fixture` },
    };
  }
  return {
    input,
    config,
    command,
    refundCommand,
    payment,
    charge,
    refund,
    event,
    client,
    sdk,
    SdkDouble,
    bindings,
    store: bindings as unknown as StripeBindings,
    envelope,
  };
}
