// R11 — administrator moderation of customer reviews.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// An administrator may HIDE a review, which stops it counting toward the
// provider's rating, and RESTORE it. Nothing is edited and nothing is deleted.
// Both actions need a recorded reason and are audited.

import type { BookingReviewState } from '../../seeker/reviews';

export interface AdminBookingReviewItem {
  id: string;
  bookingId: string;
  providerProfileId: string;
  providerDisplayName: string;
  authorUserId: string;
  rating: number;
  comment: string | null;
  state: BookingReviewState;
  hiddenAt: string | null;
  moderationReason: string | null;
  createdAt: string;
}

export interface ListAdminBookingReviewsQuery {
  providerProfileId?: string;
  state?: BookingReviewState;
  cursor?: string;
  limit?: number;
}

export interface AdminBookingReviewListResponse {
  items: AdminBookingReviewItem[];
  nextCursor: string | null;
}

export const ADMIN_REVIEW_REASON_MIN_LENGTH = 10;
export const ADMIN_REVIEW_REASON_MAX_LENGTH = 500;

/** POST /v1/admin/reviews/:reviewId/hide and /restore */
export interface ModerateBookingReviewRequest {
  reason: string;
}
