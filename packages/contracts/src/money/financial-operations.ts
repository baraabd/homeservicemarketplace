// R33 additive read contracts. These describe provider subscription money,
// never booking prices, a withdrawable provider balance, or live rail readiness.
import type { MoneyDispatchStatusV1 } from './api-contracts';
import type {
  FinancialProjectionV1,
  MoneyContractVersion,
  ReconciliationExceptionWireV1,
} from './financial-contracts';
import type { MoneyWire } from './wire';

export const FINANCIAL_REPORT_VERSION = 'hsm.finance-operations.v1' as const;
export const FINANCIAL_RECORD_KINDS = [
  'PAYMENT',
  'ATTEMPT',
  'REFUND_REQUEST',
  'REFUND',
  'SUBSCRIPTION',
  'SETTLEMENT',
] as const;
export type FinancialRecordKind = (typeof FINANCIAL_RECORD_KINDS)[number];

export interface FinancialReportProvenanceV1 {
  readAt: string;
  source: 'AUTHORITATIVE_PERSISTENCE';
  cache: 'NO_STORE';
}

export interface FinancialIntegrationAvailabilityV1 {
  available: boolean;
  reason: string | null;
  /** A coordinated application route, or null while the integration is absent. */
  href: string | null;
}

export interface FinancialOperationsCapabilitiesV1 {
  refund: FinancialIntegrationAvailabilityV1;
  receiptReview: FinancialIntegrationAvailabilityV1;
  myPlan: FinancialIntegrationAvailabilityV1;
  reconciliationActions: FinancialIntegrationAvailabilityV1;
}

export interface FinancialRecordV1 {
  id: string;
  kind: Exclude<FinancialRecordKind, 'SETTLEMENT'>;
  /** Persisted domain status; SUCCEEDED alone never proves a ledger posting. */
  status: string;
  amount: MoneyWire | null;
  amountMeaning:
    | 'INTENT_TOTAL'
    | 'ATTEMPT_TOTAL'
    | 'REFUND_REQUESTED'
    | 'REFUND_RESERVED'
    | 'CONFIRMED_COLLECTION'
    | 'CONFIRMED_REFUND'
    | 'CONFIRMED_SUBSCRIPTION_PERIOD'
    | 'UNAVAILABLE';
  createdAt: string;
  providerProfileId: string;
  paymentIntentId: string | null;
  paymentConfirmationId: string | null;
  ledgerTransactionId: string | null;
  confirmationState: 'NOT_APPLICABLE' | 'UNCONFIRMED' | 'CONFIRMED' | 'INCONSISTENT';
  dispatchStatus: MoneyDispatchStatusV1 | null;
  period: { startsAt: string; endsAt: string } | null;
  /** A controlled provider-visible code, never a private operator note. */
  publicReasonCode: string | null;
}

export interface FinancialRecordsQueryV1 {
  kind?: FinancialRecordKind;
  limit?: number;
  cursor?: string;
  currency?: string;
}

export interface FinancialRecordsPageV1 {
  contractVersion: MoneyContractVersion;
  reportVersion: typeof FINANCIAL_REPORT_VERSION;
  kind: FinancialRecordKind;
  items: FinancialRecordV1[];
  nextCursor: string | null;
  provenance: FinancialReportProvenanceV1;
  availability: { state: 'AVAILABLE' | 'UNAVAILABLE'; reason: string | null };
}

export interface FinancialRecordDetailV1 {
  contractVersion: MoneyContractVersion;
  reportVersion: typeof FINANCIAL_REPORT_VERSION;
  record: FinancialRecordV1;
  provenance: FinancialReportProvenanceV1;
  capabilities: FinancialOperationsCapabilitiesV1;
}

/** R34 supplies run provenance. An empty exception table is not a successful run. */
export interface FinancialReconciliationStatusV1 {
  state: 'NOT_RUN' | 'AVAILABLE' | 'UNAVAILABLE' | 'FAILED';
  lastSuccessAt: string | null;
  runId: string | null;
  reason: string | null;
}

