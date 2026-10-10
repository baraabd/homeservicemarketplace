import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListProviderBookingsQuery,
  ListProviderBookingsResponse,
  ProviderBookingMutationResponse,
  ProviderBookingSummary,
} from '@homeservicemarketplace/contracts';

import { providerQueryKeys } from '../../../lib/provider/query-keys';
import {
  cancelProviderBooking,
  completeProviderBooking,
  getProviderBookingDetail,
  getProviderBookingTimeline,
  listProviderBookings,
  startProviderBooking,
} from '../../../lib/provider/provider-bookings-api';

// Sprint 5 slice 5.4 — provider booking lifecycle hooks.
//
// Polling cadence: 30 s for the list (slower than the available-jobs
// feed because new bookings only land on bid acceptance), 0 for the
// detail (refetched explicitly after a transition mutation).
//
// Each transition mutation invalidates BOTH provider/bookings AND
// provider/bids — the My Bids 'Start Job' button on ACCEPTED bids
// reflects the booking state, so the bid cache must refresh too.

const LIST_REFETCH_INTERVAL_MS = 30_000;

export function useProviderBookings(filters: ListProviderBookingsQuery = {}) {
  return useQuery({
    queryKey: providerQueryKeys.bookings.list({ status: filters.status }),
    queryFn: () => listProviderBookings(filters),
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    staleTime: 5_000,
  });
}

/** R17-E closure — the whole list, one server page at a time.
 *
 *  The API pages by cursor (50 a page, `nextCursor` = the last id served, null
 *  on the last page). The first request carries no cursor; each later one
 *  carries the previous page's `nextCursor`, so the server's order and owner
 *  scope hold on every page. A refetch (poll, focus, a transition's
 *  invalidation) re-walks the loaded pages from the first, deriving each
 *  cursor from the fresh page before it, so a booking that moved cannot be
 *  skipped or shown twice.
 *
 *  The key carries the filters, so another filter is another list. The
 *  `signal` lets a sign-out cancel a page in flight (clearAuthSession); a
 *  cancelled page is never written to the cache. */
export function useProviderBookingPages(filters: Pick<ListProviderBookingsQuery, 'status'> = {}) {
  return useInfiniteQuery({
    queryKey: providerQueryKeys.bookings.pages({ status: filters.status }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      listProviderBookings({ status: filters.status, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: LIST_REFETCH_INTERVAL_MS,
    staleTime: 5_000,
  });
}

/** Pages flattened in server order. A booking id the server returns on two
 *  pages is shown once and reported: the cursor contract (owner-scoped,
 *  id-keyed, stable order — r17-e-closure.integration.spec.ts C01) says it
 *  cannot happen, so it is a defect to surface, not a case to absorb. */
export function flattenBookingPages(
  pages: readonly ListProviderBookingsResponse[] | undefined,
): ProviderBookingSummary[] {
  const seen = new Set<string>();
  const items: ProviderBookingSummary[] = [];
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
    console.error('provider bookings: the server returned overlapping pages', { duplicates });
  }
  return items;
}

export function useProviderBookingDetail(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: providerQueryKeys.bookings.detail(bookingId ?? ''),
    queryFn: () => getProviderBookingDetail(bookingId!),
    enabled: Boolean(bookingId),
  });
}

export function useProviderBookingTimeline(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: providerQueryKeys.bookings.timeline(bookingId ?? ''),
    queryFn: () => getProviderBookingTimeline(bookingId!),
    enabled: Boolean(bookingId),
  });
}

// R17-E — every transition re-reads the server's answer when it SETTLES, not
// only when it succeeds. A 409 means the booking moved underneath the screen
// and a lost response may have landed anyway; in both cases the screen must
// show what the server now holds rather than what the button assumed.
// Mutations are never retried (the query client sets `retry: false`): a
// start or cancel is not idempotent, and a repeat is answered with an honest
// 409 the UI explains.
function useBookingTransition(
  run: (bookingId: string) => Promise<ProviderBookingMutationResponse>,
  extra: readonly (readonly unknown[])[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      void qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
      for (const queryKey of extra) void qc.invalidateQueries({ queryKey });
    },
  });
}

export function useStartProviderBooking() {
  return useBookingTransition(startProviderBooking);
}

export function useCompleteProviderBooking() {
  // Completed bookings feed the booking-derived earnings read model.
  return useBookingTransition(completeProviderBooking, [providerQueryKeys.wallet.root]);
}

export function useCancelProviderBooking() {
  return useBookingTransition(cancelProviderBooking);
}
