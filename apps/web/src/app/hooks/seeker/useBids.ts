import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AcceptBidResponse,
  BidListResponse,
  BidSortKey,
  BidSummary,
} from '@homeservicemarketplace/contracts';

import { acceptBid, getBidDetail, listBidsForRequest } from '../../../lib/seeker/bids-api';
import { providerQueryKeys } from '../../../lib/provider/query-keys';
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

// Accept-bid mutation (slice 2.2; Sprint 7.5 finished the integration).
//
// On success the acceptance ripples through the system: this bid flips
// to ACCEPTED, sibling bids on the same request flip to REJECTED, the
// request flips to BID_ACCEPTED, a Booking row is created, two
// notifications are written for the seeker (and two for the provider
// when their profile is linked), and `bid.accepted` + `booking.created`
// realtime events are fan-out on the bus.
//
// We invalidate every cache the acceptance touches in BOTH bounded
// contexts so the same-browser provider session (when a single user
// is both seeker and provider) also reflects the change without a
// manual refetch. The seeker-side roots:
//   - bids root for THIS request  → list refetch (ACCEPTED + siblings)
//   - requests root               → list/detail refetch (BID_ACCEPTED)
//   - bookings root               → new booking appears in Bookings tab
//   - notifications root          → seeker BID_ACCEPTED + BOOKING_CREATED rows
//   - conversations root          → /v1/me/conversations rows
//                                    (the booking has just become eligible
//                                    for an open-chat; the list ordering
//                                    is also bumped by realtime activity)
// Provider-side roots (no-op for a pure-seeker session — invalidating
// keys that aren't subscribed to is cheap and contains a corner-case
// where the same user wears both hats):
//   - available-requests root     → the just-booked request disappears
//                                    from the provider feed
//   - bids root (provider)        → ACCEPTED state of their own bid
//   - bookings root (provider)    → new booking appears in provider tab
//   - notifications root (provider) → provider BID_ACCEPTED rows
//
// We deliberately do NOT seed the new request status into the detail
// cache because the contract returns a partial summary; a clean
// invalidate keeps the contract-shape source of truth on the server.
export function useAcceptBid(requestId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<AcceptBidResponse, Error, string>({
    mutationFn: (bidId: string) => {
      if (!requestId) throw new Error('useAcceptBid: requestId is required to accept a bid.');
      return acceptBid(requestId, bidId);
    },
    onSuccess: () => {
      if (!requestId) return;
      // Seeker bounded context.
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bids.root(requestId) });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.requests.root });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.notifications.root });
      qc.invalidateQueries({ queryKey: seekerQueryKeys.conversations.root });
      // Provider bounded context — only meaningful when the same
      // browser session is also acting as a provider (e.g. a dev
      // device wearing both hats). Cheap when no provider cache
      // exists yet.
      qc.invalidateQueries({ queryKey: providerQueryKeys.availableRequests.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.notifications.root });
    },
  });
}
