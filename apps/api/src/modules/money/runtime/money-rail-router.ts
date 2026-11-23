import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { PaymentMethod } from '@homeservicemarketplace/contracts';
import {
  ManualRailConfiguration,
  MANUAL_ADAPTER_ID,
  MANUAL_METHODS,
} from '../adapters/manual/manual-rail.config';
import { ManualCollectionAdapter } from '../adapters/manual/manual-collection.adapter';
import { ManualRefundAdapter } from '../adapters/manual/manual-refund.adapter';
import {
  StripeSandboxConfiguration,
  STRIPE_ADAPTER_ID,
} from '../adapters/stripe/stripe-sandbox.config';
import { StripeCollectionAdapter } from '../adapters/stripe/stripe-collection.adapter';
import { StripeRefundAdapter } from '../adapters/stripe/stripe-refund.adapter';
import {
  unavailableMoneyPort,
  type MoneyTransportBinding,
  type MoneyConfigurationPort,
  type MoneyCollectionAdapterPort,
  type MoneyCollectionCommand,
  type MoneyExternalEventInput,
} from '../ports/collection.port';
import type { MoneyRefundAdapterPort, MoneyRefundTransportCommand } from '../ports/refund.port';

function rail(
  binding: Pick<MoneyTransportBinding, 'mode' | 'method' | 'adapterId'>,
): 'stripe' | 'manual' | null {
  if (binding.mode !== 'SANDBOX') return null;
  if (binding.adapterId === STRIPE_ADAPTER_ID && binding.method === 'STRIPE') return 'stripe';
  if (
    binding.adapterId === MANUAL_ADAPTER_ID &&
    (MANUAL_METHODS as readonly string[]).includes(binding.method)
  )
    return 'manual';
  return null;
}
@Injectable()
export class MoneyRailConfiguration implements MoneyConfigurationPort {
  constructor(
    private readonly manual: ManualRailConfiguration,
    private readonly stripe: StripeSandboxConfiguration,
  ) {}
  resolve(input: { planVersionId: string; method: PaymentMethod }, tx: PrismaTx) {
    return input.method === 'STRIPE'
      ? this.stripe.resolve(input, tx)
      : this.manual.resolve(input, tx);
  }
  resolveBinding(binding: MoneyTransportBinding, tx: PrismaTx) {
    const selected = rail(binding);
    return selected ? this[selected].resolveBinding(binding, tx) : Promise.resolve(null);
  }
}
@Injectable()
export class MoneyCollectionRouter implements MoneyCollectionAdapterPort {
  constructor(
    private readonly manual: ManualCollectionAdapter,
    private readonly stripe: StripeCollectionAdapter,
  ) {}
  isConfigured(binding: MoneyTransportBinding): boolean {
    const selected = rail(binding);
    return selected !== null && this[selected].isConfigured(binding);
  }
  createOrResume(command: MoneyCollectionCommand) {
    const selected = rail(command.binding);
    if (!selected) throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
    // Never catch and fall back to another rail or identity after a timeout.
    return this[selected].createOrResume(command);
  }
  validateAndNormalizeExternalEvent(input: MoneyExternalEventInput) {
    if (input.mode !== 'SANDBOX') throw unavailableMoneyPort('MONEY_LIVE_DISABLED');
    if (input.adapterId === STRIPE_ADAPTER_ID)
      return this.stripe.validateAndNormalizeExternalEvent(input);
    if (input.adapterId === MANUAL_ADAPTER_ID)
      return this.manual.validateAndNormalizeExternalEvent();
    throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
  }
}
@Injectable()
export class MoneyRefundRouter implements MoneyRefundAdapterPort {
  constructor(
    private readonly manual: ManualRefundAdapter,
    private readonly stripe: StripeRefundAdapter,
  ) {}
  isConfigured(binding: MoneyTransportBinding): boolean {
    const selected = rail(binding);
    return selected !== null && this[selected].isConfigured(binding);
  }
  submit(command: MoneyRefundTransportCommand) {
    const selected = rail(command.binding);
    if (!selected) throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
    return this[selected].submit(command);
  }
  query(command: MoneyRefundTransportCommand) {
    const selected = rail(command.binding);
    if (!selected) throw unavailableMoneyPort('MONEY_REFUND_ADAPTER_UNAVAILABLE');
    return this[selected].query(command);
  }
}
