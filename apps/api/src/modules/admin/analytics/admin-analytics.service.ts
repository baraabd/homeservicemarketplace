import { Injectable } from '@nestjs/common';
import type {
  AdminAnalyticsOverview,
  AdminAnalyticsResponse,
  AdminAnalyticsRevenue,
  AdminAnalyticsSummary,
  RevenueChartBucket,
} from '@homeservicemarketplace/contracts';

import { AppConfigService } from '../../../config/app-config.service';
import { BookingRepository } from '../../../infrastructure/persistence/bookings/booking.repository';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_CURRENCY = 'USD';
const BPS_DENOMINATOR = 10_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Sprint 6.4 — admin KPI surface. Three endpoints, all read-only:
//   summary()  — KPI cards (lifetime + last-30-days; existing)
//   overview() — date-range KPIs + revenue rollup + lifetime gross
//   revenue()  — daily revenue / fee / net buckets in the request range
//
// All counts run in parallel so the response time tracks the slowest
// single COUNT, not their sum. Platform-fee math is shared with the
// provider-side wallet (env-driven `PROVIDER_PLATFORM_FEE_BPS`).
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingRepository,
    private readonly config: AppConfigService,
  ) {}

  async summary(): Promise<AdminAnalyticsResponse> {
    const c = this.prisma.client;
    const sevenDaysAgo = new Date(Date.now() - 7 * MS_PER_DAY);
    const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY);
    const [
      usersTotal,
      usersActive,
      usersSuspended,
      usersPending,
      usersNew7d,
      providersTotal,
      providersActive,
      providersPending,
      providersSuspended,
      providersRejected,
      reqOpen,
      reqAccepted,
      reqCompleted,
      bkScheduled,
      bkInProgress,
      bkCompleted,
      bkCancelled,
      bkGrossLifetime,
      bkGross30d,
      bkDominantCurrency,
      disputesOpen,
      disputesInReview,
      disputesResolved,
    ] = await Promise.all([
      c.user.count({ where: { deletedAt: null } }),
      c.user.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      c.user.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      c.user.count({ where: { deletedAt: null, status: 'PENDING_VERIFICATION' } }),
      c.user.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
      c.providerProfile.count({ where: { deletedAt: null } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'PENDING_REVIEW' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'SUSPENDED' } }),
      c.providerProfile.count({ where: { deletedAt: null, status: 'REJECTED' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'OPEN_FOR_BIDS' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'BID_ACCEPTED' } }),
      c.serviceRequest.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'SCHEDULED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'IN_PROGRESS' } }),
      c.booking.count({ where: { deletedAt: null, status: 'COMPLETED' } }),
      c.booking.count({ where: { deletedAt: null, status: 'CANCELLED' } }),
      c.booking.aggregate({
        where: { deletedAt: null, status: 'COMPLETED' },
        _sum: { priceAmount: true },
      }),
      c.booking.aggregate({
        where: { deletedAt: null, status: 'COMPLETED', updatedAt: { gte: thirtyDaysAgo } },
        _sum: { priceAmount: true },
      }),
      c.booking.groupBy({
        by: ['currency'],
        where: { deletedAt: null, status: 'COMPLETED' },
        _count: { currency: true },
        orderBy: { _count: { currency: 'desc' } },
        take: 1,
      }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'OPEN' },
      }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'IN_REVIEW' },
      }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: {
          deletedAt: null,
          status: { in: ['RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'] },
        },
      }),
    ]);

    const summary: AdminAnalyticsSummary = {
      users: {
        total: usersTotal,
        active: usersActive,
        suspended: usersSuspended,
        pendingVerification: usersPending,
        newLast7Days: usersNew7d,
      },
      providers: {
        total: providersTotal,
        active: providersActive,
        pendingReview: providersPending,
        suspended: providersSuspended,
        rejected: providersRejected,
      },
      requests: {
        openForBids: reqOpen,
        bidAccepted: reqAccepted,
        completed: reqCompleted,
      },
      bookings: {
        scheduled: bkScheduled,
        inProgress: bkInProgress,
        completed: bkCompleted,
        cancelled: bkCancelled,
        grossLifetimeAmount: bkGrossLifetime._sum.priceAmount ?? 0,
        grossLast30DaysAmount: bkGross30d._sum.priceAmount ?? 0,
        currency: bkDominantCurrency[0]?.currency ?? DEFAULT_CURRENCY,
      },
      disputes: {
        open: disputesOpen,
        inReview: disputesInReview,
        resolvedLifetime: disputesResolved,
      },
      generatedAt: new Date().toISOString(),
    };
    return { summary };
  }

  async overview(rawFrom?: string, rawTo?: string): Promise<AdminAnalyticsOverview> {
    const { from, to } = resolveRange(rawFrom, rawTo);
    const c = this.prisma.client;
    const feeBps = this.platformFeeBps();
    const [revenue, usersTotal, providersTotal, requestsTotal, disputesOpen] = await Promise.all([
      this.bookings.aggregateGrossRevenueForMarketplace({ from, to }),
      c.user.count({ where: { deletedAt: null } }),
      c.providerProfile.count({ where: { deletedAt: null } }),
      c.serviceRequest.count({ where: { deletedAt: null } }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'OPEN' },
      }),
    ]);
    const platformFeesWithinRange = applyFee(revenue.grossWithinRange, feeBps);
    return {
      range: { from: toIsoDay(from), to: toIsoDay(addDays(to, -1)) },
      counts: {
        users: usersTotal,
        providers: providersTotal,
        requests: requestsTotal,
        bookingsCompleted: revenue.completedWithinRange,
        bookingsCancelled: revenue.cancelledWithinRange,
        disputesOpen,
      },
      revenue: {
        grossWithinRange: revenue.grossWithinRange,
        platformFeesWithinRange,
        netProviderEarningsWithinRange: revenue.grossWithinRange - platformFeesWithinRange,
        grossLifetime: revenue.grossLifetime,
      },
      currency: revenue.dominantCurrency ?? DEFAULT_CURRENCY,
      platformFeeRateBps: feeBps,
      generatedAt: new Date().toISOString(),
    };
  }

  async revenue(rawFrom?: string, rawTo?: string): Promise<AdminAnalyticsRevenue> {
    const { from, to } = resolveRange(rawFrom, rawTo);
    const feeBps = this.platformFeeBps();
    const rows = await this.bookings.aggregateEarningsByDayForMarketplace(from, to);
    const byKey = new Map<string, { gross: number; completedCount: number }>();
    for (const row of rows) {
      byKey.set(toIsoDay(row.day), { gross: row.gross, completedCount: row.completedCount });
    }
    // Zero-fill: emit one row per UTC day in [from, to), inclusive of
    // the start, exclusive of the end. The wire `range.to` is shown
    // back to the client as the inclusive last day for UX clarity.
    const buckets: RevenueChartBucket[] = [];
    for (let d = new Date(from); d < to; d = addDays(d, 1)) {
      const key = toIsoDay(d);
      const hit = byKey.get(key);
      const gross = hit?.gross ?? 0;
      const platformFees = applyFee(gross, feeBps);
      buckets.push({
        date: key,
        grossEarnings: gross,
        platformFees,
        netProviderEarnings: gross - platformFees,
        completedBookings: hit?.completedCount ?? 0,
      });
    }
    // Pull dominant currency separately so an empty range still
    // returns the marketplace's prevailing currency.
    const revenue = await this.bookings.aggregateGrossRevenueForMarketplace();
    return {
      range: { from: toIsoDay(from), to: toIsoDay(addDays(to, -1)) },
      currency: revenue.dominantCurrency ?? DEFAULT_CURRENCY,
      platformFeeRateBps: feeBps,
      buckets,
    };
  }

  private platformFeeBps(): number {
    return this.config.get('PROVIDER_PLATFORM_FEE_BPS');
  }
}

