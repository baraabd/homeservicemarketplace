import type {
  DisputeMutationResponse,
  DisputeSummary,
  ListAdminDisputesQuery,
  ListAdminDisputesResponse,
  ResolveDisputeRequest,
  UpdateDisputeRequest,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin disputes API client (Sprint 6.3 refined). Targets the
// canonical /v1/admin/disputes/* surface with the new PATCH route
// and the priority filter.

export async function listAdminDisputes(
  query: ListAdminDisputesQuery = {},
): Promise<ListAdminDisputesResponse> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.priority) params.priority = query.priority;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAdminDisputesResponse>('/v1/admin/disputes', { params });
  return data;
}

export async function getAdminDispute(disputeId: string): Promise<DisputeSummary> {
  const { data } = await api.get<DisputeSummary>(`/v1/admin/disputes/${disputeId}`);
  return data;
}

export async function updateAdminDispute(
  disputeId: string,
  body: UpdateDisputeRequest,
): Promise<DisputeMutationResponse> {
  const { data } = await api.patch<DisputeMutationResponse>(
    `/v1/admin/disputes/${disputeId}`,
    body,
  );
  return data;
}

export async function resolveAdminDispute(
  disputeId: string,
  body: ResolveDisputeRequest,
): Promise<DisputeMutationResponse> {
  const { data } = await api.post<DisputeMutationResponse>(
    `/v1/admin/disputes/${disputeId}/resolve`,
    body,
  );
  return data;
}
