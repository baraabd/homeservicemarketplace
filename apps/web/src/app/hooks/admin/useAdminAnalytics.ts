import { useQuery } from '@tanstack/react-query';
import type { AnalyticsDateRangeQuery } from '@homeservicemarketplace/contracts';

import {
  getAdminAnalyticsOverview,
  getAdminAnalyticsRevenue,
  getAdminAnalyticsSummary,
} from '../../../lib/admin/admin-analytics-api';

const REFETCH_MS = 60_000;

export const adminAnalyticsQueryKeys = {
  root: ['admin', 'analytics'] as const,
  summary: () => ['admin', 'analytics', 'summary'] as const,
  overview: (range: AnalyticsDateRangeQuery) => ['admin', 'analytics', 'overview', range] as const,
  revenue: (range: AnalyticsDateRangeQuery) => ['admin', 'analytics', 'revenue', range] as const,
};

export function useAdminAnalyticsSummary() {
  return useQuery({
    queryKey: adminAnalyticsQueryKeys.summary(),
    queryFn: getAdminAnalyticsSummary,
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useAdminAnalyticsOverview(range: AnalyticsDateRangeQuery = {}) {
  return useQuery({
    queryKey: adminAnalyticsQueryKeys.overview(range),
    queryFn: () => getAdminAnalyticsOverview(range),
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useAdminAnalyticsRevenue(range: AnalyticsDateRangeQuery = {}) {
  return useQuery({
    queryKey: adminAnalyticsQueryKeys.revenue(range),
    queryFn: () => getAdminAnalyticsRevenue(range),
    refetchInterval: REFETCH_MS,
    staleTime: 15_000,
  });
}
