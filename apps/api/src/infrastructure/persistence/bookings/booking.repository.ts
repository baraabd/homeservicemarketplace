import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';
import type {
  Bid,
  Booking,
  BookingStatus,
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

  // G2/R27: one bounded page + joins instead of six relation-hydration reads.
  // The provider summary does not consume the provider profile, the full bid
  // or private seeker fields. Dates remain scalar PostgreSQL values so Prisma
  // decodes them as Date rather than strings nested in a JSON document.
  listForProvider(
    args: { providerId: string; status?: BookingStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<ProviderBookingListRow[]> {
    const cursorJoin = args.cursor
      ? Prisma.sql`JOIN (
          SELECT id, "scheduledAt", "createdAt" FROM "Booking"
          WHERE id = ${args.cursor} AND "providerId" = ${args.providerId} AND "deletedAt" IS NULL
            ${args.status ? Prisma.sql`AND status = ${args.status}::"BookingStatus"` : Prisma.empty}
        ) cursor ON TRUE`
      : Prisma.empty;
    const cursorWhere = args.cursor
      ? Prisma.sql`AND (
          booking."scheduledAt" < cursor."scheduledAt"
          OR (booking."scheduledAt" IS NULL AND cursor."scheduledAt" IS NOT NULL)
          OR (booking."scheduledAt" IS NOT DISTINCT FROM cursor."scheduledAt" AND (
            booking."createdAt" < cursor."createdAt"
            OR (booking."createdAt" = cursor."createdAt" AND booking.id <= cursor.id)
          ))
        )`
      : Prisma.empty;
    // Keep Prisma's existing inclusive cursor + skip:1 contract. For this
    // nullable ordering its cursor must still belong to the filtered page:
    // a deleted or status-changed own cursor produces an empty page. The
    // service still rejects foreign/invented cursor IDs before this read.
    return this.db(tx)
      .$queryRaw<ProviderBookingListProjection[]>(
        Prisma.sql`
        SELECT page.*, request."addressSnapshot", request."customServiceText",
          category.slug AS "categorySlug", category."labelEn" AS "categoryLabelEn",
          category."labelAr" AS "categoryLabelAr", bid."pricingType", bid.note AS "bidNote",
          seeker.id AS "seekerId", seeker."firstName" AS "seekerFirstName"
        FROM (
          SELECT booking.* FROM "Booking" booking
          ${cursorJoin}
          WHERE booking."providerId" = ${args.providerId} AND booking."deletedAt" IS NULL
            ${args.status ? Prisma.sql`AND booking.status = ${args.status}::"BookingStatus"` : Prisma.empty}
            ${cursorWhere}
          ORDER BY booking."scheduledAt" DESC NULLS LAST, booking."createdAt" DESC, booking.id DESC
          LIMIT ${args.take} OFFSET ${args.cursor ? 1 : 0}
        ) page
        JOIN "ServiceRequest" request ON request.id = page."requestId"
        LEFT JOIN "ServiceCategory" category ON category.id = request."categoryId"
        JOIN "Bid" bid ON bid.id = page."bidId"
        JOIN "User" seeker ON seeker.id = page."seekerUserId"
        ORDER BY page."scheduledAt" DESC NULLS LAST, page."createdAt" DESC, page.id DESC
      `,
      )
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          requestId: row.requestId,
          bidId: row.bidId,
          status: row.status,
          scheduledAt: row.scheduledAt,
          priceAmount: row.priceAmount,
          currency: row.currency,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          request: listRequest(row),
          bid: { pricingType: row.pricingType, note: row.bidNote },
          seeker: { id: row.seekerId, firstName: row.seekerFirstName },
        })),
      );
  }

  // R17-E closure — is this id a booking of this provider (deleted or not)?
  // Guards listForProvider's cursor, which Prisma resolves by id alone.
  async isCursorOwnedByProvider(
    bookingId: string,
    providerId: string,
    tx?: PrismaTx,
  ): Promise<boolean> {
    const row = await this.db(tx).booking.findFirst({
      where: { id: bookingId, providerId },
      select: { id: true },
    });
    return row !== null;
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

  /**
   * R11 — recompute the provider's completed-jobs count from their bookings.
   *
   * `ProviderProfile.completedJobs` is shown to seekers and read by the earned
   * service-area tier, and until R11 nothing wrote it. It is now whatever the
   * provider's COMPLETED bookings say, recomputed in the transaction that
   * completes one.
   *
   * The provider row is locked first, in a statement of its own: two bookings
   * of one provider completing at the same moment then run one after the
   * other, and the second count includes the first booking. Without the lock
   * each would count only its own and the later write would lose one.
   */
  async recomputeCompletedJobsForProvider(providerId: string, tx: PrismaTx): Promise<void> {
    await tx.$queryRaw`
      SELECT "id" FROM "ProviderProfile" WHERE "id" = ${providerId} FOR UPDATE
    `;
    await tx.$executeRaw`
      UPDATE "ProviderProfile" p
         SET "completedJobs" = (
           SELECT count(*)::int
             FROM "Booking" b
            WHERE b."providerId" = ${providerId}
              AND b."status" = 'COMPLETED'
              AND b."deletedAt" IS NULL
         )
       WHERE p."id" = ${providerId}
    `;
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

  // Daily-bucketed earnings aggregation for the canonical chart endpoint
  // (Sprint 5.6 refined). Returns one row per UTC calendar day in the
  // [windowStart, windowEnd) range that has at least one COMPLETED
  // booking. The application layer zero-fills missing days so the
  // client never has to recompute the calendar.
  //
  // Window semantics:
  //   windowStart — inclusive, midnight UTC of the first day in range
  //   windowEnd   — exclusive, midnight UTC of the day AFTER the last day
  //
  // Bucketing uses booking.updatedAt (the moment the provider marked the
  // job COMPLETED — booking rows never update again afterwards). The
  // existing month aggregate uses the same field; the chart stays
  // consistent with the summary by reusing it.
  async aggregateEarningsByDayForProvider(
    providerId: string,
    windowStart: Date,
    windowEnd: Date,
    tx?: PrismaTx,
  ): Promise<Array<{ day: Date; gross: number; completedCount: number }>> {
    const db = this.db(tx);
    const rows = await db.$queryRaw<
      Array<{ day: Date; gross: bigint | number | null; completed_count: bigint | number }>
    >(Prisma.sql`
      SELECT
        DATE_TRUNC('day', "updatedAt" AT TIME ZONE 'UTC') AS day,
        COALESCE(SUM("priceAmount"), 0) AS gross,
        COUNT(*) AS completed_count
      FROM "Booking"
      WHERE "providerId" = ${providerId}
        AND "deletedAt" IS NULL
        AND status = 'COMPLETED'
        AND "updatedAt" >= ${windowStart}
        AND "updatedAt" < ${windowEnd}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((row) => ({
      day: row.day instanceof Date ? row.day : new Date(row.day as unknown as string),
      gross: typeof row.gross === 'bigint' ? Number(row.gross) : (row.gross ?? 0),
      completedCount:
        typeof row.completed_count === 'bigint'
          ? Number(row.completed_count)
          : Number(row.completed_count),
    }));
  }

  // ─── Sprint 6.4 — marketplace-wide aggregates ──────────────────
  //
  // Same shape as the per-provider aggregates above but without the
  // providerId filter. Used by the admin analytics + financials
  // surfaces to roll up the entire marketplace's revenue.

  async aggregateGrossRevenueForMarketplace(
    args: { from?: Date; to?: Date } = {},
    tx?: PrismaTx,
  ): Promise<{
    grossLifetime: number;
    grossWithinRange: number;
    completedLifetime: number;
    completedWithinRange: number;
    cancelledWithinRange: number;
    pendingAmount: number;
    dominantCurrency: string | null;
  }> {
    const db = this.db(tx);
    const rangeWhere = args.from && args.to ? { updatedAt: { gte: args.from, lt: args.to } } : {};
    const [lifetime, inRange, cancelledInRange, pending, currencyByCount] = await Promise.all([
      db.booking.aggregate({
        where: { deletedAt: null, status: 'COMPLETED' },
        _sum: { priceAmount: true },
        _count: { _all: true },
      }),
      db.booking.aggregate({
        where: { deletedAt: null, status: 'COMPLETED', ...rangeWhere },
        _sum: { priceAmount: true },
        _count: { _all: true },
      }),
      db.booking.count({
        where: { deletedAt: null, status: 'CANCELLED', ...rangeWhere },
      }),
      db.booking.aggregate({
        where: { deletedAt: null, status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
        _sum: { priceAmount: true },
      }),
      db.booking.groupBy({
        by: ['currency'],
        where: { deletedAt: null, status: 'COMPLETED' },
        _count: { currency: true },
        orderBy: { _count: { currency: 'desc' } },
        take: 1,
      }),
    ]);
    return {
      grossLifetime: lifetime._sum.priceAmount ?? 0,
      grossWithinRange: inRange._sum.priceAmount ?? 0,
      completedLifetime: lifetime._count._all,
      completedWithinRange: inRange._count._all,
      cancelledWithinRange: cancelledInRange,
      pendingAmount: pending._sum.priceAmount ?? 0,
      dominantCurrency: currencyByCount[0]?.currency ?? null,
    };
  }

  async aggregateEarningsByDayForMarketplace(
    windowStart: Date,
    windowEnd: Date,
    tx?: PrismaTx,
  ): Promise<Array<{ day: Date; gross: number; completedCount: number }>> {
    const db = this.db(tx);
    const rows = await db.$queryRaw<
      Array<{ day: Date; gross: bigint | number | null; completed_count: bigint | number }>
    >(Prisma.sql`
      SELECT
        DATE_TRUNC('day', "updatedAt" AT TIME ZONE 'UTC') AS day,
        COALESCE(SUM("priceAmount"), 0) AS gross,
        COUNT(*) AS completed_count
      FROM "Booking"
      WHERE "deletedAt" IS NULL
        AND status = 'COMPLETED'
        AND "updatedAt" >= ${windowStart}
        AND "updatedAt" < ${windowEnd}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((row) => ({
      day: row.day instanceof Date ? row.day : new Date(row.day as unknown as string),
      gross: typeof row.gross === 'bigint' ? Number(row.gross) : (row.gross ?? 0),
      completedCount:
        typeof row.completed_count === 'bigint'
          ? Number(row.completed_count)
          : Number(row.completed_count),
    }));
  }

  // The completed-booking page is bounded before relation joins. The exact
  // existing updatedAt/id cursor and monetary values are retained; this does
  // not turn a mutable sort key into a snapshot or read the unused Bid row.
  async listCompletedBookingsForAdmin(
    args: { take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<BookingWithAdminRelations[]> {
    const cursorJoin = args.cursor
      ? Prisma.sql`JOIN (
          SELECT id, "updatedAt" FROM "Booking" WHERE id = ${args.cursor}
        ) cursor ON TRUE`
      : Prisma.empty;
    const rows = await this.db(tx).$queryRaw<AdminFinancialBookingProjection[]>(Prisma.sql`
      SELECT page.id, page."priceAmount", page.currency, page."updatedAt",
        request."addressSnapshot", request."customServiceText",
        category.slug AS "categorySlug", category."labelEn" AS "categoryLabelEn",
        category."labelAr" AS "categoryLabelAr",
        provider.id AS "providerId", provider."displayName" AS "providerDisplayName",
        provider_user.id AS "providerUserId", provider_user.email AS "providerEmail",
        seeker.id AS "seekerId", seeker."firstName" AS "seekerFirstName"
      FROM (
        SELECT booking.* FROM "Booking" booking
        ${cursorJoin}
        WHERE booking."deletedAt" IS NULL AND booking.status = 'COMPLETED'::"BookingStatus"
          ${args.cursor ? Prisma.sql`AND (booking."updatedAt", booking.id) <= (cursor."updatedAt", cursor.id)` : Prisma.empty}
        ORDER BY booking."updatedAt" DESC, booking.id DESC
        LIMIT ${args.take} OFFSET ${args.cursor ? 1 : 0}
      ) page
      JOIN "ServiceRequest" request ON request.id = page."requestId"
      LEFT JOIN "ServiceCategory" category ON category.id = request."categoryId"
      JOIN "ProviderProfile" provider ON provider.id = page."providerId"
      LEFT JOIN "User" provider_user ON provider_user.id = provider."userId"
      JOIN "User" seeker ON seeker.id = page."seekerUserId"
      ORDER BY page."updatedAt" DESC, page.id DESC
    `);
    return rows.map((row) => ({
      id: row.id,
      priceAmount: row.priceAmount,
      currency: row.currency,
      updatedAt: row.updatedAt,
      request: listRequest(row),
      provider: {
        id: row.providerId,
        displayName: row.providerDisplayName,
        user:
          row.providerUserId === null ? null : { id: row.providerUserId, email: row.providerEmail },
      },
      seeker: { id: row.seekerId, firstName: row.seekerFirstName },
    }));
  }

  // Per-provider rollup. SUM + COUNT grouped by providerId, sorted
  // gross-descending so the marketplace's biggest earners surface
  // first. Prisma's `groupBy` does not support cursor pagination, so
  // the controller treats `cursor` as a numeric string offset (skip).
  // The admin UI's typical use case is "top N" anyway — deep paging
  // would be unusual. Currency is the booking's recorded currency.
  async groupCompletedBookingsByProvider(
    args: { take: number; skip?: number },
    tx?: PrismaTx,
  ): Promise<Array<{ providerId: string; gross: number; completedCount: number }>> {
    const db = this.db(tx);
    const rows = await db.booking.groupBy({
      by: ['providerId'],
      where: { deletedAt: null, status: 'COMPLETED' },
      _sum: { priceAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { priceAmount: 'desc' } },
      take: args.take,
      ...(args.skip ? { skip: args.skip } : {}),
    });
    return rows.map((r) => ({
      providerId: r.providerId,
      gross: r._sum.priceAmount ?? 0,
      completedCount: r._count._all,
    }));
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

type BookingListRequest = Pick<ServiceRequest, 'addressSnapshot' | 'customServiceText'> & {
  category: Pick<ServiceCategory, 'slug' | 'labelEn' | 'labelAr'> | null;
};

export type ProviderBookingListRow = Pick<
  Booking,
  | 'id'
  | 'requestId'
  | 'bidId'
  | 'status'
  | 'scheduledAt'
  | 'priceAmount'
  | 'currency'
  | 'createdAt'
  | 'updatedAt'
> & {
  request: BookingListRequest;
  bid: Pick<Bid, 'pricingType' | 'note'>;
  seeker: Pick<User, 'id' | 'firstName'>;
};

// The admin financial list's exact projection. The displayed amounts still
// come from Booking; neither Bid nor the ledger is a second read authority.
export type BookingWithAdminRelations = Pick<
  Booking,
  'id' | 'priceAmount' | 'currency' | 'updatedAt'
> & {
  request: BookingListRequest;
  provider: Pick<ProviderProfile, 'id' | 'displayName'> & {
    user: Pick<User, 'id' | 'email'> | null;
  };
  seeker: Pick<User, 'id' | 'firstName'>;
};

type BookingListRequestProjection = Pick<ServiceRequest, 'addressSnapshot' | 'customServiceText'> &
  (
    | { categorySlug: string; categoryLabelEn: string; categoryLabelAr: string }
    | { categorySlug: null; categoryLabelEn: null; categoryLabelAr: null }
  );

type ProviderBookingListProjection = Booking &
  BookingListRequestProjection & {
    pricingType: Bid['pricingType'];
    bidNote: Bid['note'];
    seekerId: User['id'];
    seekerFirstName: User['firstName'];
  };

type AdminFinancialBookingProjection = Pick<
  Booking,
  'id' | 'priceAmount' | 'currency' | 'updatedAt'
> &
  BookingListRequestProjection & {
    providerId: ProviderProfile['id'];
    providerDisplayName: ProviderProfile['displayName'];
    providerUserId: User['id'] | null;
    providerEmail: User['email'];
    seekerId: User['id'];
    seekerFirstName: User['firstName'];
  };

function listRequest(row: BookingListRequestProjection): BookingListRequest {
  return {
    addressSnapshot: row.addressSnapshot,
    customServiceText: row.customServiceText,
    category:
      row.categorySlug === null
        ? null
        : {
            slug: row.categorySlug,
            labelEn: row.categoryLabelEn,
            labelAr: row.categoryLabelAr,
          },
  };
}

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
