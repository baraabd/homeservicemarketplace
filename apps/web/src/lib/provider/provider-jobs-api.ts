import type {
  ListAvailableJobsQuery,
  ListAvailableJobsResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrapper around GET /v1/me/provider/jobs/available
// (Sprint 5 slice 5.2). Carries credentials (api.ts sets
// `withCredentials: true`); the 401-refresh interceptor handles
// transparent access-token refresh. Read-only — no CSRF token needed.
export async function listAvailableJobs(
  query: ListAvailableJobsQuery = {},
): Promise<ListAvailableJobsResponse> {
  const params: Record<string, string | number> = {};
  if (query.categoryId) params.categoryId = query.categoryId;
  if (query.city) params.city = query.city;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListAvailableJobsResponse>('/v1/me/provider/jobs/available', {
    params,
  });
  return data;
}
