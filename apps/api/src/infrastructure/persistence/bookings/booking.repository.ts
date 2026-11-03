import { Injectable } from '@nestjs/common';
import { toSafeNumber, type BookedValueGroupRow } from './booked-value';
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
  /** K02 — copied from the bid unchanged; null keeps a legacy bid quarantined. */
  amountScale: number | null;
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

type BookingListRequest = Pick<ServiceRequest, 'customServiceText' | 'addressSnapshot'> & {
  category: Pick<ServiceCategory, 'id' | 'slug' | 'labelEn' | 'labelAr'> | null;
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
  | 'amountScale'
  | 'createdAt'
  | 'updatedAt'
> & {
  request: BookingListRequest;
  bid: Pick<Bid, 'pricingType' | 'note'>;
  seeker: Pick<User, 'id' | 'firstName'>;
};

export type AdminFinancialBookingListRow = Pick<
  Booking,
  'id' | 'priceAmount' | 'currency' | 'amountScale' | 'updatedAt'
> & {
  request: BookingListRequest;
  bid: Pick<Bid, 'pricingType'>;
  provider: Pick<ProviderProfile, 'id' | 'displayName'> & {
    user: Pick<User, 'id' | 'email'> | null;
  };
  seeker: Pick<User, 'id' | 'firstName'>;
};

// A primary key supplies at most one request. Keep that lookup correlated to
// each page row even when a generic plan cannot know the page-size parameter;
// flattening an ordinary join can instead scan the entire request table.
const BOOKING_REQUEST_LIST_JOIN = Prisma.sql`
  JOIN LATERAL (
    SELECT request."customServiceText", request."addressSnapshot", request."categoryId"
    FROM "ServiceRequest" request
    WHERE request."id" = page."requestId"
    LIMIT 1
  ) request ON TRUE
`;

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
        amountScale: input.amountScale,
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
        SELECT page.id, page."requestId", page."bidId", page.status::text AS status,
          page."scheduledAt", page."priceAmount", page.currency, page."amountScale", page."createdAt", page."updatedAt",
          request."addressSnapshot", request."customServiceText",
          category.id AS "categoryId", category.slug AS "categorySlug", category."labelEn" AS "categoryLabelEn",
          category."labelAr" AS "categoryLabelAr", bid."pricingType"::text AS "pricingType", bid.note AS "bidNote",
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
        ${BOOKING_REQUEST_LIST_JOIN}
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
          amountScale: row.amountScale,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          request: listRequest(row),
          bid: { pricingType: row.pricingType, note: row.bidNote },
          seeker: { id: row.seekerId, firstName: row.seekerFirstName },
        })),
      );
  }

  // Both the booking screen and wallet use one bounded projection. Keep this
  // entry point for existing callers without maintaining a second SQL query.
  listForProviderSummary(
    args: { providerId: string; status?: BookingStatus; take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<ProviderBookingListRow[]> {
    return this.listForProvider(args, tx);
  }

  // R17-E closure — is this id a booking of this provider (deleted or not)?
  // Separately verifies cursor ownership, including soft-deleted owned IDs.
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

  // K02 — booked-value groups for the wallet, legacy earnings and admin
  // financials read models. One row per (currency, amountScale,
  // pricingType); summarizeBookedValue applies the hsm.amount-unit.v1
  // rules (per currency, verified FIXED only, exclusions counted).
  // `providerId` omitted = marketplace-wide. Cancelled bookings are not
  // booked value and are excluded.
  async bookedValueGroups(
    args: { providerId?: string; monthStart: Date },
    tx?: PrismaTx,
  ): Promise<BookedValueGroupRow[]> {
    const providerFilter = args.providerId
      ? Prisma.sql`AND b."providerId" = ${args.providerId}`
      : Prisma.empty;
    const rows = await this.db(tx).$queryRaw<
      Array<{
        currency: string;
        amountScale: number | null;
        pricingType: 'FIXED' | 'HOURLY';
        completed_count: bigint;
        completed_value: bigint | null;
        month_value: bigint | null;
        in_flight_count: bigint;
        in_flight_value: bigint | null;
      }>
    >(Prisma.sql`
      SELECT
        b."currency",
        b."amountScale",
        bid."pricingType"::text AS "pricingType",
        COUNT(*) FILTER (WHERE b."status" = 'COMPLETED') AS completed_count,
        SUM(b."priceAmount") FILTER (WHERE b."status" = 'COMPLETED') AS completed_value,
        SUM(b."priceAmount") FILTER (
          WHERE b."status" = 'COMPLETED' AND b."updatedAt" >= ${args.monthStart}
        ) AS month_value,
        COUNT(*) FILTER (WHERE b."status" IN ('SCHEDULED', 'IN_PROGRESS')) AS in_flight_count,
        SUM(b."priceAmount") FILTER (
          WHERE b."status" IN ('SCHEDULED', 'IN_PROGRESS')
        ) AS in_flight_value
      FROM "Booking" b
      JOIN "Bid" bid ON bid."id" = b."bidId"
      WHERE b."deletedAt" IS NULL
        AND b."status" IN ('COMPLETED', 'SCHEDULED', 'IN_PROGRESS')
        ${providerFilter}
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3
    `);
    return rows.map((row) => ({
      currency: row.currency,
      amountScale: row.amountScale,
      pricingType: row.pricingType,
      completedCount: toSafeNumber(row.completed_count),
      completedValue: toSafeNumber(row.completed_value),
      currentMonthValue: toSafeNumber(row.month_value),
      inFlightCount: toSafeNumber(row.in_flight_count),
      inFlightValue: toSafeNumber(row.in_flight_value),
    }));
  }

  // Daily-bucketed booked value for the provider wallet chart. One UTC
  // day per row in [windowStart, windowEnd) that has at least one
  // COMPLETED booking. K02 — ONE currency and scale per chart, verified
  // FIXED-price bookings only: a chart never adds currencies, legacy-unit
  // amounts or hourly rates. Bucketed by booking.updatedAt (the moment the
  // provider marked it COMPLETED), consistent with the month figure.
  async aggregateEarningsByDayForProvider(
    providerId: string,
    windowStart: Date,
    windowEnd: Date,
    unit: { currency: string; amountScale: number },
    tx?: PrismaTx,
  ): Promise<Array<{ day: Date; gross: number; completedCount: number }>> {
    const rows = await this.db(tx).$queryRaw<
      Array<{ day: Date; gross: bigint | number | null; completed_count: bigint | number }>
    >(Prisma.sql`
      SELECT
        DATE_TRUNC('day', b."updatedAt" AT TIME ZONE 'UTC') AS day,
        COALESCE(SUM(b."priceAmount"), 0) AS gross,
        COUNT(*) AS completed_count
      FROM "Booking" b
      JOIN "Bid" bid ON bid."id" = b."bidId"
      WHERE b."providerId" = ${providerId}
        AND b."deletedAt" IS NULL
        AND b.status = 'COMPLETED'
        AND b."currency" = ${unit.currency}
        AND b."amountScale" = ${unit.amountScale}
        AND bid."pricingType" = 'FIXED'
        AND b."updatedAt" >= ${windowStart}
        AND b."updatedAt" < ${windowEnd}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((row) => ({
      day: row.day instanceof Date ? row.day : new Date(row.day as unknown as string),
      gross: toSafeNumber(row.gross),
      completedCount: toSafeNumber(row.completed_count),
    }));
  }

  // The completed-booking page is bounded before relation joins. The exact
  // existing updatedAt/id cursor and monetary values are retained; this does
  // not turn a mutable sort key into a snapshot. K02 joins the page's Bid rows (after
  // LIMIT, so at most `take` lookups by primary key) for pricingType.
  async listCompletedBookingsForAdmin(
    args: { take: number; cursor?: string },
    tx?: PrismaTx,
  ): Promise<BookingWithAdminRelations[]> {
    const cursorJoin = args.cursor
      ? Prisma.sql`JOIN (
          SELECT id, "updatedAt" FROM "Booking" WHERE id = ${args.cursor}
        ) cursor ON TRUE`
      : Prisma.empty;
    // Infer the constant status literal from the column's enum, including when
    // a schema-local table reuses an enum defined in a different schema.
    const rows = await this.db(tx).$queryRaw<AdminFinancialBookingProjection[]>(Prisma.sql`
      SELECT page.id, page."priceAmount", page.currency, page."amountScale", page."updatedAt",
        request."addressSnapshot", request."customServiceText",
        category.id AS "categoryId", category.slug AS "categorySlug", category."labelEn" AS "categoryLabelEn",
        category."labelAr" AS "categoryLabelAr", bid."pricingType"::text AS "pricingType",
        provider.id AS "providerId", provider."displayName" AS "providerDisplayName",
        provider_user.id AS "providerUserId", provider_user.email AS "providerEmail",
        seeker.id AS "seekerId", seeker."firstName" AS "seekerFirstName"
      FROM (
        SELECT booking.* FROM "Booking" booking
        ${cursorJoin}
        WHERE booking."deletedAt" IS NULL AND booking.status = 'COMPLETED'
          ${args.cursor ? Prisma.sql`AND (booking."updatedAt", booking.id) <= (cursor."updatedAt", cursor.id)` : Prisma.empty}
        ORDER BY booking."updatedAt" DESC, booking.id DESC
        LIMIT ${args.take} OFFSET ${args.cursor ? 1 : 0}
      ) page
      ${BOOKING_REQUEST_LIST_JOIN}
      LEFT JOIN "ServiceCategory" category ON category.id = request."categoryId"
      JOIN "Bid" bid ON bid.id = page."bidId"
      JOIN "ProviderProfile" provider ON provider.id = page."providerId"
      LEFT JOIN "User" provider_user ON provider_user.id = provider."userId"
      JOIN "User" seeker ON seeker.id = page."seekerUserId"
      ORDER BY page."updatedAt" DESC, page.id DESC
    `);
    return rows.map((row) => ({
      id: row.id,
      priceAmount: row.priceAmount,
      currency: row.currency,
      amountScale: row.amountScale,
      updatedAt: row.updatedAt,
      request: listRequest(row),
      bid: { pricingType: row.pricingType },
      provider: {
        id: row.providerId,
        displayName: row.providerDisplayName,
        user:
          row.providerUserId === null ? null : { id: row.providerUserId, email: row.providerEmail },
      },
      seeker: { id: row.seekerId, firstName: row.seekerFirstName },
    }));
  }

  // Per-provider rollup, K02 — one row per (provider, currency) over
  // verified FIXED-price COMPLETED bookings, value-descending. A provider
  // with SAR and another currency gets two rows; nothing is added across
  // currencies. Legacy-unit and hourly bookings are excluded here and
  // counted on the summary. `skip` is a numeric offset (Prisma-style
  // top-N paging, unchanged).
  async groupCompletedBookingsByProvider(
    args: { take: number; skip?: number },
    tx?: PrismaTx,
  ): Promise<
    Array<{
      providerId: string;
      currency: string;
      amountScale: number;
      gross: number;
      completedCount: number;
    }>
  > {
    const rows = await this.db(tx).$queryRaw<
      Array<{
        providerId: string;
        currency: string;
        amountScale: number;
        gross: bigint;
        completed_count: bigint;
      }>
    >(Prisma.sql`
      SELECT b."providerId", b."currency", b."amountScale",
             SUM(b."priceAmount") AS gross, COUNT(*) AS completed_count
      FROM "Booking" b
      JOIN "Bid" bid ON bid."id" = b."bidId"
      WHERE b."deletedAt" IS NULL
        AND b."status" = 'COMPLETED'
        AND b."amountScale" IS NOT NULL
        AND bid."pricingType" = 'FIXED'
      GROUP BY 1, 2, 3
      ORDER BY gross DESC, 1 ASC, 2 ASC
      LIMIT ${args.take} OFFSET ${args.skip ?? 0}
    `);
    return rows.map((r) => ({
      providerId: r.providerId,
      currency: r.currency,
      amountScale: r.amountScale,
      gross: toSafeNumber(r.gross),
      completedCount: toSafeNumber(r.completed_count),
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

// The financial mapper uses the same category projection as provider lists;
// amounts remain Booking-owned and no ledger or Bid read is introduced.
export type BookingWithAdminRelations = AdminFinancialBookingListRow;

type BookingListRequestProjection = Pick<ServiceRequest, 'addressSnapshot' | 'customServiceText'> &
  (
    | { categoryId: string; categorySlug: string; categoryLabelEn: string; categoryLabelAr: string }
    | { categoryId: null; categorySlug: null; categoryLabelEn: null; categoryLabelAr: null }
  );

// Built-in text preserves enum labels without cold-connection pg_type lookups
// in the raw-query decoder. Predicate columns retain their indexed enum types.
type ProviderBookingListProjection = Omit<ProviderBookingListRow, 'request' | 'bid' | 'seeker'> &
  BookingListRequestProjection & {
    pricingType: Bid['pricingType'];
    bidNote: Bid['note'];
    seekerId: User['id'];
    seekerFirstName: User['firstName'];
  };

type AdminFinancialBookingProjection = Pick<
  Booking,
  'id' | 'priceAmount' | 'currency' | 'amountScale' | 'updatedAt'
> &
  BookingListRequestProjection & {
    pricingType: Bid['pricingType'];
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
            id: row.categoryId,
            slug: row.categorySlug,
            labelEn: row.categoryLabelEn,
            labelAr: row.categoryLabelAr,
          },
  };
}

declare module './booking.repository' {
  // Marker so the repository class can extend itself in this file
  // without a separate type declaration. Empty by design.
}
