import { Injectable } from '@nestjs/common';
import type {
  Bid,
  Booking,
  BookingStatus,
  Prisma,
  PrismaTx,
  ProviderProfile,
  ServiceCategory,
  ServiceRequest,
  User,
} from '@homeservicemarketplace/database';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateBookingInput {
  requestId: string;
  bidId: string;
  seekerUserId: string;
  providerId: string;
  priceAmount: number;
  currency: string;
  scheduledAt?: Date | null;
  status?: BookingStatus;
}

// Eager-loaded shape returned by the list / detail finders. The Bookings
// tab card needs the service category label, the address snapshot, the
// provider summary, and the bid (for pricing type + note). Loading them
// all in one query avoids the N+1 fetch the alternative would require.
export type BookingWithRelations = Booking & {
  request: ServiceRequest & { category: ServiceCategory | null };
  bid: Bid;
  provider: ProviderProfile;
};

export interface ListBookingsArgs {
  seekerUserId: string;
  status?: BookingStatus;
  take: number;
  cursor?: string;
}

// Booking persistence. Slice 2.2 added `create` + `findByBidId`. Slice
// 2.3 adds the read surface (listForSeeker / findOwned, eager-loading
// the relations the Bookings tab needs) and the status-flip helper
// used by cancel-booking.
@Injectable()
export class BookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  create(input: CreateBookingInput, tx?: PrismaTx): Promise<Booking> {
    return this.db(tx).booking.create({
      data: {
        request: { connect: { id: input.requestId } },
        bid: { connect: { id: input.bidId } },
        seeker: { connect: { id: input.seekerUserId } },
        provider: { connect: { id: input.providerId } },
        priceAmount: input.priceAmount,
        currency: input.currency,
        scheduledAt: input.scheduledAt ?? null,
        ...(input.status ? { status: input.status } : {}),
      },
    });
  }

  // Findone-by-bid is exposed because the accept-bid invariant
  // (one-booking-per-bid) is enforced both at the DB unique index and
  // through this find — the service uses it as a defensive pre-check
  // in the rare case the unique index throws and we want to convert
  // the violation into a stable CONFLICT response.
  findByBidId(bidId: string, tx?: PrismaTx): Promise<Booking | null> {
    return this.db(tx).booking.findUnique({ where: { bidId } });
  }

  // Cursor-paginated list for the Bookings tab. Always filters
  // soft-deleted rows. Order: scheduledAt DESC (nulls last so ASAP
  // bookings without a planned time fall after dated ones), then
  // createdAt DESC, then id DESC for a deterministic tiebreak so
  // cursor pagination cannot skip or duplicate rows.
  listForSeeker(args: ListBookingsArgs, tx?: PrismaTx): Promise<BookingWithRelations[]> {
    const where: Prisma.BookingWhereInput = {
      seekerUserId: args.seekerUserId,
      deletedAt: null,
      ...(args.status ? { status: args.status } : {}),
    };
    return this.db(tx).booking.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [
        { scheduledAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: true,
      },
    });
  }

  // Returns the row only when it belongs to the given seeker AND is
  // not soft-deleted. Used at every ownership-checked call site.
  findOwned(
    bookingId: string,
    seekerUserId: string,
    tx?: PrismaTx,
  ): Promise<BookingWithRelations | null> {
    return this.db(tx).booking.findFirst({
      where: { id: bookingId, seekerUserId, deletedAt: null },
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: true,
      },
    });
  }

  // Status transition helper used by cancel-booking. Conditional on
  // the current status being one of `from` AND the row being owned —
  // an unexpected status returns count: 0, which the service maps to
  // a CONFLICT response. The composite where also blocks cross-user
  // mutation if the caller passes a foreign id.
  setStatusOwned(
    bookingId: string,
    seekerUserId: string,
    from: BookingStatus[],
    to: BookingStatus,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).booking.updateMany({
      where: {
        id: bookingId,
        seekerUserId,
        deletedAt: null,
        status: { in: from },
      },
      data: { status: to },
    });
  }

  // ─── Provider-side surfaces (Sprint 5 slice 5.4) ──────────────────────────

  // Cursor-paginated list scoped to a single provider. Eager-loads the
  // request (with category) + bid + provider + seeker (for first name);
  // the seeker is only included on the provider-side surface where the
  // booking is already accepted, so first-name exposure is acceptable.
  listForProvider(
    args: { providerId: string; status?: BookingStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<BookingWithProviderRelations[]> {
    const where: Prisma.BookingWhereInput = {
      providerId: args.providerId,
      deletedAt: null,
      ...(args.status ? { status: args.status } : {}),
    };
    return this.db(tx).booking.findMany({
      where,
      take: args.take,
      ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
      orderBy: [
        { scheduledAt: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: true,
        seeker: { select: { id: true, firstName: true } },
      },
    }) as Promise<BookingWithProviderRelations[]>;
  }

  // Provider-scoped detail finder. Returns null when the booking
  // doesn't exist OR doesn't belong to the calling provider — same
  // 404-or-existence pattern the seeker side uses.
  findOwnedByProvider(
    bookingId: string,
    providerId: string,
    tx?: PrismaTx,
  ): Promise<BookingWithProviderRelations | null> {
    return this.db(tx).booking.findFirst({
      where: { id: bookingId, providerId, deletedAt: null },
      include: {
        request: { include: { category: true } },
        bid: true,
        provider: true,
        seeker: { select: { id: true, firstName: true } },
      },
    }) as Promise<BookingWithProviderRelations | null>;
  }

  // Provider-scoped status-flip used by start / complete / cancel.
  // Conditional on current status being in `from` AND ownership; an
  // unexpected status returns count: 0 → CONFLICT.
  setStatusOwnedByProvider(
    bookingId: string,
    providerId: string,
    from: BookingStatus[],
    to: BookingStatus,
    tx?: PrismaTx,
  ): Promise<Prisma.BatchPayload> {
    return this.db(tx).booking.updateMany({
      where: {
        id: bookingId,
        providerId,
        deletedAt: null,
        status: { in: from },
      },
      data: { status: to },
    });
  }

  // Aggregate earnings query used by the wallet read model
  // (Sprint 5 slice 5.6). Single round-trip — three groupBys
  // executed in parallel inside the same Prisma client. All amounts
  // come back as the SUM of `priceAmount`; null SUMs (no rows)
  // collapse to 0 in the application layer.
  async aggregateEarningsForProvider(
    providerId: string,
    monthStart: Date,
    tx?: PrismaTx,
  ): Promise<{
    totalGross: number;
    currentMonthGross: number;
    pendingAmount: number;
    completedJobsCount: number;
    dominantCurrency: string | null;
  }> {
    const db = this.db(tx);
    const [completedAgg, monthAgg, pendingAgg, currencyByCount] = await Promise.all([
      db.booking.aggregate({
        where: { providerId, deletedAt: null, status: 'COMPLETED' },
        _sum: { priceAmount: true },
        _count: { _all: true },
      }),
      db.booking.aggregate({
        where: {
          providerId,
          deletedAt: null,
          status: 'COMPLETED',
          updatedAt: { gte: monthStart },
        },
        _sum: { priceAmount: true },
      }),
      db.booking.aggregate({
        where: {
          providerId,
          deletedAt: null,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        _sum: { priceAmount: true },
      }),
      db.booking.groupBy({
        by: ['currency'],
        where: { providerId, deletedAt: null, status: 'COMPLETED' },
        _count: { currency: true },
        orderBy: { _count: { currency: 'desc' } },
        take: 1,
      }),
    ]);
    return {
      totalGross: completedAgg._sum.priceAmount ?? 0,
      currentMonthGross: monthAgg._sum.priceAmount ?? 0,
      pendingAmount: pendingAgg._sum.priceAmount ?? 0,
      completedJobsCount: completedAgg._count._all,
      dominantCurrency: currencyByCount[0]?.currency ?? null,
    };
  }
}

// Eager-loaded shape used by the provider-side finders. Differs from
// `BookingWithRelations` in that the seeker is included (first name
// only) instead of the provider being the focal-point.
export type BookingWithProviderRelations = Booking & {
  request: ServiceRequest & { category: ServiceCategory | null };
  bid: Bid;
  provider: ProviderProfile;
  seeker: Pick<User, 'id' | 'firstName'>;
};

// Aggregate result for the earnings-summary endpoint. All amounts are
// integers in the marketplace's currency unit (cents-equivalent).
export interface ProviderEarningsAggregate {
  totalGross: number;
  currentMonthGross: number;
  pendingAmount: number;
  completedJobsCount: number;
  // Most-common currency code across the provider's COMPLETED
  // bookings, or null when no bookings exist. The application layer
  // falls back to the marketplace default ('USD') when null.
  dominantCurrency: string | null;
}

declare module './booking.repository' {
  // Marker so the repository class can extend itself in this file
  // without a separate type declaration. Empty by design.
}
