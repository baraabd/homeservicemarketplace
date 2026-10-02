import { Injectable, Logger } from '@nestjs/common';
import {
  BOOKING_REVIEW_COMMENT_MAX_LENGTH,
  BOOKING_REVIEW_MAX_RATING,
  BOOKING_REVIEW_MIN_RATING,
} from '@homeservicemarketplace/contracts';
import type {
  BookingReviewEligibility,
  BookingReviewStatusResponse,
  BookingReviewView,
  SubmitBookingReviewRequest,
  SubmitBookingReviewResponse,
} from '@homeservicemarketplace/contracts';
import { AuditEventType, BookingStatus } from '@homeservicemarketplace/database';
import type { BookingReview } from '@homeservicemarketplace/database';

import {
  BookingReviewRepository,
  isDuplicateBookingReview,
} from '../../infrastructure/persistence/reviews/booking-review.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { AuditService } from '../iam/audit/audit.service';

// R11 — a seeker reviews the provider of one of their completed bookings.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// WHO AND WHAT ARE NEVER TAKEN FROM THE REQUEST
//
// The reviewer is the signed-in user. The reviewed provider is the booking's
// provider. The request carries a rating and an optional comment and nothing
// else; a body that names a reviewer, a provider or a state is refused by the
// DTO before it reaches this class.
//
// ONE REVIEW, HOWEVER MANY TIMES IT IS SENT
//
// The booking is the identity of a submission. Sending the same rating and
// comment again answers with the saved review and writes nothing. Sending
// different content is refused: a review is final, and a "retry" that carries
// something else is an edit by another name.
//
// The booking row is locked for the length of the transaction, so two
// submissions for one booking run one after the other and the second sees the
// first. The unique index on `bookingId` is the guarantee underneath that: if
// anything ever reaches the insert twice, PostgreSQL refuses the second, and
// that one error — and no other — is answered by reading the winner.

@Injectable()
export class BookingReviewsService {
  private readonly logger = new Logger(BookingReviewsService.name);

  constructor(
    private readonly reviews: BookingReviewRepository,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
  ) {}

  /** What the seeker may do with this booking's review, and the review if one
   *  exists. Another seeker's booking is not found, like a missing one. */
  async status(seekerUserId: string, bookingId: string): Promise<BookingReviewStatusResponse> {
    const booking = await this.reviews.findOwnedBooking(bookingId, seekerUserId);
    if (!booking) throw notFound();
    const review = await this.reviews.findByBookingId(bookingId);
    return {
      bookingId,
      eligibility: eligibilityOf(booking.status, review !== null),
      review: review ? toView(review) : null,
    };
  }

