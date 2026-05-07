import type { BookingTimelineResponse } from '../../../seeker/bookings/response/booking-timeline.response';

// GET /v1/me/provider/bookings/:bookingId/timeline — same wire shape
// as the seeker timeline. Re-exported so the provider-side hook
// imports from the provider barrel without reaching into seeker.
export type ProviderBookingTimelineResponse = BookingTimelineResponse;
