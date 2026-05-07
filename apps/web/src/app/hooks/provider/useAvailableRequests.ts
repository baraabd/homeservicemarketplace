import { useQuery } from '@tanstack/react-query';
import type { ProviderAvailableRequestsQuery } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  getAvailableRequestDetail,
  listAvailableRequests,
} from '../../../lib/provider/available-requests-api';

// Sprint 5.2 (canonical) — provider available-requests feed hook.
//
// Polling cadence is 20 s — between the legacy useAvailableJobs hook
// (15 s for a more "live" feed feel) and the slower bids / bookings
// feeds (30 s). React Query pauses the interval when the tab is
// backgrounded; refetchOnWindowFocus = true ensures the screen
// catches up the moment the operator comes back.

const REFETCH_INTERVAL_MS = 20_000;

export function useAvailableRequests(filters: ProviderAvailableRequestsQuery = {}) {
  return useQuery({
    queryKey: providerQueryKeys.availableRequests.list({
      category: filters.category,
      near: filters.near,
    }),
    queryFn: () => listAvailableRequests(filters),
    refetchInterval: REFETCH_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

export function useAvailableRequestDetail(requestId: string | null | undefined) {
  return useQuery({
    queryKey: providerQueryKeys.availableRequests.detail(requestId ?? ''),
    queryFn: () => getAvailableRequestDetail(requestId!),
    enabled: Boolean(requestId),
  });
}
