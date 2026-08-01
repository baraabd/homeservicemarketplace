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
  // Sprint 7.12 — the ORIGINAL request's createdAt timestamp. Needed so
  // the booking-side JobDetailView's "Posted" step can show when the
  // seeker first posted the job, not when the booking was created (the
  // booking is created at bid-accept time, which is much later). The
  // booking already eager-loads the parent ServiceRequest row in the
  // repository; this just surfaces the timestamp on the wire so the
  // frontend stays hard-refresh consistent without a second fetch.
  requestCreatedAt: string;
  // Sprint 7.13 — the parent request's seeker-uploaded media (fileUrls).
  // Always an array (empty when none). Sourced from the eager-loaded
  // request relation so the booking-side detail shows the same photos
  // the seeker attached, hard-refresh consistent without a second fetch.
  requestMediaUrls: string[];
}
