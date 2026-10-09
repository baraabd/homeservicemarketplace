import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ListProviderBookingsQuery,
  ProviderBookingMutationResponse,
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
