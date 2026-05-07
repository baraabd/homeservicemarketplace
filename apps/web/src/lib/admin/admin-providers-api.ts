import type {
  AdminProviderMutationResponse,
  AdminProviderSummary,
  ListAdminProvidersQuery,
  ListAdminProvidersResponse,
  ListProviderAuditEventsQuery,
  ListProviderAuditEventsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin provider verification API client (Sprint 6.2 refined).
// Targets the canonical /v1/admin/providers/* surface.

export async function listAdminProviders(
  query: ListAdminProvidersQuery = {},
): Promise<ListAdminProvidersResponse> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminProvidersResponse>('/v1/admin/providers', { params });
  return data;
}

export async function getAdminProvider(providerProfileId: string): Promise<AdminProviderSummary> {
  const { data } = await api.get<AdminProviderSummary>(`/v1/admin/providers/${providerProfileId}`);
  return data;
}

export async function getAdminProviderAudit(
  providerProfileId: string,
  query: ListProviderAuditEventsQuery = {},
): Promise<ListProviderAuditEventsResponse> {
  const params: Record<string, string | number> = {};
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListProviderAuditEventsResponse>(
    `/v1/admin/providers/${providerProfileId}/audit`,
    { params },
  );
  return data;
}

export async function updateAdminProviderReviewNotes(
  providerProfileId: string,
  notes: string,
): Promise<AdminProviderMutationResponse> {
  const { data } = await api.patch<AdminProviderMutationResponse>(
    `/v1/admin/providers/${providerProfileId}/review-notes`,
    { notes },
  );
  return data;
}

export async function approveAdminProvider(
  providerProfileId: string,
  note?: string | null,
): Promise<AdminProviderMutationResponse> {
  const { data } = await api.post<AdminProviderMutationResponse>(
    `/v1/admin/providers/${providerProfileId}/approve`,
    note ? { note } : {},
  );
  return data;
}

export async function rejectAdminProvider(
  providerProfileId: string,
  reason?: string | null,
): Promise<AdminProviderMutationResponse> {
  const { data } = await api.post<AdminProviderMutationResponse>(
    `/v1/admin/providers/${providerProfileId}/reject`,
    reason ? { reason } : {},
  );
  return data;
}

export async function suspendAdminProvider(
  providerProfileId: string,
  reason?: string | null,
): Promise<AdminProviderMutationResponse> {
  const { data } = await api.post<AdminProviderMutationResponse>(
    `/v1/admin/providers/${providerProfileId}/suspend`,
    reason ? { reason } : {},
  );
  return data;
}

export async function reactivateAdminProvider(
  providerProfileId: string,
): Promise<AdminProviderMutationResponse> {
  const { data } = await api.post<AdminProviderMutationResponse>(
    `/v1/admin/providers/${providerProfileId}/reactivate`,
    {},
  );
  return data;
}
