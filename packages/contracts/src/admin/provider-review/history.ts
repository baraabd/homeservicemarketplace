import type { ProviderOnboardingFeedback } from '../../provider/onboarding/response/provider-onboarding-feedback';

export type AdminProviderReviewHistoryKind =
  | 'SUBMITTED'
  | 'WITHDRAWN'
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'REACTIVATED'
  | 'NOTES_UPDATED'
  | 'CATEGORY_APPROVED'
  | 'CATEGORY_REJECTED'
  | 'IDENTITY_SUBMITTED'
  | 'IDENTITY_ASSIGNED'
  | 'IDENTITY_CHANGES_REQUESTED'
  | 'IDENTITY_REJECTED'
  | 'IDENTITY_APPROVED'
  | 'IDENTITY_REVOKED'
  | 'IDENTITY_REVERIFY_REQUIRED'
  | 'IDENTITY_EXPIRED'
  | 'PORTFOLIO_APPROVED'
  | 'PORTFOLIO_REJECTED'
  | 'PORTFOLIO_UPDATED';

export interface AdminProviderReviewHistoryItem {
  id: string;
  kind: AdminProviderReviewHistoryKind;
  occurredAt: string;
  actor: { id: string; displayName: string | null } | null;
  /** Null means no exact submission was recorded. Never infer from today's submission. */
  submission: {
    id: string;
    submittedAt: string;
    policyVersion: string;
    reviewedRevision: string | null;
  } | null;
  subject: { id: string; labelEn: string | null; labelAr: string | null } | null;
  contentRevision: number | null;
  reason: string | null;
  /** Available only to a reviewer with verification:decide; never in provider responses. */
  privateNote: string | null;
  feedback: ProviderOnboardingFeedback | null;
}

export interface AdminProviderReviewHistoryQuery {
  cursor?: string;
  limit?: number;
}
export interface AdminProviderReviewHistoryResponse {
  items: AdminProviderReviewHistoryItem[];
  nextCursor: string | null;
}
