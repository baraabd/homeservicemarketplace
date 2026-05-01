import type { BookingListItem } from './booking-list-item';

// Booking detail. Same render-data as the list item plus a few extras
// the detail view may want (description, bid note, updatedAt). Kept as
// an extension of BookingListItem rather than a separate shape so the
// frontend detail screen can reuse the same render code as a card.
export interface BookingDetail extends BookingListItem {
  updatedAt: string;
  // Free-form description the seeker added when creating the request.
  description: string | null;
  // Optional note the provider attached to their bid (snapshotted via
  // the related Bid row at read-time — not denormalized into the
  // booking row, so a future Bid edit while still PENDING is reflected
  // until the bid is accepted).
  bidNote: string | null;
}
