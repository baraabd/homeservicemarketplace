import type { ProviderBookingSummary } from './provider-booking-summary';

// GET /v1/me/provider/bookings/:bookingId — same shape as the list
// item; reserved as a separate type so future slices can add
// detail-only fields (long description, photos) without breaking
// list consumers.
export type ProviderBookingDetail = ProviderBookingSummary & {
  description: string | null;
};
