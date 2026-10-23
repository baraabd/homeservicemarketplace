// R31 additive read projections of the existing R19/R24 money authority.
// Amounts retain MoneyWire precision; these types choose no commercial policy.
import type {
  BillingInterval,
  EntitlementDecision,
  PlanEntitlementContract,
  SubscriptionContract,
  SubscriptionStatus,
} from './index';
import type {
  MoneyContractVersion,
  PaymentAttemptStatus,
  PaymentIntentWireV1,
  SubscriptionPeriodWireV1,
} from './financial-contracts';
import type { MoneyWire } from './wire';

export interface MoneyPlanVersionWireV1 {
  contractVersion: MoneyContractVersion;
  id: string;
  planKey: string;
  version: number;
  billingInterval: BillingInterval;
  price: MoneyWire;
  entitlements: readonly PlanEntitlementContract[];
  publishedAt: string;
  retiredAt: string | null;
}

export interface MoneyPlanCatalogWireV1 {
  contractVersion: MoneyContractVersion;
  items: readonly MoneyPlanVersionWireV1[];
  nextCursor: string | null;
}

export type MoneySubscriptionPresentationState =
  | 'NONE'
  | 'PENDING_PAYMENT'
  | 'ACTION_REQUIRED'
  | 'FAILED'
  | 'ACTIVE'
  | 'SCHEDULED'
  | 'EXPIRED'
  | 'SUSPENDED'
  | 'CANCELLED';

/** Existing R24 GET /money/subscriptions shape, now published for consumers. */
export type MoneySubscriptionSummaryWireV1 = SubscriptionContract & {
  contractVersion: MoneyContractVersion;
};

export interface MoneySubscriptionPageWireV1 {
  items: readonly MoneySubscriptionSummaryWireV1[];
  nextCursor: string | null;
}

/** A failed collection attempt can leave the intent open for an explicit
 * retry. Preserve both recorded facts without inferring subscription access. */
export interface MoneyMyPlanPaymentWireV1 extends PaymentIntentWireV1 {
  latestAttemptStatus: PaymentAttemptStatus | null;
}

/** Server-owned view of one owned subscription, selected by subscriptionId
 * or the server's current selection. History is scoped to that subscription;
 * the existing paginated list exposes the account's other purchases. */
export interface MoneyMyPlanWireV1 {
  contractVersion: MoneyContractVersion;
  asOf: string;
  status: MoneySubscriptionPresentationState;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    plan: MoneyPlanVersionWireV1;
    currentPeriod: SubscriptionPeriodWireV1 | null;
    nextPeriod: SubscriptionPeriodWireV1 | null;
  } | null;
  entitlements: readonly EntitlementDecision[];
  history: readonly SubscriptionPeriodWireV1[];
  historyHasMore: boolean;
  payment: MoneyMyPlanPaymentWireV1 | null;
  policy: {
    state: 'POLICY_BLOCKED';
    blockers: readonly string[];
    canCancel: false;
    canRenew: false;
    canApplyCoupon: false;
  };
  grantsIdentityVerification: false;
  grantsWorkAccess: false;
}