export interface FinancialOperationsSummaryV1 {
  contractVersion: MoneyContractVersion;
  reportVersion: typeof FINANCIAL_REPORT_VERSION;
  /** The existing R24 posted-ledger authority, with its own snapshot cutoff. */
  ledger: FinancialProjectionV1;
  /** Unconfirmed obligations, counted once per intent, plus open refund requests. */
  pendingTotals: {
    currency: string;
    pending: MoneyWire;
    unknown: MoneyWire;
    refundsRequested: MoneyWire;
  }[];
  /** These mutable states are read separately from the ledger snapshot above. */
  pendingAsOf: string;
  provenance: FinancialReportProvenanceV1;
  reconciliation: FinancialReconciliationStatusV1;
  capabilities: FinancialOperationsCapabilitiesV1;
}

export interface FinancialReconciliationPageV1 {
  contractVersion: MoneyContractVersion;
  reportVersion: typeof FINANCIAL_REPORT_VERSION;
  status: FinancialReconciliationStatusV1;
  items: ReconciliationExceptionWireV1[];
  nextCursor: string | null;
  provenance: FinancialReportProvenanceV1;
  capabilities: FinancialOperationsCapabilitiesV1;
}

export const FINANCIAL_RECONCILIATION_ACTIONS = [
  'ACKNOWLEDGE',
  'REQUEST_RECHECK',
  'RESOLVE',
  'REOPEN',
] as const;
export type FinancialReconciliationAction = (typeof FINANCIAL_RECONCILIATION_ACTIONS)[number];

export interface FinancialReconciliationDetailV1 {
  contractVersion: MoneyContractVersion;
  reportVersion: typeof FINANCIAL_REPORT_VERSION;
  exception: ReconciliationExceptionWireV1;
  allowedActions: FinancialReconciliationAction[];
  provenance: FinancialReportProvenanceV1;
}

/** Coordinated R34 handoff only: R33 exposes no mutation route or balancing action. */
export interface FinancialReconciliationActionRequestV1 {
  contractVersion: MoneyContractVersion;
  exceptionId: string;
  action: FinancialReconciliationAction;
  idempotencyKey: string;
  expectedResolvedAt: string | null;
  reasonCode: string;
  /** Internal notes require separate admin-only storage and must never enter exports. */
  internalNote?: string;
}

export interface FinancialReconciliationActionResultV1 {
  contractVersion: MoneyContractVersion;
  status: 'ACCEPTED' | 'UNAVAILABLE';
  exceptionId: string;
  reason: string | null;
}

/** G3 additive frozen handoff. R34 must implement and verify this workflow.
 * No client state, empty exception list or dry run establishes reconciliation.
 * Existing v1 mutation contract remains unmounted for compatibility. */
export interface FinancialReconciliationActionRequestV2 {
  contractVersion: 'hsm.reconciliation.v2';
  exceptionId: string;
  action: FinancialReconciliationAction;
  expectedRevision: number;
  reasonCode: string;
  correctionTransactionId: string | null;
  dryRun: boolean;
  idempotencyKey: string;
  // Required on execution: hash returned by a dry run of this exact payload.
  payloadHash: string | null;
  // Required for resolution: independently authenticated checker authorization.
  approvalDecisionId: string | null;
}
export interface FinancialReconciliationActionResultV2 {
  contractVersion: 'hsm.reconciliation.v2';
  status: 'DRY_RUN' | 'ACCEPTED' | 'BLOCKED';
  exceptionId: string;
  revision: number;
  payloadHash: string;
  decisionId: string | null;
  reason: string | null;
}
export interface FinancialReconciliationProvenanceV2 {
  revision: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  sourceWindowId: string;
  lastCheckedAt: string;
  originalEvidenceDigest: string;
}
