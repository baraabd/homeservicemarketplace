import type {
  ListProviderBookingsQuery,
  ListProviderBookingsResponse,
  ProviderBookingDetail,
  ProviderBookingMutationResponse,
  ProviderBookingTimelineResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// Thin typed wrappers around /v1/me/provider/bookings (Sprint 5
// slice 5.4). All requests carry credentials; mutations pick up the
// X-CSRF-Token header from the request interceptor.

export async function listProviderBookings(
  query: ListProviderBookingsQuery = {},
): Promise<ListProviderBookingsResponse> {
  const params: Record<string, string | number> = {};
  if (query.status) params.status = query.status;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.cursor) params.cursor = query.cursor;
  const { data } = await api.get<ListProviderBookingsResponse>('/v1/me/provider/bookings', {
    params,
  });
  return data;
}

export async function getProviderBookingDetail(bookingId: string): Promise<ProviderBookingDetail> {
  const { data } = await api.get<ProviderBookingDetail>(
    `/v1/me/provider/bookings/${encodeURIComponent(bookingId)}`,
  );
  return data;
}

export async function getProviderBookingTimeline(
  bookingId: string,
): Promise<ProviderBookingTimelineResponse> {
  const { data } = await api.get<ProviderBookingTimelineResponse>(
    `/v1/me/provider/bookings/${encodeURIComponent(bookingId)}/timeline`,
  );
  return data;
}

export async function startProviderBooking(
  bookingId: string,
): Promise<ProviderBookingMutationResponse> {
  const { data } = await api.post<ProviderBookingMutationResponse>(
    `/v1/me/provider/bookings/${encodeURIComponent(bookingId)}/start`,
  );
  return data;
}

export async function completeProviderBooking(
  bookingId: string,
): Promise<ProviderBookingMutationResponse> {
  const { data } = await api.post<ProviderBookingMutationResponse>(
    `/v1/me/provider/bookings/${encodeURIComponent(bookingId)}/complete`,
  );
  return data;
}

export async function cancelProviderBooking(
  bookingId: string,
): Promise<ProviderBookingMutationResponse> {
  const { data } = await api.post<ProviderBookingMutationResponse>(
    `/v1/me/provider/bookings/${encodeURIComponent(bookingId)}/cancel`,
  );
  return data;
}
