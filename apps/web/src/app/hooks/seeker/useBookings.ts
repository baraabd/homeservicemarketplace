import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingDetail,
  BookingListResponse,
  BookingStatus,
  BookingTimelineResponse,
} from '@homeservicemarketplace/contracts';

import {
  cancelBooking,
  getBookingDetail,
  getBookingTimeline,
  listBookings,
} from '../../../lib/seeker/bookings-api';
import { seekerQueryKeys } from '../../../lib/seeker/query-keys';

// React Query hook for the Bookings tab list. Optionally filtered by
// status; the empty-filter case returns every booking the seeker owns.
//
// 30s stale time matches the requests / bids feed — the bookings tab is
// inspected often enough that we want sub-minute freshness, but not so
// often that we need to refetch on every visit.
export function useBookings(filter?: { status?: BookingStatus }) {
  return useQuery<BookingListResponse>({
    queryKey: seekerQueryKeys.bookings.list(filter),
    queryFn: () => listBookings(filter ?? {}),
    staleTime: 30 * 1000,
  });
}

export function useBookingDetail(bookingId: string | null | undefined) {
  return useQuery<BookingDetail>({
    queryKey: bookingId
      ? seekerQueryKeys.bookings.detail(bookingId)
      : seekerQueryKeys.bookings.root,
    queryFn: () => getBookingDetail(bookingId as string),
    enabled: typeof bookingId === 'string' && bookingId.length > 0,
    staleTime: 30 * 1000,
  });
}

export function useBookingTimeline(bookingId: string | null | undefined) {
  return useQuery<BookingTimelineResponse>({
    queryKey: bookingId
      ? seekerQueryKeys.bookings.timeline(bookingId)
      : seekerQueryKeys.bookings.root,
    queryFn: () => getBookingTimeline(bookingId as string),
    enabled: typeof bookingId === 'string' && bookingId.length > 0,
    staleTime: 30 * 1000,
  });
}

// Cancel-booking mutation. On success, invalidates every cache the
// transition touches:
//   - bookings root → list / detail / timeline refetch shows
//     CANCELLED + the new BOOKING_CANCELLED timeline event
//   - requests root is intentionally NOT invalidated; the parent
//     ServiceRequest stays at BID_ACCEPTED (no auto-revert).
export function useCancelBooking() {
  const qc = useQueryClient();
  return useMutation<BookingDetail, Error, string>({
    mutationFn: (bookingId: string) => cancelBooking(bookingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: seekerQueryKeys.bookings.root });
    },
  });
}
