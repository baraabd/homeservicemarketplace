import { useQuery } from '@tanstack/react-query';
import type {
  AvailableJobSummary,
  ListAvailableJobsQuery,
} from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { listAvailableJobs } from '../../../lib/provider/provider-jobs-api';

// Polling cadence for the Live Jobs feed. 15s feels live without
// hammering the API; the user can also pull-to-refresh by
// re-triggering the route. Aligned with the Sprint 5.5.5 realtime
// spike's "polling stays as fallback at 10–30s" recommendation.
const REFETCH_INTERVAL_MS = 15_000;

// Sprint 5 slice 5.2 — provider available-jobs feed.
//
// Returns the raw contract DTOs; UI components apply their own mapping
// (the legacy ProviderApp shape uses different fields). Polls every
// REFETCH_INTERVAL_MS while the screen is mounted; React Query pauses
// the interval when the tab is backgrounded.
export function useAvailableJobs(filters: ListAvailableJobsQuery = {}) {
  return useQuery({
    queryKey: providerQueryKeys.jobs.available({
      categoryId: filters.categoryId,
      city: filters.city,
    }),
    queryFn: () => listAvailableJobs(filters),
    refetchInterval: REFETCH_INTERVAL_MS,
    // Stale-while-revalidate semantics: we always show the cached
    // page if we have one, then refresh in the background.
    staleTime: 5_000,
  });
}

export type AvailableJob = AvailableJobSummary;
