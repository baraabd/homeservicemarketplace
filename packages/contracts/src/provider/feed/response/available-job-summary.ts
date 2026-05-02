import type { AddressSnapshot } from '../../../seeker/requests/response/address-snapshot';
import type { ScheduleType } from '../../../seeker/requests/enums/schedule-type';

// Lightweight category breakout used inside AvailableJobSummary. We
// reuse the same shape the seeker request views consume so a single
// frontend component can render both surfaces. `null` when the request
// was posted with `customServiceText` instead of a curated category.
export interface AvailableJobCategoryRef {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
}

// Wire shape for the Provider 'available jobs' feed (Sprint 5 slice 5.2).
//
// Fields deliberately omitted from this surface even though they exist
// on the backing ServiceRequest row:
//   - `seekerUserId`           — never leak the seeker's user id to a
//                                third party. Identity reaches the
//                                provider only through the booking
//                                conversation, after a bid is accepted.
//   - `seekerName` / contact — same reason. The Conversation contracts
//                              expose the seeker's first name only,
//                              after acceptance.
//   - `addressSnapshot.line1` — the precise street address is gated
//                               behind acceptance. The feed exposes
//                               only city + country + lat/lng for the
//                               map pin.
//
// `bidsCount` shows the competition level. `hasOwnBid` indicates
// whether the calling provider already has a non-withdrawn bid on this
// request — useful for hiding the 'Place bid' CTA in the UI without an
// extra round-trip.
export interface AvailableJobLocation {
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}

export interface AvailableJobSummary {
  id: string;
  category: AvailableJobCategoryRef | null;
  customServiceText: string | null;
  description: string | null;
  scheduleType: ScheduleType;
  scheduledAt: string | null;
  location: AvailableJobLocation;
  bidsCount: number;
  hasOwnBid: boolean;
  createdAt: string;
}

// The original AddressSnapshot type is re-exported so existing
// consumers that import it from the seeker contract barrel keep
// working — the available-job feed deliberately uses a narrower
// `AvailableJobLocation` shape instead.
export type { AddressSnapshot };
