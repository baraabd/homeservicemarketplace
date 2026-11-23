import type { AdminProviderReview } from '@homeservicemarketplace/contracts';
import { REVIEW_COPY, type ReviewLanguage } from './copy';

// Display the independently recorded application axis, not the legacy profile
// status that also represents account restrictions and returned applications.
// Both submitted states await an application decision; received identity
// evidence must not make the old DOCUMENTS_REQUIRED name sound like a new task.
const APPLICATION_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  DRAFT: 'DRAFT',
  SUBMITTED: 'PENDING_REVIEW',
  DOCUMENTS_REQUIRED: 'PENDING_REVIEW',
  ACCEPTED: 'ACCEPTED',
  RETURNED: 'RETURNED',
} as const;

export function applicationStatusValue(
  onboardingState: string | null | undefined,
  providerStatus: string,
): string | null {
  if (onboardingState != null) {
    return Object.prototype.hasOwnProperty.call(APPLICATION_STATUS, onboardingState)
      ? APPLICATION_STATUS[onboardingState as keyof typeof APPLICATION_STATUS]
      : null;
  }
  if (providerStatus === 'ACTIVE') return 'ACCEPTED';
  return ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'SUSPENDED'].includes(providerStatus)
    ? providerStatus
    : null;
}

/** Explain the server's absent actions; this never authorizes a transition. */
export function noReviewActionMessage(review: AdminProviderReview, lang: ReviewLanguage): string {
  const t = REVIEW_COPY[lang];
  const blockers = new Set(review.blockers.map((blocker) => blocker.code));
  if (blockers.has('SELF_REVIEW')) return t.nextOtherReviewer;
  if (!review.permissions.canDecide) return t.noDecisionPermission;
  if (blockers.has('PERMISSION_REQUIRED')) {
    return review.permissions.canViewEvidence ? t.noReviewPermission : t.noEvidencePermission;
  }
  if (blockers.has('ACCOUNT_INELIGIBLE')) return t.nextAccountRestriction;
  if (blockers.has('PROVIDER_RESTRICTED')) return t.nextProviderRestriction;
  if (!review.submission || blockers.has('NOT_SUBMITTED')) return t.nextFirstSubmission;
  if (review.provider.onboardingState === 'RETURNED') return t.nextResubmission;
  if (review.provider.onboardingState === 'ACCEPTED' || review.submission.decision === 'ACCEPTED')
    return t.applicationAlreadyApproved;
  if (review.provider.onboardingState === 'DRAFT' || blockers.has('REVIEW_NOT_PENDING'))
    return t.nextDraftSubmission;
  if (review.submission.decision === 'RETURNED') return t.nextResubmission;
  if (blockers.has('SUBMITTED_CONTENT_CHANGED') || blockers.has('SNAPSHOT_UNAVAILABLE'))
    return t.nextUpdatedSubmission;
  if (blockers.has('SUBMISSION_ALREADY_DECIDED')) return t.applicationAlreadyDecided;
  return t.noActions;
}
