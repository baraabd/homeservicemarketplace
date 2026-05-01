import type {
  BookingDetail,
  BookingListResponse,
  BookingTimelineResponse,
  ListBookingsQuery,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around the /v1/me/bookings endpoints. All
// requests carry credentials (api.ts sets `withCredentials: true`);
// mutations pick up the X-CSRF-Token header from the request
// interceptor; the 401-refresh interceptor handles transparent
// access-token refresh.

export async function listBookings(query: ListBookingsQuery = {}): Promise<BookingListResponse> {
  const { data } = await api.get<BookingListResponse>('/v1/me/bookings', {
    params: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    },
  });
  return data;
}

export async function getBookingDetail(bookingId: string): Promise<BookingDetail> {
  const { data } = await api.get<BookingDetail>(`/v1/me/bookings/${bookingId}`);
  return data;
}

export async function getBookingTimeline(bookingId: string): Promise<BookingTimelineResponse> {
  const { data } = await api.get<BookingTimelineResponse>(`/v1/me/bookings/${bookingId}/timeline`);
  return data;
}

export async function cancelBooking(bookingId: string): Promise<BookingDetail> {
  const { data } = await api.post<BookingDetail>(`/v1/me/bookings/${bookingId}/cancel`);
  return data;
}
