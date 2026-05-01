import type { BookingListItem } from './booking-list-item';

// Standard envelope shape — `items` carries the page, `nextCursor`
// is non-null when more rows exist beyond the current page. Slice 2.3
// returns all bookings in one envelope (Seeker booking volume is
// expected to be small for the foreseeable future); pagination is
// already plumbed for when that changes.
export interface BookingListResponse {
  items: BookingListItem[];
  nextCursor: string | null;
}
