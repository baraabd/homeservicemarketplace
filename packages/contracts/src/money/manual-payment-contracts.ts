import type { MoneyContractVersion, MoneyWire, PaymentMethod } from './index';

/** Additive R30 wire surface. Policy, amounts and available actions are server-owned. */
export type ManualPaymentMethodV1 = Exclude<PaymentMethod, 'STRIPE'>;
export type ManualPaymentActionV1 =
  | 'UPLOAD_RECEIPT'
  | 'SUBMIT'
  | 'APPROVE'
  | 'REJECT'
  | 'REQUEST_REPLACEMENT'
  | 'RETRY_CONFIRMATION'
  | 'RECORD_SETTLEMENT';

export interface ManualReceiptVersionV1 {
  id: string;
  mediaAssetId: string;
  revision: number;
  contentType: string | null;
  scanStatus: string;
  createdAt: string;
  submittedAt: string | null;
  canRead: boolean;
}

export interface ManualReviewHistoryV1 {
  id: string;
  action: string;
  providerMessage: string;
  createdAt: string;
}

export interface ManualPaymentDetailV1 {
  contractVersion: MoneyContractVersion;
  paymentIntentId: string;
  method: ManualPaymentMethodV1;
  status: string;
  mode: 'SANDBOX' | 'LIVE';
  amount: MoneyWire;
  /** Explicit approved scale; null when no method policy is available. */
  minorUnitScale: number | null;
  expiresAt: string;
  version: number;
  availability: 'ENABLED' | 'METHOD_DISABLED';
  disabledReason: string | null;
  instructions: { version: string; text: { en: string; ar: string } } | null;
  currentReceiptVersionId: string | null;
  receipts: ManualReceiptVersionV1[];
  history: ManualReviewHistoryV1[];
  availableActions: ManualPaymentActionV1[];
  uploadPolicy: { maxBytes: number; allowedContentTypes: string[] } | null;
}

export interface ManualSettlementV1 {
  id: string;
  reference: string;
  amount: MoneyWire;
  occurredAt: string;
  recordedByUserId: string;
  evidenceSource: string;
  canApprove: boolean;
}

export interface ManualReviewDetailV1 extends ManualPaymentDetailV1 {
  settlements: ManualSettlementV1[];
  reviewHistory: Array<ManualReviewHistoryV1 & { internalNote: string | null }>;
  /** Safe reconciliation metadata for an authorized finance reviewer only. */
  processing?: {
    reason: string | null;
    reconciliationRequired: boolean;
    attemptCount: number;
    canRetry: boolean;
  };
}

export interface ManualPaymentQueueItemV1 {
  paymentIntentId: string;
  method: ManualPaymentMethodV1;
  amount: MoneyWire;
  minorUnitScale: number | null;
  status: string;
  updatedAt: string;
}

export interface ManualPaymentQueuePageV1 {
  items: ManualPaymentQueueItemV1[];
  nextCursor: string | null;
}

export interface ManualReceiptReservationRequestV1 {
  contentType: string;
  sizeBytes: number;
  expectedVersion: number;
  filename?: string;
}

export interface ManualReceiptReservationV1 {
  receiptVersionId: string;
  mediaAssetId: string;
  version: number;
  expiresAt: string;
  maxBytes: number;
}

export interface ManualReviewDecisionRequestV1 {
  expectedVersion: number;
  receiptVersionId: string;
  inspectionId: string;
  action: 'APPROVE' | 'REJECT' | 'REQUEST_REPLACEMENT';
  providerMessage: string;
  internalNote?: string;
  settlementId?: string;
}

export interface ManualSettlementRequestV1 {
  reference: string;
  amount: MoneyWire;
  occurredAt: string;
  /** This implementation never represents operator simulation as real settlement. */
  evidenceSource: 'SANDBOX_OPERATOR_SIMULATION';
}
