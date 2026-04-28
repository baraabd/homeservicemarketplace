import { useQuery } from '@tanstack/react-query';
import type { BidListResponse, BidSortKey, BidSummary } from '@homeservicemarketplace/contracts';

import { getBidDetail, listBidsForRequest } from '../../../lib/seeker/bids-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the bids feed of a Seeker-owned request.
// `enabled` short-circuits the call when the consumer hasn't picked a
// request yet (the BidsScreen overlay is mounted with a null id when
// closed). `staleTime` is brief so re-opening the screen picks up
// any bids submitted since last view.
export function useBids(requestId: string | null | undefined, sort?: BidSortKey) {
  return useQuery<BidListResponse>({
    queryKey: requestId
      ? seekerQueryKeys.bids.list(requestId, sort)
      : ['seeker', 'requests', '__noop__', 'bids', 'list', sort ?? 'recommended'],
    queryFn: () => listBidsForRequest(requestId as string, sort ? { sort } : {}),
    enabled: typeof requestId === 'string' && requestId.length > 0,
    staleTime: 15 * 1000,
  });
}

export function useBidDetail(
  requestId: string | null | undefined,
  bidId: string | null | undefined,
) {
  return useQuery<BidSummary>({
    queryKey:
      requestId && bidId
        ? seekerQueryKeys.bids.detail(requestId, bidId)
        : ['seeker', 'requests', '__noop__', 'bids', 'detail', '__noop__'],
    queryFn: () => getBidDetail(requestId as string, bidId as string),
    enabled:
      typeof requestId === 'string' &&
      requestId.length > 0 &&
      typeof bidId === 'string' &&
      bidId.length > 0,
    staleTime: 15 * 1000,
  });
}
