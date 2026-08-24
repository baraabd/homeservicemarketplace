import type {
  PatchOnboardingStepRequest,
  ProviderOnboardingDraftView,
  ProviderOnboardingStep,
  SubmitOnboardingRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 8 — the provider onboarding wizard.
// docs/adr/0008-category-hierarchy-and-onboarding-draft.md
//
// Every call returns the SAME complete view, so the caller never merges a
// mutation result into a stale read or decides which of two half-answers is
// current. That is a server design choice, and the client depends on it: the
// hooks below seed the cache from the response rather than refetching.
//
// No call names a provider. The server takes ownership from the session, so
// there is no id for the client to get wrong or for anyone to tamper with.

export async function getOnboardingDraft(): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.get<ProviderOnboardingDraftView>('/v1/me/provider/onboarding/draft');
  return data;
}

/**
 * Autosave one step.
 *
 * The step is in the PATH, not the body — a request cannot claim to be editing
 * one step while writing another, and the server rejects any field that does
 * not belong to the named step.
 *
 * `version` is required. A mismatch comes back 409 with the server's current
 * state attached, which is what lets the UI show the conflict rather than
 * clobbering another tab.
 */
export async function patchOnboardingStep(
  step: ProviderOnboardingStep,
  input: PatchOnboardingStepRequest,
): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.patch<ProviderOnboardingDraftView>(
    `/v1/me/provider/onboarding/steps/${step}`,
    input,
  );
  return data;
}

/** Hand the application in. Idempotent server-side: a retry after a dropped
 *  response returns the existing outcome rather than filing a second
 *  application. */
export async function submitOnboarding(
  input: SubmitOnboardingRequest,
): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.post<ProviderOnboardingDraftView>(
    '/v1/me/provider/onboarding/submit',
    input,
  );
  return data;
}

/** Take it back out of the queue so it can be edited again. */
export async function withdrawOnboarding(): Promise<ProviderOnboardingDraftView> {
  const { data } = await api.post<ProviderOnboardingDraftView>(
    '/v1/me/provider/onboarding/withdraw',
  );
  return data;
}
