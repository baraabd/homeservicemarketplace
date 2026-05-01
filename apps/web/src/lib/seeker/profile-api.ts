import type {
  GetProfileResponse,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/profile endpoints. All
// requests carry credentials (api.ts sets `withCredentials: true`);
// PATCH picks up the X-CSRF-Token header from the request
// interceptor; the 401-refresh interceptor handles transparent
// access-token refresh.

export async function getProfile(): Promise<GetProfileResponse> {
  const { data } = await api.get<GetProfileResponse>('/v1/me/profile');
  return data;
}

export async function updateProfile(input: UpdateProfileRequest): Promise<UpdateProfileResponse> {
  const { data } = await api.patch<UpdateProfileResponse>('/v1/me/profile', input);
  return data;
}
