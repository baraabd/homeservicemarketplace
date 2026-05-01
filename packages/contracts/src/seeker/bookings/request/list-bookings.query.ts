import type { BookingStatus } from '../enums/booking-status';

// Optional query parameters for GET /v1/me/bookings. All fields are
// optional; the server applies a stable default ordering (newest
// scheduledAt first, falling back to newest createdAt) when no
// arguments are supplied.
export interface ListBookingsQuery {
  status?: BookingStatus;
  limit?: number;
  cursor?: string;
}
