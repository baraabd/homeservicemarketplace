import type { ProviderProfileSummary } from './provider-profile-summary';

// PATCH /v1/me/provider/availability — returns the full updated
// summary so the cache stays consistent with PATCH /profile.
export interface UpdateProviderAvailabilityResponse {
  profile: ProviderProfileSummary;
}
