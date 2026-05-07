import type {
  ProviderAvailableRequestDetailResponse,
  ProviderAvailableRequestListResponse,
  ProviderAvailableRequestsQuery,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Sprint 5.2 (canonical) — typed wrappers around
// /v1/provider/available-requests. Read-only — credentials carried
// by the shared axios instance, no CSRF token needed.

export async function listAvailableRequests(
  query: ProviderAvailableRequestsQuery = {},
): Promise<ProviderAvailableRequestListResponse> {
  const params: Record<string, string | number> = {};
  if (query.category) params.category = query.category;
  if (query.near) params.near = query.near;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ProviderAvailableRequestListResponse>(
    '/v1/provider/available-requests',
    { params },
  );
  return data;
}

export async function getAvailableRequestDetail(
  requestId: string,
): Promise<ProviderAvailableRequestDetailResponse> {
  const { data } = await api.get<ProviderAvailableRequestDetailResponse>(
    `/v1/provider/available-requests/${encodeURIComponent(requestId)}`,
  );
  return data;
}
