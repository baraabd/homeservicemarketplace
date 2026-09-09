import type { ProviderOnboardingIssue } from '../enums/provider-onboarding-field';

// Read-model for the Provider app's onboarding surface.
//
// `complete` answers "could I submit right now?" without the app duplicating
// the server's completeness policy — which is what lets the two drift and
// produces a Submit button that always 422s.
export interface ProviderOnboardingStatus {
  /**
   * PROVIDER-INPUT completion: every provider-controlled required input is
   * present. Equivalent to `missing.length === 0`.
   *
   * Sprint 09B.29. An item sitting in an administrator's approval queue does
   * not make it false — the provider cannot clear it, and the decision it waits
   * on is prompted by the submission itself. Those items are reported in
   * `awaitingReview`.
   *
   * NOT the whole submission decision. `POST …/submit-for-review` additionally
   * enforces the lifecycle state (DRAFT only), authorization, and the atomic
   * DRAFT → PENDING_REVIEW claim that makes a concurrent retry a 409 rather
   * than a second application. It may refuse while this is true.
   *
   * Not an activation or work-access answer either; both are decided elsewhere.
   */
  complete: boolean;
  /**
   * What the PROVIDER still has to do. Empty when `complete` is true.
   *
   * Sprint 09B.29 narrowed this to provider-action issues so the invariant
   * above stays true. Platform-owned items moved to `awaitingReview` rather
   * than being dropped.
   */
  missing: ProviderOnboardingIssue[];
  /**
   * What WE still owe them a decision on — currently pending specialty
   * moderation.
   *
   * Additive in Sprint 09B.29. Present so the moderation axis stays visible on
   * the legacy surface: previously these items appeared in `missing`, which
   * told a provider who had chosen a specialty to go and choose one, and
   * blocked a submission they could do nothing to unblock.
   *
   * Non-empty here is never a reason the provider cannot proceed.
   */
  awaitingReview: ProviderOnboardingIssue[];
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
