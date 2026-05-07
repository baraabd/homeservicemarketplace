import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListMyBidsQuery, SubmitBidRequest } from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { listMyBids, submitBid, withdrawBid } from '../../../lib/provider/provider-bids-api';

// Sprint 5 slice 5.3 — provider's own bids surface.
//
// `useMyBids` is a polling-friendly query (default 30 s) so the My Bids
// screen reflects acceptance / rejection without realtime; the
// available-jobs hook polls faster (15 s) because that's where the
// provider expects new rows to arrive.
//
// The mutations invalidate both `provider/bids` (so the list refetches)
// AND `provider/jobs` (so the hasOwnBid flag in the feed flips
// correctly without a stale render).

const REFETCH_INTERVAL_MS = 30_000;

export function useMyBids(filters: ListMyBidsQuery = {}) {
  return useQuery({
    queryKey: providerQueryKeys.bids.list({ status: filters.status }),
    queryFn: () => listMyBids(filters),
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 5_000,
  });
}

export function useSubmitBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitBidRequest) => submitBid(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.jobs.root });
    },
  });
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bidId: string) => withdrawBid(bidId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.jobs.root });
    },
  });
}
