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

import { AppConfigService } from '../../../config/app-config.service';
import {
  BookingRepository,
  type BookingWithProviderRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_CURRENCY = 'USD';
const BPS_DENOMINATOR = 10_000;
const RANGE_DAYS: Record<EarningsChartRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Canonical provider earnings service (Sprint 5.6 refined). Fronts
// /v1/provider/earnings/{summary,transactions,chart}. Pure read model
// — no payouts, no withdrawals. Platform fee is config-driven via
// PROVIDER_PLATFORM_FEE_BPS; the service is the single source of
// truth for fee + net computation so summary + transactions + chart
// reconcile by construction.
@Injectable()
export class ProviderEarningsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly bookings: BookingRepository,
    private readonly config: AppConfigService,
  ) {}

  async summary(providerUserId: string): Promise<EarningsSummary> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const monthStart = startOfCurrentMonthUtc();
    const agg = await this.bookings.aggregateEarningsForProvider(profile.id, monthStart);
    const feeBps = this.platformFeeBps();
    const grossEarnings = agg.totalGross;
    const platformFees = applyFee(grossEarnings, feeBps);
    const netEarnings = grossEarnings - platformFees;
    return {
      grossEarnings,
      platformFees,
      netEarnings,
      // Until the payouts module ships, the available balance equals
      // netEarnings (no withdrawals to deduct). When payouts ship, this
      // becomes netEarnings − sum(successful_withdrawals).
      availableBalance: netEarnings,
      // Pending balance is gross-of-fees on in-flight bookings — the
      // wallet UI shows it as "money in flight, not yet earned" and we
      // intentionally don't pre-net it because the fee only crystallises
      // when the booking flips to COMPLETED.
      pendingBalance: agg.pendingAmount,
      completedBookingsCount: agg.completedJobsCount,
      currency: agg.dominantCurrency ?? DEFAULT_CURRENCY,
      platformFeeRateBps: feeBps,
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
    const feeBps = this.platformFeeBps();
    const items: EarningsTransaction[] = page.map((row) => toTransaction(row, feeBps));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async chart(providerUserId: string, range: EarningsChartRange): Promise<EarningsChart> {
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
    );
    const feeBps = this.platformFeeBps();
    const byKey = new Map<string, { gross: number; completedCount: number }>();
    for (const row of rows) {
      byKey.set(toIsoDay(row.day), { gross: row.gross, completedCount: row.completedCount });
    }
    const buckets: EarningsChartBucket[] = bucketKeys.map((date) => {
      const hit = byKey.get(date);
      const gross = hit?.gross ?? 0;
      const platformFees = applyFee(gross, feeBps);
      return {
        date,
        grossEarnings: gross,
        platformFees,
        netEarnings: gross - platformFees,
        completedBookings: hit?.completedCount ?? 0,
      };
    });
    // Pull the dominant currency from the existing summary aggregate so
    // the chart row uses the same currency the wallet header shows.
    const monthStart = startOfCurrentMonthUtc();
    const agg = await this.bookings.aggregateEarningsForProvider(profile.id, monthStart);
    return {
      range,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      currency: agg.dominantCurrency ?? DEFAULT_CURRENCY,
      buckets,
    };
  }

  private platformFeeBps(): number {
    return this.config.get('PROVIDER_PLATFORM_FEE_BPS');
  }
}

function applyFee(amount: number, feeBps: number): number {
  if (amount <= 0 || feeBps <= 0) return 0;
  return Math.round((amount * feeBps) / BPS_DENOMINATOR);
}

function toTransaction(row: BookingWithProviderRelations, feeBps: number): EarningsTransaction {
  const platformFee = applyFee(row.priceAmount, feeBps);
  const snapshot = row.request.addressSnapshot as { city?: string };
  return {
    id: row.id,
    bookingId: row.id,
    kind: 'BOOKING_COMPLETED',
    amount: row.priceAmount,
    platformFee,
    netAmount: row.priceAmount - platformFee,
    currency: row.currency,
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
