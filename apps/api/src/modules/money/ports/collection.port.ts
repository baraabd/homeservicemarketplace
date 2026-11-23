import type {
  MoneyContractVersion,
  MoneyWire,
  PaymentConfirmationSource,
  PaymentMethod,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { AppError } from '../../../shared/errors/app-error';
import type { MoneyCatalogPort } from '../money-application';

export const MONEY_CONFIGURATION = Symbol('MONEY_CONFIGURATION');
export const MONEY_CATALOG = Symbol('MONEY_CATALOG');
export const MONEY_COLLECTION_ADAPTER = Symbol('MONEY_COLLECTION_ADAPTER');
export const MONEY_RECEIPT_ACCEPTANCE = Symbol('MONEY_RECEIPT_ACCEPTANCE');

/** Server-selected, immutable obligation identity. It is never an HTTP input. */
export interface MoneyTransportBinding {
  planVersionId: string;
  method: PaymentMethod;
  currency: string;
  adapterId: string;
  mode: 'SANDBOX' | 'LIVE';
  accountReference: string;
  debitAccountId: string;
  creditAccountId: string;
  configVersion: string;
}

export interface MoneyBindingConfiguration extends MoneyTransportBinding {
  quoteTtlSeconds: number;
}

export interface MoneyConfigurationPort {
  resolve(
    input: { planVersionId: string; method: PaymentMethod },
    tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null>;
  /** Optional version lookup: old obligations retain their immutable instructions. */
  resolveBinding?(
    binding: MoneyTransportBinding,
    tx: PrismaTx,
  ): Promise<MoneyBindingConfiguration | null>;
}

export interface MoneyCatalogFactory {
  forTransaction(tx: PrismaTx): MoneyCatalogPort;
}

/** Reuses R19 pricing; publication and every catalog read use the caller's tx. */
export class PrismaMoneyCatalogFactory implements MoneyCatalogFactory {
  forTransaction(tx: PrismaTx): MoneyCatalogPort {
    return {
      async findPublishedPlanVersion(id) {
        const row = await tx.subscriptionPlanVersion.findFirst({
          where: { id, retiredAt: null, publishedAt: { lte: new Date() } },
        });
        return row
          ? {
              id: row.id,
              planId: row.planKey,
              billingInterval: row.billingInterval,
              priceMinor: row.priceMinor,
              currency: row.currency,
              publishedAt: row.publishedAt,
              retiredAt: row.retiredAt,
            }
          : null;
      },
      findCouponByCode: (code) => tx.moneyCoupon.findUnique({ where: { code } }),
      countCouponRedemptions: (couponId) => tx.moneyCouponRedemption.count({ where: { couponId } }),
      countProviderCouponRedemptions: (couponId, providerProfileId) =>
        tx.moneyCouponRedemption.count({ where: { couponId, providerProfileId } }),
    };
  }
}

export interface MoneyCollectionCommand {
  binding: MoneyTransportBinding;
  paymentIntentId: string;
  paymentAttemptId: string;
  providerIdempotencyKey: string;
  amount: MoneyWire;
  externalOperationId: string | null;
}

/** A transport observation is not a ledger posting or an activation. */
export interface MoneyCollectionObservation {
  status: 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED';
  externalOperationId: string | null;
}

export interface MoneyExternalEventInput {
  adapterId: string;
  mode: 'SANDBOX' | 'LIVE';
  accountReference: string;
  payload: unknown;
  headers: Readonly<Record<string, string>>;
}

/** Returned only after the configured adapter validates its external evidence. */
export interface NormalizedMoneyExternalEvent {
  contractVersion: MoneyContractVersion;
  adapterId: string;
  mode: 'SANDBOX' | 'LIVE';
  accountReference: string;
  externalEventId: string;
  externalConfirmationId: string;
  /** Collection operation correlation; distinct from event/capture identities. */
  externalOperationId: string | null;
  paymentIntentId: string;
  paymentAttemptId: string | null;
  source: PaymentConfirmationSource;
  amount: MoneyWire;
  confirmedAt: string;
  receiptMediaAssetId: string | null;
  reviewerUserId: string | null;
}

export interface MoneyCollectionAdapterPort {
  isConfigured(binding: MoneyTransportBinding): boolean;
  /** No PrismaTx: the durable attempt and provider key precede network dispatch. */
  createOrResume(command: MoneyCollectionCommand): Promise<MoneyCollectionObservation>;
  validateAndNormalizeExternalEvent(
    input: MoneyExternalEventInput,
  ): Promise<NormalizedMoneyExternalEvent>;
}

export interface MoneyReceiptAcceptancePort {
  isConfigured(binding: MoneyTransportBinding): boolean;
  /** R30 owns receipt acceptance. No network calls or separate commit in this tx. */
  accept(
    input: {
      binding: MoneyTransportBinding;
      paymentIntentId: string;
      receiptMediaAssetId: string;
      ownerUserId: string;
      reviewerUserId: string;
      idempotencyKey: string;
    },
    tx: PrismaTx,
  ): Promise<NormalizedMoneyExternalEvent>;
  /** Final financial validation/decision participates in the R24 activation tx.
   * Staging a received event is never final receipt approval. */
  finalizeConfirmation?(event: NormalizedMoneyExternalEvent, tx: PrismaTx): Promise<void>;
}

export class UnavailableMoneyConfiguration implements MoneyConfigurationPort {
  async resolve(): Promise<null> {
    return null;
  }
}

export class UnavailableMoneyCollectionAdapter implements MoneyCollectionAdapterPort {
  isConfigured(): boolean {
    return false;
  }
  async createOrResume(): Promise<never> {
    throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
  }
  async validateAndNormalizeExternalEvent(): Promise<never> {
    throw unavailableMoneyPort('MONEY_COLLECTION_UNAVAILABLE');
  }
}

export class UnavailableMoneyReceiptAcceptance implements MoneyReceiptAcceptancePort {
  isConfigured(): boolean {
    return false;
  }
  async accept(): Promise<never> {
    throw unavailableMoneyPort('MONEY_RECEIPT_UNAVAILABLE');
  }
}

export function unavailableMoneyPort(reason: string): AppError {
  return new AppError('DEPENDENCY_UNAVAILABLE', 'This money operation is not configured.', 503, {
    reason,
  });
}
