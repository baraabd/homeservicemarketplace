import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import type { ProviderOnboardingReview } from '@homeservicemarketplace/contracts';

import { getOnboardingReview } from '../../../lib/provider/provider-onboarding-review-api';
import {
  patchOnboardingStep,
  submitOnboarding,
} from '../../../lib/provider/provider-onboarding-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';

// Sprint 9B.23 — V2 Task 6.
//
// docs/sprint-09b23/REVIEW_AND_SUBMIT.md

/**
 * The canonical readiness read-model.
 *
 * Mirrors `useProviderOnboardingHub`'s retry rule: 401, 403 and 404 are
 * ANSWERS, not transient failures, and retrying them holds the screen on a
 * spinner through several seconds of backoff before showing the same thing.
 *
 * `staleTime: 0` on purpose. This is a verdict about a draft that other
 * screens are editing, so a cached one is a verdict about a document that may
 * no longer exist in that form.
 */
export function useOnboardingReview(locale: 'en' | 'ar') {
  return useQuery<ProviderOnboardingReview, AxiosError>({
    queryKey: providerQueryKeys.onboarding.review(locale),
    queryFn: () => getOnboardingReview(locale),
    staleTime: 0,
    retry: (failureCount, err) => {
      const status = err.response?.status;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Record acceptance of the CURRENT terms version.
 *
 * Goes through the ordinary versioned CONSENT step — the same write, the same
 * edit lock, the same 409 on a stale draft. There is deliberately no separate
 * "accept terms" endpoint: consent is a field of the application, and giving
 * it its own route would be a second way to write the same column.
 *
 * The version sent is the one the SERVER just served in the review. A client
 * that sent a version it chose could record agreement to wording it never
 * displayed.
 */
export function useAcceptTerms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { draftVersion: number; termsVersion: string }) =>
      patchOnboardingStep('CONSENT', {
        version: input.draftVersion,
        acceptedConsentVersion: input.termsVersion,
      }),
    onSuccess: async () => {
      // Both, and in this order: the draft moved (its version changed), and
      // the review is a verdict about the draft. Refetching the review with a
      // stale draft version would hand the submit a token the server rejects.
      await qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.root });
    },
  });
}

/**
 * Hand the application in.
 *
 * `version` is the draft version the review reported, so a draft edited in
 * another tab between viewing and submitting comes back 409 rather than
 * submitting something the provider did not read back.
 *
 * Idempotent server-side: a retry after a dropped response returns the
 * existing outcome instead of filing a second application.
 */
export function useSubmitApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { draftVersion: number }) =>
      submitOnboarding({ version: input.draftVersion }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: providerQueryKeys.onboarding.root });
    },
  });
}
