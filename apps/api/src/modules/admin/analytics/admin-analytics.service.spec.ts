import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AdminAnalyticsQueries,
  CurrencyDay,
  CurrencyLifetime,
} from './admin-analytics.queries';
import { AdminAnalyticsService } from './admin-analytics.service';

// Sprint 6.4 / R17-D — unit spec for how the analytics service composes its
// read model. The SQL itself (event-dated completions, per-currency grouping)
// is proven against real PostgreSQL in
// test/integration/r17-admin-operations.integration.spec.ts.

function makePrisma(counts: Record<string, number> = {}): PrismaService {
  const c = {
    user: { count: jest.fn().mockResolvedValue(counts.users ?? 0) },
    providerProfile: { count: jest.fn().mockResolvedValue(counts.providers ?? 0) },
    serviceRequest: { count: jest.fn().mockResolvedValue(counts.requests ?? 0) },
    booking: { count: jest.fn().mockResolvedValue(0) },
    dispute: { count: jest.fn().mockResolvedValue(counts.disputesOpen ?? 0) },
  };
  return { client: c } as unknown as PrismaService;
}

function makeQueries(
  over: {
    lifetime?: CurrencyLifetime[];
    days?: CurrencyDay[];
    undated?: number;
    cancelled?: number;
  } = {},
): AdminAnalyticsQueries {
  return {
    lifetimeByCurrency: jest.fn().mockResolvedValue(over.lifetime ?? []),
    completionsByCurrencyDay: jest.fn().mockResolvedValue(over.days ?? []),
    undatedCompletions: jest.fn().mockResolvedValue(over.undated ?? 0),
    cancellationsWithin: jest.fn().mockResolvedValue(over.cancelled ?? 0),
  } as unknown as AdminAnalyticsQueries;
}

const service = (q = makeQueries(), p = makePrisma()) => new AdminAnalyticsService(p, q);

