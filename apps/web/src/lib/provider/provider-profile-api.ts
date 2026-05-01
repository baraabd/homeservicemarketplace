import type {
  GetProviderProfileResponse,
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
