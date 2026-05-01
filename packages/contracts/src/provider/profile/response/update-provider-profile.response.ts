import type { ProviderProfileSummary } from './provider-profile-summary';

// PATCH /v1/me/provider/profile
export interface UpdateProviderProfileResponse {
  profile: ProviderProfileSummary;
}
