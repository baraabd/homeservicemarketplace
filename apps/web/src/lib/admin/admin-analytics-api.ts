import type {
  AdminAnalyticsOverview,
  AdminAnalyticsResponse,
  AdminAnalyticsRevenue,
  AnalyticsDateRangeQuery,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Admin analytics API client (Sprint 6.4 refined). Targets the
// canonical /v1/admin/analytics/* read-only surface. The legacy
// /summary endpoint is preserved for back-compat with the
// existing hsm-admin Postman folder.

export async function getAdminAnalyticsSummary(): Promise<AdminAnalyticsResponse> {
  const { data } = await api.get<AdminAnalyticsResponse>('/v1/admin/analytics/summary');
  return data;
}

export async function getAdminAnalyticsOverview(
  range: AnalyticsDateRangeQuery = {},
): Promise<AdminAnalyticsOverview> {
  const params: Record<string, string> = {};
  if (range.from) params.from = range.from;
  if (range.to) params.to = range.to;
  const { data } = await api.get<AdminAnalyticsOverview>('/v1/admin/analytics/overview', {
    params,
  });
  return data;
}

export async function getAdminAnalyticsRevenue(
  range: AnalyticsDateRangeQuery = {},
): Promise<AdminAnalyticsRevenue> {
  const params: Record<string, string> = {};
  if (range.from) params.from = range.from;
  if (range.to) params.to = range.to;
  const { data } = await api.get<AdminAnalyticsRevenue>('/v1/admin/analytics/revenue', {
    params,
  });
  return data;
}
