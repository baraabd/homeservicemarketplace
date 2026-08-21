import type { ProviderOnboardingIssue } from '../enums/provider-onboarding-field';

// Read-model for the Provider app's onboarding surface.
//
// `complete` answers "could I submit right now?" without the app duplicating
// the server's completeness policy — which is what lets the two drift and
// produces a Submit button that always 422s.
export interface ProviderOnboardingStatus {
  complete: boolean;
  /** Empty when `complete` is true. */
  missing: ProviderOnboardingIssue[];
  /** ISO timestamp of the current application's submission, or null. */
  submittedForReviewAt: string | null;
  /** ISO timestamp of the last admin decision, or null. */
  reviewedAt: string | null;
  /**
   * Why the last review rejected the application. Surfaced to the provider so
   * a REJECTED applicant is told what to fix, rather than being shown a
   * generic "there is a problem with your account" message that conflates
   * provider standing with account standing.
   */
  rejectionReason: string | null;
  /** Whether the profile may be edited right now (false while PENDING_REVIEW). */
  editable: boolean;
}
