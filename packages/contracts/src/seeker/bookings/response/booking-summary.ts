import type { BookingStatus } from '../enums/booking-status';

// Minimal booking shape returned by the accept-bid endpoint. Slice 2.2
// is the only writer; future slices (bookings tab, booking detail,
// reschedule, cancel) will extend BookingDetail with the additional
// fields they need without breaking this read shape.
//
// `bidId` is exposed so the frontend can correlate the booking back to
// the accepted bid (e.g. to highlight the right card). `seekerUserId`
// and `providerId` are NOT exposed — the wire shape stays minimal and
// PII-free.
export interface BookingSummary {
  id: string;
  requestId: string;
  bidId: string;
  status: BookingStatus;
  scheduledAt: string | null;
  priceAmount: number;
  currency: string;
  createdAt: string;
}
