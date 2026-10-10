import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ListMyBidsQuery,
  ListMyBidsResponse,
  MyBidSummary,
  SubmitBidRequest,
} from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import { listMyBids, submitBid, withdrawBid } from '../../../lib/provider/provider-bids-api';

// Sprint 5 slice 5.3 — provider's own bids surface.
//
// `useMyBidPages` is a polling-friendly query (default 30 s) so the My Bids
// screen reflects acceptance / rejection without realtime; the
// available-jobs hook polls faster (15 s) because that's where the
// provider expects new rows to arrive.
//
// The mutations invalidate both `provider/bids` (so the list refetches)
// AND `provider/jobs` (so the hasOwnBid flag in the feed flips
// correctly without a stale render).

const REFETCH_INTERVAL_MS = 30_000;

/** E-18 — every bid, one server page at a time (20 a page by default).
 *
 *  The first request carries no cursor; each later one carries the previous
 *  page's `nextCursor`, so the server's order (newest first) and owner scope
 *  hold on every page. A refetch re-walks the loaded pages from the first.
 *  Each accepted bid carries its own booking (`MyBidSummary.booking`), so a
 *  card on any page links to its booking without paging the bookings list.
 *  The `signal` lets a sign-out cancel a page in flight. */
export function useMyBidPages(filters: Pick<ListMyBidsQuery, 'status'> = {}) {
  return useInfiniteQuery({
    queryKey: providerQueryKeys.bids.pages({ status: filters.status }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listMyBids({ status: filters.status, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: REFETCH_INTERVAL_MS,
    staleTime: 5_000,
  });
}

/** Pages flattened in server order. A bid id served on two pages is shown
 *  once and reported: the cursor contract (owner-scoped, id-keyed, stable
 *  order — provider-my-bids.integration.spec.ts) says it cannot happen. */
export function flattenBidPages(pages: readonly ListMyBidsResponse[] | undefined): MyBidSummary[] {
  const seen = new Set<string>();
  const items: MyBidSummary[] = [];
  let duplicates = 0;
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) {
        duplicates += 1;
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }
  }
  if (duplicates > 0) {
    console.error('provider bids: the server returned overlapping pages', { duplicates });
  }
  return items;
}

export function useSubmitBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitBidRequest) => submitBid(input),
    // R17-E — settle, not success: a 409 means the bid or request moved, and
    // the canonical feed (availableRequests) must drop or regain the request.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      void qc.invalidateQueries({ queryKey: providerQueryKeys.jobs.root });
      void qc.invalidateQueries({ queryKey: providerQueryKeys.availableRequests.root });
    },
  });
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bidId: string) => withdrawBid(bidId),
    // R17-E — settle, not success: a 409 means the bid or request moved, and
    // the canonical feed (availableRequests) must drop or regain the request.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      void qc.invalidateQueries({ queryKey: providerQueryKeys.jobs.root });
      void qc.invalidateQueries({ queryKey: providerQueryKeys.availableRequests.root });
    },
  });
}
