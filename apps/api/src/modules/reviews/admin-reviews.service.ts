import { Injectable } from '@nestjs/common';
import {
  ADMIN_REVIEW_REASON_MAX_LENGTH,
  ADMIN_REVIEW_REASON_MIN_LENGTH,
} from '@homeservicemarketplace/contracts';
import type {
  AdminBookingReviewItem,
  AdminBookingReviewListResponse,
  ListAdminBookingReviewsQuery,
} from '@homeservicemarketplace/contracts';
import { AuditEventType } from '@homeservicemarketplace/database';
import type { BookingReviewState } from '@homeservicemarketplace/database';

import {
  BookingReviewRepository,
  type BookingReviewWithProvider,
} from '../../infrastructure/persistence/reviews/booking-review.repository';
import { TransactionRunner } from '../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../shared/errors/app-error';
import { AuditService } from '../iam/audit/audit.service';
import { PermissionResolverService } from '../iam/authorization/services/permission-resolver.service';

// R11 — moderation of customer reviews.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// An administrator holding `reviews:moderate` may hide a review or restore
// it. Hiding stops it counting toward the provider's rating; restoring makes
// it count again. Nothing is edited and nothing is deleted. Each action needs
// a reason and writes an audit row in the transaction that changes the review
// and recomputes the rating, so the three commit together or not at all.
//
// A provider has no route here. The role and permission guards on the
// controller are re-checked inside the transaction, against the database.

export const REVIEWS_READ = 'reviews:read';
export const REVIEWS_MODERATE = 'reviews:moderate';

const DEFAULT_PAGE_SIZE = 25;

@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly reviews: BookingReviewRepository,
    private readonly tx: TransactionRunner,
    private readonly audit: AuditService,
    private readonly permissions: PermissionResolverService,
  ) {}

  async list(
    actorId: string,
    query: ListAdminBookingReviewsQuery,
  ): Promise<AdminBookingReviewListResponse> {
    this.require(await this.permissions.resolveFreshForUser(actorId), REVIEWS_READ);
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.reviews.listForAdmin({
      providerId: query.providerProfileId,
      state: query.state,
      take: take + 1,
      cursor: query.cursor,
    });
    const items = rows.slice(0, take).map(toAdminItem);
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }

  hide(actorId: string, reviewId: string, reason: string): Promise<AdminBookingReviewItem> {
    return this.moderate(actorId, reviewId, reason, 'PUBLISHED', 'HIDDEN');
  }

  restore(actorId: string, reviewId: string, reason: string): Promise<AdminBookingReviewItem> {
    return this.moderate(actorId, reviewId, reason, 'HIDDEN', 'PUBLISHED');
  }

  private async moderate(
    actorId: string,
    reviewId: string,
    rawReason: string,
    from: BookingReviewState,
    to: BookingReviewState,
  ): Promise<AdminBookingReviewItem> {
    const reason = typeof rawReason === 'string' ? rawReason.normalize('NFC').trim() : '';
    if (
      [...reason].length < ADMIN_REVIEW_REASON_MIN_LENGTH ||
      [...reason].length > ADMIN_REVIEW_REASON_MAX_LENGTH
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `Give a reason of ${ADMIN_REVIEW_REASON_MIN_LENGTH} to ${ADMIN_REVIEW_REASON_MAX_LENGTH} characters.`,
        400,
        { reason: 'MODERATION_REASON_REQUIRED' },
      );
    }

    await this.tx.run(async (tx) => {
      // Read at write time, inside the transaction: a permission withdrawn a
      // moment ago does not moderate anything.
      this.require(await this.permissions.resolveFreshForUser(actorId, tx), REVIEWS_MODERATE);

      const review = await this.reviews.findById(reviewId, tx);
      if (!review) throw new AppError('NOT_FOUND', 'Review not found.', 404);

      // Provider row first, then the conditional flip under it.
      await this.reviews.lockProvider(review.providerId, tx);
      const changed = await this.reviews.setState(
        reviewId,
        from,
        to,
        { actorUserId: actorId, reason },
        tx,
      );
      if (changed === 0) {
        throw new AppError(
          'CONFLICT',
          to === 'HIDDEN' ? 'This review is already hidden.' : 'This review is not hidden.',
          409,
          { reason: 'REVIEW_STATE_CHANGED' },
        );
      }
      await this.reviews.recomputeRating(review.providerId, tx);

      await this.audit.record(
        {
          type:
            to === 'HIDDEN'
              ? AuditEventType.ADMIN_REVIEW_HIDDEN
              : AuditEventType.ADMIN_REVIEW_RESTORED,
          userId: actorId,
          metadata: {
            reviewId,
            bookingId: review.bookingId,
            providerProfileId: review.providerId,
            previousState: from,
            newState: to,
            reason,
          },
        },
        tx,
      );
    });

    const [fresh] = await this.reviews.listForAdminById(reviewId);
    if (!fresh) throw new AppError('NOT_FOUND', 'Review not found.', 404);
    return toAdminItem(fresh);
  }

  private require(rights: Set<string>, permission: string): void {
    if (!rights.has(permission)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to moderate reviews.', 403);
    }
  }
}

function toAdminItem(row: BookingReviewWithProvider): AdminBookingReviewItem {
  return {
    id: row.id,
    bookingId: row.bookingId,
    providerProfileId: row.providerId,
    providerDisplayName: row.booking.provider.displayName,
    authorUserId: row.seekerUserId,
    rating: row.rating,
    comment: row.comment,
    state: row.state,
    hiddenAt: row.hiddenAt ? row.hiddenAt.toISOString() : null,
    moderationReason: row.moderationReason,
    createdAt: row.createdAt.toISOString(),
  };
}