describe('AdminAnalyticsService.overview', () => {
  it('reports a single total only for a single currency, and never a fee', async () => {
    const q = makeQueries({
      lifetime: [{ currency: 'USD', bookedValue: 12_000, completed: 17 }],
      days: [{ currency: 'USD', day: '2026-04-02', bookedValue: 4_000, completed: 6 }],
      undated: 2,
      cancelled: 1,
    });
    const out = await service(q, makePrisma({ users: 100, providers: 9 })).overview(
      '2026-04-01',
      '2026-04-30',
    );
    expect(out.range).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(out.counts).toMatchObject({
      users: 100,
      providers: 9,
      bookingsCompleted: 6,
      bookingsCancelled: 1,
      undatedCompletions: 2,
    });
    expect(out.revenue).toEqual({
      grossWithinRange: 4_000,
      platformFeesWithinRange: null,
      netProviderEarningsWithinRange: null,
      grossLifetime: 12_000,
    });
    expect(out.currency).toBe('USD');
    expect(out.platformFeeRateBps).toBeNull();
    expect(out.feeStatus).toBe('NOT_APPROVED');
  });

  it('never adds two currencies together', async () => {
    const q = makeQueries({
      lifetime: [
        { currency: 'EUR', bookedValue: 500, completed: 1 },
        { currency: 'USD', bookedValue: 900, completed: 2 },
      ],
      days: [
        { currency: 'EUR', day: '2026-04-02', bookedValue: 500, completed: 1 },
        { currency: 'USD', day: '2026-04-03', bookedValue: 400, completed: 1 },
      ],
    });
    const out = await service(q).overview('2026-04-01', '2026-04-30');
    expect(out.revenue.grossWithinRange).toBeNull();
    expect(out.revenue.grossLifetime).toBeNull();
    expect(out.currency).toBeNull();
    expect(out.revenueByCurrency).toEqual([
      {
        currency: 'EUR',
        bookedValueLifetime: 500,
        completedLifetime: 1,
        bookedValueWithinRange: 500,
        completedWithinRange: 1,
      },
      {
        currency: 'USD',
        bookedValueLifetime: 900,
        completedLifetime: 2,
        bookedValueWithinRange: 400,
        completedWithinRange: 1,
      },
    ]);
  });

  it('defaults to the last 30 days when from/to missing', async () => {
    const out = await service().overview();
    const from = new Date(`${out.range.from}T00:00:00Z`).getTime();
    const to = new Date(`${out.range.to}T00:00:00Z`).getTime();
    expect(Math.round((to - from) / 86_400_000) + 1).toBe(30);
  });

  it('rejects ranges longer than 365 days', async () => {
    await expect(service().overview('2025-01-01', '2026-12-31')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects an inverted range (from >= to)', async () => {
    await expect(service().overview('2026-05-01', '2026-04-01')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects malformed and non-existent dates', async () => {
    for (const bad of ['2026/04/01', '2026-02-31', 'yesterday'])
      await expect(service().overview(bad, '2026-04-30')).rejects.toMatchObject({ status: 400 });
  });
});

describe('AdminAnalyticsService.revenue', () => {
  it('zero-fills one series per currency and leaves fees uncalculated', async () => {
    const q = makeQueries({
      days: [
        { currency: 'EUR', day: '2026-04-02', bookedValue: 500, completed: 1 },
        { currency: 'USD', day: '2026-04-02', bookedValue: 400, completed: 1 },
        { currency: 'USD', day: '2026-04-03', bookedValue: 100, completed: 1 },
      ],
    });
    const out = await service(q).revenue('2026-04-01', '2026-04-03');
    expect(out.series).toEqual([
      {
        currency: 'EUR',
        buckets: [
          { date: '2026-04-01', bookedValue: 0, completedBookings: 0 },
          { date: '2026-04-02', bookedValue: 500, completedBookings: 1 },
          { date: '2026-04-03', bookedValue: 0, completedBookings: 0 },
        ],
      },
      {
        currency: 'USD',
        buckets: [
          { date: '2026-04-01', bookedValue: 0, completedBookings: 0 },
          { date: '2026-04-02', bookedValue: 400, completedBookings: 1 },
          { date: '2026-04-03', bookedValue: 100, completedBookings: 1 },
        ],
      },
    ]);
    // Back-compat buckets: a figure only for a one-currency day.
    expect(out.buckets.map((b) => b.grossEarnings)).toEqual([0, null, 100]);
    expect(out.buckets.map((b) => b.completedBookings)).toEqual([0, 2, 1]);
    for (const b of out.buckets) {
      expect(b.platformFees).toBeNull();
      expect(b.netProviderEarnings).toBeNull();
    }
    expect(out.currency).toBeNull();
    expect(out.feeStatus).toBe('NOT_APPROVED');
  });

  it('inherits the same date validation as overview()', async () => {
    await expect(service().revenue('bad', '2026-04-30')).rejects.toMatchObject({ status: 400 });
  });
});

describe('AdminAnalyticsService.summary', () => {
  it('counts canonical workspace closures as resolved and separates currencies', async () => {
    const prisma = makePrisma();
    const q = makeQueries({
      lifetime: [
        { currency: 'EUR', bookedValue: 500, completed: 1 },
        { currency: 'USD', bookedValue: 900, completed: 2 },
      ],
      undated: 1,
    });
    const out = (await service(q, prisma).summary()).summary;
    expect(out.bookings.grossLifetimeAmount).toBeNull();
    expect(out.bookings.currency).toBeNull();
    expect(out.bookings.undatedCompletions).toBe(1);
    expect(out.bookings.bookedValueByCurrency.map((r) => r.currency)).toEqual(['EUR', 'USD']);
    const disputeCount = (prisma.client as unknown as { dispute: { count: jest.Mock } }).dispute
      .count;
    const resolvedQuery = disputeCount.mock.calls
      .map(([args]) => args as { where: { status: unknown } })
      .find((args) => typeof args.where.status === 'object');
    expect(resolvedQuery?.where.status).toEqual({
      in: ['RESOLVED', 'RESOLVED_REFUND', 'RESOLVED_PARTIAL', 'RESOLVED_DENIED'],
    });
  });
});
