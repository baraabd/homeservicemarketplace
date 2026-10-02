import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type {
  BookingReview,
  BookingReviewState,
  BookingStatus,
  PrismaTx,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

// R11 — booking reviews and the reputation derived from them.
//
// docs/production-readiness/r11/REVIEW_POLICY.md
//
// LOCK ORDER, everywhere reputation changes: the booking row first, then the
// provider profile row. A review submission, a booking completion and a
// moderation action all take the provider row before they recompute, so two of
// them for the same provider run one after the other and neither can write a
// total computed before the other's row existed.

/** What a review submission needs to know about the booking, locked. */
export interface ReviewableBooking {
  id: string;
  seekerUserId: string;
  providerId: string;
  status: BookingStatus;
  providerUserId: string | null;
}

export interface BookingReviewWithProvider extends BookingReview {
  booking: { provider: { displayName: string } };
}

@Injectable()
export class BookingReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  /**
   * The seeker's own booking, with its row LOCKED for the rest of the
   * transaction.
   *
   * Ownership is part of the WHERE: another seeker's booking is not found, in
   * exactly the way a missing one is not found. The lock is what makes the
   * status read below the status at commit: a completion in flight either
   * finished before this statement returned or waits until this transaction
   * ends.
   */
  async lockOwnedBooking(
    bookingId: string,
    seekerUserId: string,
    tx: PrismaTx,
  ): Promise<ReviewableBooking | null> {
    const rows = await tx.$queryRaw<ReviewableBooking[]>`
      SELECT b."id", b."seekerUserId", b."providerId", b."status",
             p."userId" AS "providerUserId"
        FROM "Booking" b
        JOIN "ProviderProfile" p ON p."id" = b."providerId"
       WHERE b."id" = ${bookingId}
         AND b."seekerUserId" = ${seekerUserId}
         AND b."deletedAt" IS NULL
         FOR UPDATE OF b
    `;
    return rows[0] ?? null;
  }

  /** The seeker's own booking, unlocked, for a read. */
  findOwnedBooking(
    bookingId: string,
    seekerUserId: string,
  ): Promise<{ id: string; status: BookingStatus } | null> {
    return this.db().booking.findFirst({
      where: { id: bookingId, seekerUserId, deletedAt: null },
      select: { id: true, status: true },
    });
  }

  findByBookingId(bookingId: string, tx?: PrismaTx): Promise<BookingReview | null> {
    return this.db(tx).bookingReview.findUnique({ where: { bookingId } });
  }

  create(
    input: {
      bookingId: string;
      seekerUserId: string;
      providerId: string;
      rating: number;
      comment: string | null;
    },
    tx: PrismaTx,
  ): Promise<BookingReview> {
    return tx.bookingReview.create({ data: input });
  }

  /** Lock one provider profile row. See the lock order at the top of the file. */
  async lockProvider(providerId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "ProviderProfile" WHERE "id" = ${providerId} FOR UPDATE
    `;
  }

  /**
   * Recompute the provider's rating and review count from the source rows.
   *
   * Not an increment. The stored numbers are whatever the PUBLISHED reviews
   * say at this moment, so they cannot drift: a retry, a hidden review or a
   * restored one each produce the right total by construction. The caller
   * holds the provider row lock, and this is a statement of its own, so it
   * sees every review committed before the lock was granted.
   *
   * The average is the exact mean of whole-star ratings, never an average of
   * rounded averages. Rounding is for display.
   */
  async recomputeRating(providerId: string, tx: PrismaTx): Promise<void> {
    await tx.$executeRaw`
      UPDATE "ProviderProfile" p
         SET "reviewCount" = s.n,
             "ratingAvg"   = s.mean
        FROM (
          SELECT count(*)::int AS n,
                 COALESCE(avg("rating")::float8, 0) AS mean
            FROM "BookingReview"
           WHERE "providerId" = ${providerId}
             AND "state" = 'PUBLISHED'
        ) s
       WHERE p."id" = ${providerId}
    `;
  }

  // ── moderation ──────────────────────────────────────────────────────────

  findById(reviewId: string, tx?: PrismaTx): Promise<BookingReview | null> {
    return this.db(tx).bookingReview.findUnique({ where: { id: reviewId } });
  }

  listForAdmin(args: {
    providerId?: string;
    state?: BookingReviewState;
    take: number;
    cursor?: string;
  }): Promise<BookingReviewWithProvider[]> {
    const where: Prisma.BookingReviewWhereInput = {
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.state ? { state: args.state } : {}),
    };
    return this.db().bookingReview.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { booking: { select: { provider: { select: { displayName: true } } } } },
    }) as Promise<BookingReviewWithProvider[]>;
  }

  listForAdminById(reviewId: string): Promise<BookingReviewWithProvider[]> {
    return this.db().bookingReview.findMany({
      where: { id: reviewId },
      include: { booking: { select: { provider: { select: { displayName: true } } } } },
    }) as Promise<BookingReviewWithProvider[]>;
  }

  /**
   * Flip a review between PUBLISHED and HIDDEN, conditionally.
   *
   * The `from` state is part of the WHERE, so of two administrators acting at
   * once exactly one changes the row; the other sees a count of zero.
   */
  async setState(
    reviewId: string,
    from: BookingReviewState,
    to: BookingReviewState,
    moderation: { actorUserId: string; reason: string },
    tx: PrismaTx,
  ): Promise<number> {
    const result = await tx.bookingReview.updateMany({
      where: { id: reviewId, state: from },
      data:
        to === 'HIDDEN'
          ? {
              state: 'HIDDEN',
              hiddenAt: new Date(),
              hiddenByUserId: moderation.actorUserId,
              moderationReason: moderation.reason,
            }
          : {
              state: 'PUBLISHED',
              hiddenAt: null,
              hiddenByUserId: null,
              moderationReason: null,
            },
    });
    return result.count;
  }
}

/** True for the one database error a duplicate review produces: a unique
 *  violation on `bookingId`. Nothing else is treated as "already reviewed". */
export function isDuplicateBookingReview(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = (error.meta as { target?: string | string[] } | undefined)?.target;
  const columns = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return columns.includes('bookingId');
}
