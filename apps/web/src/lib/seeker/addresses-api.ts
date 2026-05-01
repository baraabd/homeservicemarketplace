import type {
  AddressListResponse,
  AddressSummary,
  CreateAddressRequest,
  UpdateAddressRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/addresses endpoints. All
// requests carry credentials (api.ts sets `withCredentials: true`) and
// mutations pick up the X-CSRF-Token header from the request
// interceptor. The 401-refresh interceptor handles transparent
// access-token refresh; we never have to think about it here.

export async function listAddresses(): Promise<AddressSummary[]> {
  const { data } = await api.get<AddressListResponse>('/v1/me/addresses');
  return data.items;
}

export async function createAddress(input: CreateAddressRequest): Promise<AddressSummary> {
  const { data } = await api.post<AddressSummary>('/v1/me/addresses', input);
  return data;
}

export async function updateAddress(
  addressId: string,
  input: UpdateAddressRequest,
): Promise<AddressSummary> {
  const { data } = await api.patch<AddressSummary>(`/v1/me/addresses/${addressId}`, input);
  return data;
}

export async function deleteAddress(addressId: string): Promise<void> {
  await api.delete(`/v1/me/addresses/${addressId}`);
}

export async function setDefaultAddress(addressId: string): Promise<AddressSummary> {
  const { data } = await api.post<AddressSummary>(`/v1/me/addresses/${addressId}/default`);
  return data;
}
