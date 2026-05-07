import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListProviderBookingsQuery } from '@homeservicemarketplace/contracts';

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

export function useStartProviderBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => startProviderBooking(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
    },
  });
}

export function useCompleteProviderBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => completeProviderBooking(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
    },
  });
}

export function useCancelProviderBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) => cancelProviderBooking(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: providerQueryKeys.bookings.root });
      qc.invalidateQueries({ queryKey: providerQueryKeys.bids.root });
    },
  });
}