  async submit(
    seekerUserId: string,
    bookingId: string,
    input: SubmitBookingReviewRequest,
  ): Promise<SubmitBookingReviewResponse> {
    const rating = normaliseRating(input.rating);
    const comment = normaliseComment(input.comment);

    try {
      return await this.tx.run(async (tx) => {
        // Lock first, read second: the status below is the status at commit.
        const booking = await this.reviews.lockOwnedBooking(bookingId, seekerUserId, tx);
        if (!booking) throw notFound();

        const existing = await this.reviews.findByBookingId(bookingId, tx);
        if (existing) return replayOrConflict(existing, rating, comment);

        if (booking.status !== BookingStatus.COMPLETED) {
          throw new AppError(
            'CONFLICT',
            'A booking can be reviewed once it has been completed.',
            409,
            { reason: 'BOOKING_NOT_COMPLETED' },
          );
        }
        // Bidding on one's own request is refused upstream, so this booking
        // should not exist. It is refused here as well: a rating a person gave
        // themselves is not a review, however the booking came about.
        if (booking.providerUserId !== null && booking.providerUserId === seekerUserId) {
          throw new AppError('FORBIDDEN', 'You cannot review your own work.', 403, {
            reason: 'SELF_REVIEW',
          });
        }

        const created = await this.reviews.create(
          { bookingId, seekerUserId, providerId: booking.providerId, rating, comment },
          tx,
        );

        // Booking row, then provider row: the order every reputation change
        // takes. The recompute is a statement of its own after the lock, so it
        // counts every review committed before this one was allowed to proceed.
        await this.reviews.lockProvider(booking.providerId, tx);
        await this.reviews.recomputeRating(booking.providerId, tx);

        await this.audit.record(
          {
            type: AuditEventType.BOOKING_REVIEW_SUBMITTED,
            userId: seekerUserId,
            // Identifiers only. Not the rating and not the comment: an audit
            // row is not a second copy of the review.
            metadata: {
              reviewId: created.id,
              bookingId,
              providerProfileId: booking.providerId,
            },
          },
          tx,
        );

        return { review: toView(created), replayed: false };
      });
    } catch (error) {
      // ONLY the duplicate-review violation. The failed insert aborted its
      // transaction, so the winner is read outside it, in a fresh statement.
      if (!isDuplicateBookingReview(error)) throw error;
      this.logger.warn({ msg: 'booking_review.duplicate_insert_resolved', bookingId });
      const winner = await this.reviews.findByBookingId(bookingId);
      // The winner belongs to this booking, and ownership of the booking was
      // established above before the insert was attempted.
      if (!winner || winner.seekerUserId !== seekerUserId) throw error;
      return replayOrConflict(winner, rating, comment);
    }
  }
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 'Booking not found.', 404);
}

function eligibilityOf(status: BookingStatus, reviewed: boolean): BookingReviewEligibility {
  if (reviewed) return 'ALREADY_REVIEWED';
  return status === BookingStatus.COMPLETED ? 'ELIGIBLE' : 'BOOKING_NOT_COMPLETED';
}

/** The same content is a repeat of the saved review. Anything else is an
 *  attempt to change a final review, and is refused. */
function replayOrConflict(
  existing: BookingReview,
  rating: number,
  comment: string | null,
): SubmitBookingReviewResponse {
  if (existing.rating === rating && (existing.comment ?? null) === comment) {
    return { review: toView(existing), replayed: true };
  }
  throw new AppError(
    'CONFLICT',
    'This booking has already been reviewed. A review cannot be changed.',
    409,
    { reason: 'REVIEW_ALREADY_SUBMITTED' },
  );
}

function normaliseRating(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < BOOKING_REVIEW_MIN_RATING ||
    value > BOOKING_REVIEW_MAX_RATING
  ) {
    throw new AppError(
      'VALIDATION_ERROR',
      `A rating is a whole number from ${BOOKING_REVIEW_MIN_RATING} to ${BOOKING_REVIEW_MAX_RATING}.`,
      400,
      { reason: 'RATING_OUT_OF_RANGE' },
    );
  }
  return value;
}

/**
 * Trimmed, in NFC, and null when empty.
 *
 * NFC so that the same visible text typed on two keyboards is the same stored
 * text, which is what makes "the same comment again" a repeat rather than a
 * conflict. Nothing else is rewritten: a comment is stored as written and is
 * always rendered as text.
 */
function normaliseComment(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', 'A comment must be text.', 400);
  }
  const comment = value.normalize('NFC').trim();
  if (comment.length === 0) return null;
  if ([...comment].length > BOOKING_REVIEW_COMMENT_MAX_LENGTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `A comment can be up to ${BOOKING_REVIEW_COMMENT_MAX_LENGTH} characters.`,
      400,
      { reason: 'COMMENT_TOO_LONG' },
    );
  }
  return comment;
}

export function toView(review: BookingReview): BookingReviewView {
  return {
    id: review.id,
    bookingId: review.bookingId,
    rating: review.rating,
    comment: review.comment,
    state: review.state,
    createdAt: review.createdAt.toISOString(),
  };
}
