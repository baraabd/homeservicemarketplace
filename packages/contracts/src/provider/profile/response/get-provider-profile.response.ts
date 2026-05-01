import type { ProviderProfileSummary } from './provider-profile-summary';

// GET /v1/me/provider/profile
export interface GetProviderProfileResponse {
  profile: ProviderProfileSummary;
}
