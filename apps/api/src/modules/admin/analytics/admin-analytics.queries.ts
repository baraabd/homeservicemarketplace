import { Injectable } from '@nestjs/common';
import { Prisma } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

// R17-D (D-6) — the analytics read model, kept apart from the booking
// repository's provider-earnings and financials queries (R15/R16 territory),
// whose semantics this unit does not change.
//
// Two rules hold for every query here:
//   • amounts are grouped by `Booking.currency` and never summed across it;
//   • "when did it complete / cancel" is the booking's own event
//     (BOOKING_STATUS_CHANGED → COMPLETED, BOOKING_CANCELLED), the same time
//     authority dispute intake uses — never the mutable `updatedAt`.
//
// Timestamps are stored as UTC `timestamp without time zone`, so the day key
// is computed in SQL from the stored value and returned as text: no session
// or JS time zone takes part.

export interface CurrencyLifetime {
  currency: string;
  bookedValue: number;
  completed: number;
}
export interface CurrencyDay {
  currency: string;
  day: string;
  bookedValue: number;
  completed: number;
}

/** First completion event per booking; a re-sent event never double-counts. */
const COMPLETIONS = Prisma.sql`
  SELECT DISTINCT ON (e."bookingId") e."bookingId", e."createdAt" AS "at"
  FROM "BookingEvent" e
  WHERE e."type" = 'BOOKING_STATUS_CHANGED' AND e."metadata"->>'to' = 'COMPLETED'
  ORDER BY e."bookingId", e."createdAt" ASC, e."id" ASC`;

const toInt = (v: bigint | number | null) => (typeof v === 'bigint' ? Number(v) : (v ?? 0));

@Injectable()
export class AdminAnalyticsQueries {
  constructor(private readonly prisma: PrismaService) {}

  /** Lifetime booked value of COMPLETED bookings, per currency (dated or not). */
  async lifetimeByCurrency(): Promise<CurrencyLifetime[]> {
    const rows = await this.prisma.client.$queryRaw<
      { currency: string; value: bigint | null; n: bigint }[]
    >(Prisma.sql`
      SELECT "currency", SUM("priceAmount")::bigint AS "value", COUNT(*)::bigint AS "n"
      FROM "Booking"
      WHERE "deletedAt" IS NULL AND "status" = 'COMPLETED'
      GROUP BY "currency"
      ORDER BY "currency"`);
    return rows.map((r) => ({
      currency: r.currency,
      bookedValue: toInt(r.value),
      completed: toInt(r.n),
    }));
  }

  /** Completions dated by their event in [from, to), per currency and UTC day. */
  async completionsByCurrencyDay(from: Date, to: Date): Promise<CurrencyDay[]> {
    const rows = await this.prisma.client.$queryRaw<
      { currency: string; day: string; value: bigint | null; n: bigint }[]
    >(Prisma.sql`
      WITH done AS (${COMPLETIONS})
      SELECT b."currency",
             to_char(date_trunc('day', d."at"), 'YYYY-MM-DD') AS "day",
             SUM(b."priceAmount")::bigint AS "value",
             COUNT(*)::bigint AS "n"
      FROM done d
      JOIN "Booking" b ON b."id" = d."bookingId"
      WHERE b."deletedAt" IS NULL AND b."status" = 'COMPLETED'
        AND d."at" >= ${from} AND d."at" < ${to}
      GROUP BY 1, 2
      ORDER BY 1, 2`);
    return rows.map((r) => ({
      currency: r.currency,
      day: r.day,
      bookedValue: toInt(r.value),
      completed: toInt(r.n),
    }));
  }

  /** COMPLETED bookings with no completion event: they cannot be dated. */
  async undatedCompletions(): Promise<number> {
    const [row] = await this.prisma.client.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "n"
      FROM "Booking" b
      WHERE b."deletedAt" IS NULL AND b."status" = 'COMPLETED'
        AND NOT EXISTS (
          SELECT 1 FROM "BookingEvent" e
          WHERE e."bookingId" = b."id"
            AND e."type" = 'BOOKING_STATUS_CHANGED' AND e."metadata"->>'to' = 'COMPLETED')`);
    return toInt(row?.n ?? 0);
  }

  /** CANCELLED bookings whose cancellation event falls in [from, to). */
  async cancellationsWithin(from: Date, to: Date): Promise<number> {
    const [row] = await this.prisma.client.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT e."bookingId")::bigint AS "n"
      FROM "BookingEvent" e
      JOIN "Booking" b ON b."id" = e."bookingId"
      WHERE e."type" = 'BOOKING_CANCELLED'
        AND b."deletedAt" IS NULL AND b."status" = 'CANCELLED'
        AND e."createdAt" >= ${from} AND e."createdAt" < ${to}`);
    return toInt(row?.n ?? 0);
  }
}