// ─── helpers ────────────────────────────────────────────────────

function applyFee(amount: number, feeBps: number): number {
  if (amount <= 0 || feeBps <= 0) return 0;
  return Math.round((amount * feeBps) / BPS_DENOMINATOR);
}

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

function resolveRange(rawFrom?: string, rawTo?: string): { from: Date; to: Date } {
  const todayUtcMidnight = todayMidnightUtc();
  let to: Date;
  if (rawTo) {
    const parsed = parseIsoDay(rawTo, 'to');
    // `to` is INCLUSIVE on the wire; convert to half-open by adding a day.
    to = addDays(parsed, 1);
  } else {
    to = addDays(todayUtcMidnight, 1);
  }
  let from: Date;
  if (rawFrom) {
    from = parseIsoDay(rawFrom, 'from');
  } else {
    from = addDays(to, -DEFAULT_RANGE_DAYS);
  }
  if (from.getTime() >= to.getTime()) {
    throw new AppError('VALIDATION_ERROR', '`from` must be earlier than `to`.', 400);
  }
  const days = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
  if (days > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_ERROR', `Date range exceeds ${MAX_RANGE_DAYS} days.`, 400);
  }
  return { from, to };
}

function parseIsoDay(raw: string, field: 'from' | 'to'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AppError('VALIDATION_ERROR', `\`${field}\` must be ISO YYYY-MM-DD.`, 400);
  }
  const ms = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(ms)) {
    throw new AppError('VALIDATION_ERROR', `\`${field}\` is not a valid date.`, 400);
  }
  return new Date(ms);
}

function todayMidnightUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
