// R11 — a seeker's review of the provider of one completed booking.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// One review per booking. Final: it is never edited or deleted by its author.
// The reviewer and the reviewed provider are never sent by the client; the
// server takes both from the booking.

/** Whole stars. */
export const BOOKING_REVIEW_MIN_RATING = 1;
export const BOOKING_REVIEW_MAX_RATING = 5;
/** Characters, after trimming. An empty comment is no comment. */
export const BOOKING_REVIEW_COMMENT_MAX_LENGTH = 1000;

/**
 * `PUBLISHED` counts toward the provider's rating. `HIDDEN` was hidden by an
 * administrator: it is kept, it no longer counts, and its author is told.
 */
export type BookingReviewState = 'PUBLISHED' | 'HIDDEN';

/**
 * Whether the signed-in seeker may review this booking NOW.
 *
 * Decided by the server from the persisted booking, on every read and again on
 * every write. A screen label is not an authority.
 */
export type BookingReviewEligibility =
  /** The booking is COMPLETED and has no review. */
  | 'ELIGIBLE'
  /** A review exists. It cannot be replaced. */
  | 'ALREADY_REVIEWED'
  /** The booking is not COMPLETED (scheduled, in progress or cancelled). */
  | 'BOOKING_NOT_COMPLETED';

/** The author's own view of their review. Nothing here identifies anyone. */
export interface BookingReviewView {
  id: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  state: BookingReviewState;
  createdAt: string;
}

/** GET /v1/me/bookings/:bookingId/review */
export interface BookingReviewStatusResponse {
  bookingId: string;
  eligibility: BookingReviewEligibility;
  review: BookingReviewView | null;
}

/** POST /v1/me/bookings/:bookingId/review */
export interface SubmitBookingReviewRequest {
  rating: number;
  comment?: string | null;
}

export interface SubmitBookingReviewResponse {
  review: BookingReviewView;
  /**
   * True when this exact review had already been saved and the request was a
   * repeat of it. Nothing was written and nothing was counted again.
   */
  replayed: boolean;
}
