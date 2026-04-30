import type { ProviderProfileSummary } from './provider-profile-summary';

// POST /v1/me/provider/upgrade — same envelope as GET so the frontend
// can hydrate the cache from either response interchangeably.
export interface UpgradeToProviderResponse {
  profile: ProviderProfileSummary;
}
