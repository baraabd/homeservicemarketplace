import type { BookingStatus } from '../../../seeker/bookings/enums/booking-status';

// GET /v1/me/provider/bookings
//
// Provider-side, authenticated. Lists the calling provider's own
// bookings. The server scopes results to the provider; there is no
// providerId on the wire because the only legal value is the caller's
// own.
export interface ListProviderBookingsQuery {
  status?: BookingStatus;
  limit?: number;
  cursor?: string;
}
