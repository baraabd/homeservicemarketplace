import type {
  ApplyForCategoryRequest,
  ApplyForCategoryResponse,
  GetProviderProfileResponse,
  ListMyCategoryApplicationsQuery,
  ListMyCategoryApplicationsResponse,
  UpdateProviderAvailabilityRequest,
  UpdateProviderAvailabilityResponse,
  UpdateProviderProfileRequest,
  UpdateProviderProfileResponse,
  UpgradeToProviderResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/provider endpoints (Sprint 5
// slice 5.1). All requests carry credentials (api.ts sets
// `withCredentials: true`); mutations pick up the X-CSRF-Token header
// from the request interceptor; the 401-refresh interceptor handles
// transparent access-token refresh.

export async function getProviderProfile(): Promise<GetProviderProfileResponse> {
  const { data } = await api.get<GetProviderProfileResponse>('/v1/me/provider/profile');
  return data;
}

export async function upgradeToProvider(): Promise<UpgradeToProviderResponse> {
  // POST with an empty body — the deliberate-upgrade path takes its
  // userId from the session only.
  const { data } = await api.post<UpgradeToProviderResponse>('/v1/me/provider/upgrade');
  return data;
}

export async function updateProviderProfile(
  input: UpdateProviderProfileRequest,
): Promise<UpdateProviderProfileResponse> {
  const { data } = await api.patch<UpdateProviderProfileResponse>('/v1/me/provider/profile', input);
  return data;
}

export async function updateProviderAvailability(
  input: UpdateProviderAvailabilityRequest,
): Promise<UpdateProviderAvailabilityResponse> {
  const { data } = await api.patch<UpdateProviderAvailabilityResponse>(
    '/v1/me/provider/availability',
    input,
  );
  return data;
}

// ── Sprint 2: service-category applications ────────────────────────────────
//
// Adding a skill is no longer something the profile PATCH can do. A provider
// applies here and an admin decides; until then the category shows up under
// `pendingCategories` on the profile, never under `serviceCategories`.
//
// Neither call names a provider: the server takes ownership from the session,
// so there is no id for the client to get wrong or for anyone to tamper with.

export async function applyForCategory(
  input: ApplyForCategoryRequest,
): Promise<ApplyForCategoryResponse> {
  const { data } = await api.post<ApplyForCategoryResponse>(
    '/v1/me/provider/categories/applications',
    input,
  );
  return data;
}

export async function listMyCategoryApplications(
  query: ListMyCategoryApplicationsQuery = {},
): Promise<ListMyCategoryApplicationsResponse> {
  const { data } = await api.get<ListMyCategoryApplicationsResponse>(
    '/v1/me/provider/categories/applications',
    { params: query },
  );
  return data;
}
