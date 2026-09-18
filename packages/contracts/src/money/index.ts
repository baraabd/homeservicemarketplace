export type CurrencyCode = string;
export type Money = Readonly<{ amountMinor: bigint; currency: CurrencyCode }>;

export const BILLING_INTERVALS = ['MONTHLY', 'ANNUAL'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const PAYMENT_METHODS = ['STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_INTENT_STATUSES = ['CREATED','AWAITING_PAYMENT','PROCESSING','SUCCEEDED','FAILED','CANCELLED','EXPIRED'] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['PENDING_PAYMENT','ACTIVE','EXPIRED','SUSPENDED','CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type EntitlementValue =
  | Readonly<{ kind: 'BOOLEAN'; enabled: boolean }>
  | Readonly<{ kind: 'LIMIT'; limit: number | null }>;

export interface PlanEntitlementContract {
  key: string;
  value: EntitlementValue;
}

export interface PublishedPlanVersionContract {
  id: string;
  planId: string;
  version: number;
  billingInterval: BillingInterval;
  priceMinor: bigint;
  currency: CurrencyCode;
  entitlements: readonly PlanEntitlementContract[];
  publishedAt: string;
}

export interface QuoteRequestContract {
  planVersionId: string;
  couponCode?: string;
  paymentMethod: PaymentMethod;
}

export interface QuoteContract {
  planVersionId: string;
  currency: CurrencyCode;
  subtotalMinor: bigint;
  discountMinor: bigint;
  totalMinor: bigint;
  couponId?: string;
  expiresAt: string;
}

export interface PaymentIntentContract extends QuoteContract {
  id: string;
  providerProfileId: string;
  method: PaymentMethod;
  status: PaymentIntentStatus;
}

export interface SubscriptionContract {
  id: string;
  providerProfileId: string;
  planVersionId: string;
  status: SubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
}

export type EntitlementDecision = Readonly<{
  allowed: boolean;
  key: string;
  limit: number | null;
  used: number;
  remaining: number | null;
  reason?: 'NO_ACTIVE_SUBSCRIPTION' | 'NOT_INCLUDED' | 'LIMIT_REACHED';
}>;

export type LedgerSide = 'DEBIT' | 'CREDIT';
export interface LedgerEntryContract {
  accountId: string;
  side: LedgerSide;
  amountMinor: bigint;
  currency: CurrencyCode;
}
