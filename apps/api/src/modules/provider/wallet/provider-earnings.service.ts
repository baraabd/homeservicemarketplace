import { Injectable } from '@nestjs/common';
import type {
  EarningsChart,
  EarningsChartBucket,
  EarningsChartRange,
  EarningsSummary,
  EarningsTransaction,
  ListProviderEarningsTransactionsQuery,
  ListProviderEarningsTransactionsResponse,
} from '@homeservicemarketplace/contracts';

import {
  APPROVED_CURRENCY_SCALES,
  isApprovedCurrency,
  LAUNCH_CURRENCY,
} from '@homeservicemarketplace/contracts';

import { summarizeBookedValue } from '../../../infrastructure/persistence/bookings/booked-value';
import {
  BookingRepository,
  type ProviderBookingListRow,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 30;
const RANGE_DAYS: Record<EarningsChartRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Canonical provider earnings service. Fronts
// /v1/provider/earnings/{summary,transactions,chart}. Pure read model of
// BOOKED value — no payouts, no withdrawals, no balance. K02: amounts are
// grouped per currency, only verified FIXED-price amounts are summed,
// exclusions are counted, and no fee is computed (none is approved;
// PROVIDER_PLATFORM_FEE_BPS no longer feeds any provider-facing figure).
@Injectable()
export class ProviderEarningsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly bookings: BookingRepository,
  ) {}

  async summary(providerUserId: string): Promise<EarningsSummary> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const groups = await this.bookings.bookedValueGroups({
      providerId: profile.id,
      monthStart: startOfCurrentMonthUtc(),
    });
    const value = summarizeBookedValue(groups);
    return {
      byCurrency: value.byCurrency,
      excluded: value.excluded,
      completedBookingsCount: value.completedCount,
      feeStatus: 'NOT_APPROVED',
      platformFeeRateBps: null,
      ratingAvg: profile.ratingAvg,
      reviewCount: profile.reviewCount,
    };
  }

  async transactions(
    providerUserId: string,
    query: ListProviderEarningsTransactionsQuery,
  ): Promise<ListProviderEarningsTransactionsResponse> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.bookings.listForProvider({
      providerId: profile.id,
      // Canonical wallet endpoint is COMPLETED-only — in-flight rows
      // surface on the summary's pendingBalance, not on the transaction
      // history. This is a deliberate departure from the legacy
      // /v1/me/provider/earnings/transactions endpoint, which kept the
      // status filter for the prior wallet UI.
      status: 'COMPLETED',
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: EarningsTransaction[] = page.map(toTransaction);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async chart(
    providerUserId: string,
    range: EarningsChartRange,
    currency: string = LAUNCH_CURRENCY,
  ): Promise<EarningsChart> {
    if (!isApprovedCurrency(currency)) {
      throw new AppError('VALIDATION_ERROR', 'Currency is not approved.', 400, {
        reason: 'CURRENCY_NOT_APPROVED',
      });
    }
    const amountScale = APPROVED_CURRENCY_SCALES[currency];
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const days = RANGE_DAYS[range];
    const { windowStart, windowEnd, bucketKeys } = buildDailyWindow(days);
    const rows = await this.bookings.aggregateEarningsByDayForProvider(
      profile.id,
      windowStart,
      windowEnd,
      { currency, amountScale },
    );
    const byKey = new Map<string, { gross: number; completedCount: number }>();
    for (const row of rows) {
      byKey.set(toIsoDay(row.day), { gross: row.gross, completedCount: row.completedCount });
    }
    const buckets: EarningsChartBucket[] = bucketKeys.map((date) => {
      const hit = byKey.get(date);
      return {
        date,
        grossEarnings: hit?.gross ?? 0,
        completedBookings: hit?.completedCount ?? 0,
      };
    });
    return {
      range,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      currency,
      amountScale,
      buckets,
    };
  }
}

function toTransaction(row: ProviderBookingListRow): EarningsTransaction {
  const snapshot = row.request.addressSnapshot as { city?: string };
  return {
    id: row.id,
    bookingId: row.id,
    kind: 'BOOKING_COMPLETED',
    amount: row.priceAmount,
    pricingType: row.bid.pricingType,
    currency: row.currency,
    amountScale: row.amountScale,
    occurredAt: row.updatedAt.toISOString(),
    service: {
      categorySlug: row.request.category?.slug ?? null,
      categoryLabelEn: row.request.category?.labelEn ?? null,
      categoryLabelAr: row.request.category?.labelAr ?? null,
      customServiceText: row.request.customServiceText,
    },
    city: snapshot.city ?? '',
  };
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

// Daily window builder. Returns:
//   windowStart — midnight UTC of (today − (days-1))
//   windowEnd   — midnight UTC of (tomorrow), exclusive
//   bucketKeys  — ISO 'YYYY-MM-DD' strings for every day in the window
//                 in chronological order, used to zero-fill missing days
function buildDailyWindow(days: number): {
  windowStart: Date;
  windowEnd: Date;
  bucketKeys: string[];
} {
  const now = new Date();
  const todayUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowEnd = new Date(todayUtcMidnight + 24 * 60 * 60 * 1000);
  const windowStart = new Date(todayUtcMidnight - (days - 1) * 24 * 60 * 60 * 1000);
  const bucketKeys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const t = new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000);
    bucketKeys.push(toIsoDay(t));
  }
  return { windowStart, windowEnd, bucketKeys };
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
