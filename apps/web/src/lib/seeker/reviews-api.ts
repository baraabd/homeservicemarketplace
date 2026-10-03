import type {
  BookingReviewStatusResponse,
  SubmitBookingReviewRequest,
  SubmitBookingReviewResponse,
} from '@homeservicemarketplace/contracts';

import { api } from '../api';

// R11 — the seeker's review of one of their completed bookings.
//
// The client sends a rating and an optional comment and nothing else. Who is
// reviewing, and whom, is the server's to decide from the booking.

/**
 * Mirrors of the contracts' rules, for the form only.
 *
 * The web imports TYPES from the contracts package, never runtime values (a
 * value import from that CJS-emitting package breaks the production build).
 * The server enforces the real limits; `reviews-api.test.ts` pins these to the
 * contracts' values so the two cannot drift silently.
 */
export const REVIEW_MIN_RATING = 1;
export const REVIEW_MAX_RATING = 5;
export const REVIEW_COMMENT_MAX_LENGTH = 1000;

export async function getBookingReview(bookingId: string): Promise<BookingReviewStatusResponse> {
  const { data } = await api.get<BookingReviewStatusResponse>(
    `/v1/me/bookings/${bookingId}/review`,
  );
  return data;
}

export async function submitBookingReview(
  bookingId: string,
  body: SubmitBookingReviewRequest,
): Promise<SubmitBookingReviewResponse> {
  const { data } = await api.post<SubmitBookingReviewResponse>(
    `/v1/me/bookings/${bookingId}/review`,
    body,
  );
  return data;
}
