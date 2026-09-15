import type { ProviderCapabilitiesResponse } from '../../provider/capabilities/response/provider-capabilities.response';
import type { ProviderReviewSnapshot } from '../../provider/onboarding/response/provider-review-snapshot';
import type { ProviderOnboardingFeedback } from '../../provider/onboarding/response/provider-onboarding-feedback';
import type { AdminVerificationCase } from '../verification/response/admin-verification-case';
import type { PendingCategorySummary } from '../category-applications/response/pending-category-summary';

export const ADMIN_PROVIDER_REVIEW_TASK_IDS = [
  'BASICS_IDENTITY',
  'SERVICES_EXPERIENCE',
  'WORK_AREA',
  'WORKING_HOURS',
  'PORTFOLIO',
  'REVIEW_SUBMISSION',
] as const;
export type AdminProviderReviewTaskId = (typeof ADMIN_PROVIDER_REVIEW_TASK_IDS)[number];
export type AdminProviderReviewAction = 'approve' | 'requestChanges';

export interface AdminProviderReviewBlocker {
  code:
    | 'SELF_REVIEW'
    | 'PERMISSION_REQUIRED'
    | 'ACCOUNT_INELIGIBLE'
    | 'PROVIDER_RESTRICTED'
    | 'NOT_SUBMITTED'
    | 'SUBMISSION_ALREADY_DECIDED'
    | 'SNAPSHOT_UNAVAILABLE'
    | 'SUBMITTED_CONTENT_CHANGED'
    | 'CATEGORY_REVIEW_REQUIRED'
    | 'NO_APPROVED_SPECIALTY'
    | 'VERIFICATION_REQUIRED'
    | 'EVIDENCE_NOT_READY'
    | 'WORK_GRANT_REQUIRED';
  taskId?: AdminProviderReviewTaskId;
  field?: string;
}

/** Admin facts are independently named. A VERIFIED case is not a work-access answer. */
export interface AdminProviderReview {
  provider: {
    id: string;
    userId: string | null;
    displayName: string;
    email: string | null;
    accountStatus: string | null;
    providerStatus: string;
    onboardingState: string | null;
    verificationState: string | null;
    standingState: string | null;
  };
  /** Opaque content revision. Echo it exactly; clients never derive one. */
  revision: string;
  submission: {
    id: string;
    submittedAt: string;
    policyVersion: string;
    decision: string | null;
    decidedAt: string | null;
    snapshot: ProviderReviewSnapshot | null;
    feedback: ProviderOnboardingFeedback | null;
  } | null;
  current: ProviderReviewSnapshot;
  /** Restricted evidence METADATA only. Opening bytes uses the existing audited route. */
  verification: AdminVerificationCase | null;
  categoryApplications: Array<
    PendingCategorySummary & {
      availableActions: Array<'APPROVE' | 'REJECT'>;
      supersededAt: string | null;
    }
  >;
  capabilities: ProviderCapabilitiesResponse;
  canWork: boolean;
  availableActions: AdminProviderReviewAction[];
  blockers: AdminProviderReviewBlocker[];
  permissions: {
    canViewEvidence: boolean;
    canDecide: boolean;
    canModeratePortfolio: boolean;
  };
}

export interface AdminProviderReviewCommand {
  submissionId: string;
  expectedRevision: string;
  /** Unique to this user's explicit decision. Reusing with different content is a conflict. */
  idempotencyKey: string;
  /** Admin-only note. Never copied into provider feedback or notifications. */
  note?: string;
}

export interface ApproveAdminProviderReviewRequest extends AdminProviderReviewCommand {
  reasonCode: 'DOCUMENTS_COMPLETE_AND_LEGIBLE' | 'OTHER';
}

export interface AdminProviderReviewFeedbackInput {
  taskId: AdminProviderReviewTaskId;
  field?: string;
  itemId?: string;
  reasonCode: string;
  providerMessage: string;
}

export interface RequestAdminProviderReviewChangesRequest extends AdminProviderReviewCommand {
  feedback: AdminProviderReviewFeedbackInput[];
}

export interface AdminProviderReviewMutationResponse {
  changed: boolean;
  review: AdminProviderReview;
}
