import { useQuery } from '@tanstack/react-query';
import type { ListEarningsTransactionsQuery } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  getProviderEarningsSummary,
  listProviderEarningsTransactions,
} from '../../../lib/provider/provider-wallet-api';

// Sprint 5 slice 5.6 — provider earnings read-only hooks.
//
// The summary is polled at a slower cadence (60 s) than the bookings
// list because a) the aggregates only change when a booking flips to
// COMPLETED, and b) the underlying SUM query is cheap but not free.
const SUMMARY_REFETCH_MS = 60_000;
const TRANSACTIONS_REFETCH_MS = 60_000;

export function useProviderEarningsSummary() {
  return useQuery({
    queryKey: providerQueryKeys.wallet.summary(),
    queryFn: getProviderEarningsSummary,
    refetchInterval: SUMMARY_REFETCH_MS,
    staleTime: 15_000,
  });
}

export function useProviderEarningsTransactions(filters: ListEarningsTransactionsQuery = {}) {
  return useQuery({
    queryKey: providerQueryKeys.wallet.transactions({ status: filters.status }),
    queryFn: () => listProviderEarningsTransactions(filters),
    refetchInterval: TRANSACTIONS_REFETCH_MS,
    staleTime: 15_000,
  });
}
