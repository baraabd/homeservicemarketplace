import { Injectable } from '@nestjs/common';
import type {
  AdminAnalyticsCurrencySeries,
  AdminAnalyticsOverview,
  AdminAnalyticsRangeCurrencyTotals,
  AdminAnalyticsResponse,
  AdminAnalyticsRevenue,
  AdminAnalyticsSummary,
  RevenueChartBucket,
} from '@homeservicemarketplace/contracts';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { AdminAnalyticsQueries, type CurrencyDay } from './admin-analytics.queries';

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Every dispute state that records an outcome, legacy and workspace closure. */
const RESOLVED_DISPUTE_STATUSES = [
  'RESOLVED',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_DENIED',
] as const;

// Sprint 6.4 — admin KPI surface. Three endpoints, all read-only:
//   summary()  — KPI cards (lifetime + last-30-days)
//   overview() — date-range KPIs + booked value
//   revenue()  — daily booked value in the request range
//
// R17-D (D-6): money figures are booked values per currency (never summed
// across currencies), completions are dated by their event (never by
// `updatedAt`), and no fee is computed: none is approved (R16 P10). See the
// contract (`@homeservicemarketplace/contracts` admin/analytics) for the rules.
@Injectable()
export class AdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queries: AdminAnalyticsQueries,
  ) {}

  async summary(): Promise<AdminAnalyticsResponse> {
    const c = this.prisma.client;
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY);
    const disputes = c as unknown as { dispute: { count: (a: unknown) => Promise<number> } };
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
      lifetime,
      last30,
      undated,
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
      this.queries.lifetimeByCurrency(),
      this.queries.completionsByCurrencyDay(thirtyDaysAgo, now),
      this.queries.undatedCompletions(),
      disputes.dispute.count({ where: { deletedAt: null, status: 'OPEN' } }),
      disputes.dispute.count({ where: { deletedAt: null, status: 'IN_REVIEW' } }),
      disputes.dispute.count({
        where: { deletedAt: null, status: { in: [...RESOLVED_DISPUTE_STATUSES] } },
      }),
    ]);

    const recent = sumByCurrency(last30);
    const byCurrency = lifetime.map((row) => ({
      currency: row.currency,
      bookedValueLifetime: row.bookedValue,
      completedLifetime: row.completed,
      bookedValueLast30Days: recent.get(row.currency)?.bookedValue ?? 0,
    }));
    const single = byCurrency.length === 1 ? byCurrency[0] : null;
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
        // A single figure only when there is a single currency to state.
        grossLifetimeAmount: byCurrency.length === 0 ? 0 : (single?.bookedValueLifetime ?? null),
        grossLast30DaysAmount:
          byCurrency.length === 0 ? 0 : (single?.bookedValueLast30Days ?? null),
        currency: single?.currency ?? null,
        bookedValueByCurrency: byCurrency,
        undatedCompletions: undated,
      },
      disputes: {
        open: disputesOpen,
        inReview: disputesInReview,
        resolvedLifetime: disputesResolved,
      },
      generatedAt: now.toISOString(),
    };
    return { summary };
  }

  async overview(rawFrom?: string, rawTo?: string): Promise<AdminAnalyticsOverview> {
    const { from, to } = resolveRange(rawFrom, rawTo);
    const c = this.prisma.client;
    const [
      lifetime,
      inRange,
      undated,
      cancelled,
      usersTotal,
      providersTotal,
      requestsTotal,
      disputesOpen,
    ] = await Promise.all([
      this.queries.lifetimeByCurrency(),
      this.queries.completionsByCurrencyDay(from, to),
      this.queries.undatedCompletions(),
      this.queries.cancellationsWithin(from, to),
      c.user.count({ where: { deletedAt: null } }),
      c.providerProfile.count({ where: { deletedAt: null } }),
      c.serviceRequest.count({ where: { deletedAt: null } }),
      (c as unknown as { dispute: { count: (a: unknown) => Promise<number> } }).dispute.count({
        where: { deletedAt: null, status: 'OPEN' },
      }),
    ]);
    const ranged = sumByCurrency(inRange);
    const byCurrency: AdminAnalyticsRangeCurrencyTotals[] = [
      ...new Set([...lifetime.map((r) => r.currency), ...ranged.keys()]),
    ]
      .sort()
      .map((currency) => {
        const life = lifetime.find((r) => r.currency === currency);
        const range = ranged.get(currency);
        return {
          currency,
          bookedValueLifetime: life?.bookedValue ?? 0,
          completedLifetime: life?.completed ?? 0,
          bookedValueWithinRange: range?.bookedValue ?? 0,
          completedWithinRange: range?.completed ?? 0,
        };
      });
    const rangeCurrencies = [...ranged.keys()];
    return {
      range: { from: toIsoDay(from), to: toIsoDay(addDays(to, -1)) },
      counts: {
        users: usersTotal,
        providers: providersTotal,
        requests: requestsTotal,
        bookingsCompleted: [...ranged.values()].reduce((n, r) => n + r.completed, 0),
        bookingsCancelled: cancelled,
        disputesOpen,
        undatedCompletions: undated,
      },
      revenue: {
        grossWithinRange:
          rangeCurrencies.length === 0
            ? 0
            : rangeCurrencies.length === 1
              ? ranged.get(rangeCurrencies[0])!.bookedValue
              : null,
        platformFeesWithinRange: null,
        netProviderEarningsWithinRange: null,
        grossLifetime:
          lifetime.length === 0 ? 0 : lifetime.length === 1 ? lifetime[0].bookedValue : null,
      },
      revenueByCurrency: byCurrency,
      currency: byCurrency.length === 1 ? byCurrency[0].currency : null,
      platformFeeRateBps: null,
      feeStatus: 'NOT_APPROVED',
      generatedAt: new Date().toISOString(),
    };
  }

  async revenue(rawFrom?: string, rawTo?: string): Promise<AdminAnalyticsRevenue> {
    const { from, to } = resolveRange(rawFrom, rawTo);
    const rows = await this.queries.completionsByCurrencyDay(from, to);
    const days: string[] = [];
    for (let d = new Date(from); d < to; d = addDays(d, 1)) days.push(toIsoDay(d));
    const currencies = [...new Set(rows.map((r) => r.currency))].sort();
    const series: AdminAnalyticsCurrencySeries[] = currencies.map((currency) => ({
      currency,
      buckets: days.map((date) => {
        const hit = rows.find((r) => r.currency === currency && r.day === date);
        return { date, bookedValue: hit?.bookedValue ?? 0, completedBookings: hit?.completed ?? 0 };
      }),
    }));
    // Back-compat day buckets: a money figure only where the day has one
    // currency (or none, which is a genuine 0); counts are currency-free.
    const buckets: RevenueChartBucket[] = days.map((date) => {
      const dayRows = rows.filter((r) => r.day === date);
      return {
        date,
        grossEarnings:
          dayRows.length === 0 ? 0 : dayRows.length === 1 ? dayRows[0].bookedValue : null,
        platformFees: null,
        netProviderEarnings: null,
        completedBookings: dayRows.reduce((n, r) => n + r.completed, 0),
      };
    });
    return {
      range: { from: toIsoDay(from), to: toIsoDay(addDays(to, -1)) },
      currency: currencies.length === 1 ? currencies[0] : null,
      platformFeeRateBps: null,
      feeStatus: 'NOT_APPROVED',
      buckets,
      series,
    };
  }
}

// ─── helpers ────────────────────────────────────────────────────

function sumByCurrency(
  rows: CurrencyDay[],
): Map<string, { bookedValue: number; completed: number }> {
  const out = new Map<string, { bookedValue: number; completed: number }>();
  for (const row of rows) {
    const acc = out.get(row.currency) ?? { bookedValue: 0, completed: 0 };
    acc.bookedValue += row.bookedValue;
    acc.completed += row.completed;
    out.set(row.currency, acc);
  }
  return out;
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
  // Date.parse accepts 2026-02-31 as March 3rd; refuse a day that does not exist.
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== raw) {
    throw new AppError('VALIDATION_ERROR', `\`${field}\` is not a valid date.`, 400);
  }
  return new Date(ms);
}

function todayMidnightUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
