import { useQuery } from '@tanstack/react-query';
import type {
  EarningsChartRange,
  ListProviderEarningsTransactionsQuery,
} from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  getProviderEarningsChart,
  getProviderEarningsSummary,
  listProviderEarningsTransactions,
} from '../../../lib/provider/provider-earnings-api';

// Sprint 5.6 (refined) — canonical provider earnings hooks.
//
// Targets /v1/provider/earnings/{summary,transactions,chart}. The
// summary, transactions, and chart endpoints all reconcile by
// construction (same repository aggregate; same fee math), so the
// three hooks share a single 60 s polling cadence — there is no
// realtime-y "active screen" element to special-case. Booking
// lifecycle mutations (start / complete / cancel from the bookings
// flow) invalidate the wallet root so the wallet refreshes the moment
// a job flips to COMPLETED.
const REFETCH_MS = 60_000;
const STALE_MS = 15_000;

export function useProviderEarningsSummary() {
  return useQuery({
    queryKey: providerQueryKeys.wallet.summary(),
    queryFn: getProviderEarningsSummary,
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: STALE_MS,
  });
}

export function useProviderEarningsTransactions(
  filters: ListProviderEarningsTransactionsQuery = {},
) {
  return useQuery({
    queryKey: providerQueryKeys.wallet.transactions({
      cursor: filters.cursor ?? null,
      limit: filters.limit ?? null,
    }),
    queryFn: () => listProviderEarningsTransactions(filters),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: STALE_MS,
  });
}

export function useProviderEarningsChart(range: EarningsChartRange = '30d') {
  return useQuery({
    queryKey: providerQueryKeys.wallet.chart(range),
    queryFn: () => getProviderEarningsChart(range),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: STALE_MS,
  });
}
