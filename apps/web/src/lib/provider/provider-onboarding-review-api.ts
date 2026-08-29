import type { ProviderOnboardingReview } from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 9B.23 — V2 Task 6: the review read-model.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md
//
// One GET, one shape, and the client decides nothing. The server returns the
// groups, the verdict (`canSubmit`), the single next action when it refuses,
// the active terms version, and the draft version a submit must echo.
//
// The client never re-derives readiness. Completeness rules live in
// `evaluateOnboarding()` on the server; a second copy in React would be a
// second policy, and the two would disagree the first time either moved.
//
// No call names a provider: ownership comes from the session.

/**
 * Fetch the review.
 *
 * `locale` selects which language's terms wording the provider is shown. It is
 * a query parameter rather than a header because it names a legal document and
 * the server whitelists it.
 */
export async function getOnboardingReview(locale: 'en' | 'ar'): Promise<ProviderOnboardingReview> {
  const { data } = await api.get<ProviderOnboardingReview>('/v1/me/provider/onboarding/review', {
    params: { locale },
  });
  return data;
}
