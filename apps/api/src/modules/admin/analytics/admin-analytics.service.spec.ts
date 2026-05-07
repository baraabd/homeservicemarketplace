import { AppConfigService } from '../../../config/app-config.service';
import type { BookingRepository } from '../../../infrastructure/persistence/bookings/booking.repository';
import type { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AdminAnalyticsService } from './admin-analytics.service';

// Sprint 6.4 — service spec for the analytics overview + revenue
// methods. The legacy summary() path is exercised end-to-end by the
// existing Postman folder (50 — Analytics) and the harness; this
// spec focuses on the new date-range methods + their fee math.

function makeConfig(feeBps = 1000): AppConfigService {
  return {
    get: (k: string) => (k === 'PROVIDER_PLATFORM_FEE_BPS' ? feeBps : undefined),
  } as unknown as AppConfigService;
}

function makePrisma(counts: Record<string, number> = {}): PrismaService {
  // Stub the few `c.<model>.count(...)` calls overview() makes. The
  // shared `dispute` count uses the as-unknown cast so the model
  // doesn't need to be on the Prisma type itself.
  const c = {
    user: { count: jest.fn().mockResolvedValue(counts.users ?? 0) },
    providerProfile: { count: jest.fn().mockResolvedValue(counts.providers ?? 0) },
    serviceRequest: { count: jest.fn().mockResolvedValue(counts.requests ?? 0) },
    dispute: { count: jest.fn().mockResolvedValue(counts.disputesOpen ?? 0) },
  };
  return { client: c } as unknown as PrismaService;
}

function makeBookings(
  over: {
    aggregate?: ReturnType<typeof makeAggregate>;
    chartRows?: Array<{ day: Date; gross: number; completedCount: number }>;
  } = {},
): BookingRepository {
  return {
    aggregateGrossRevenueForMarketplace: jest
      .fn()
      .mockResolvedValue(over.aggregate ?? makeAggregate({ dominantCurrency: 'USD' })),
    aggregateEarningsByDayForMarketplace: jest.fn().mockResolvedValue(over.chartRows ?? []),
  } as unknown as BookingRepository;
}

function makeAggregate(
  over: Partial<{
    grossLifetime: number;
    grossWithinRange: number;
    completedLifetime: number;
    completedWithinRange: number;
    cancelledWithinRange: number;
    pendingAmount: number;
    dominantCurrency: string | null;
  }> = {},
) {
  return {
    grossLifetime: 0,
    grossWithinRange: 0,
    completedLifetime: 0,
    completedWithinRange: 0,
    cancelledWithinRange: 0,
    pendingAmount: 0,
    dominantCurrency: null,
    ...over,
  };
}

describe('AdminAnalyticsService.overview', () => {
  it('rolls up counts + revenue + fees for a custom date range', async () => {
    const bookings = makeBookings({
      aggregate: makeAggregate({
        grossLifetime: 12_000,
        grossWithinRange: 4_000,
        completedLifetime: 17,
        completedWithinRange: 6,
        cancelledWithinRange: 1,
        dominantCurrency: 'USD',
      }),
    });
    const prisma = makePrisma({
      users: 100,
      providers: 25,
      requests: 50,
      disputesOpen: 2,
    });
    const svc = new AdminAnalyticsService(prisma, bookings, makeConfig(1000));
    const out = await svc.overview('2026-04-01', '2026-04-30');
    expect(out.range.from).toBe('2026-04-01');
    expect(out.range.to).toBe('2026-04-30');
    expect(out.counts).toEqual({
      users: 100,
      providers: 25,
      requests: 50,
      bookingsCompleted: 6,
      bookingsCancelled: 1,
      disputesOpen: 2,
    });
    expect(out.revenue.grossWithinRange).toBe(4_000);
    expect(out.revenue.platformFeesWithinRange).toBe(400); // 10%
    expect(out.revenue.netProviderEarningsWithinRange).toBe(3_600);
    expect(out.revenue.grossLifetime).toBe(12_000);
    expect(out.platformFeeRateBps).toBe(1000);
  });

  it('defaults to the last 30 days when from/to missing', async () => {
    const bookings = makeBookings();
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    await svc.overview();
    const args = (bookings.aggregateGrossRevenueForMarketplace as unknown as jest.Mock).mock
      .calls[0][0];
    const span = args.to.getTime() - args.from.getTime();
    expect(Math.round(span / (24 * 60 * 60 * 1000))).toBe(30);
  });

  it('rejects ranges longer than 365 days', async () => {
    const bookings = makeBookings();
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    await expect(svc.overview('2025-01-01', '2026-12-31')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects an inverted range (from >= to)', async () => {
    const bookings = makeBookings();
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    await expect(svc.overview('2026-04-30', '2026-04-01')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects malformed dates', async () => {
    const bookings = makeBookings();
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    await expect(svc.overview('not-a-date', '2026-04-30')).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('AdminAnalyticsService.revenue', () => {
  it('returns one bucket per UTC day, zero-filled', async () => {
    const bookings = makeBookings({
      aggregate: makeAggregate({ dominantCurrency: 'USD' }),
      chartRows: [],
    });
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    const out = await svc.revenue('2026-04-01', '2026-04-07'); // 7 days inclusive
    expect(out.buckets).toHaveLength(7);
    expect(out.buckets[0].date).toBe('2026-04-01');
    expect(out.buckets[6].date).toBe('2026-04-07');
    expect(out.buckets.every((b) => b.grossEarnings === 0)).toBe(true);
  });

  it('honours non-zero buckets and applies fee math per row', async () => {
    const bookings = makeBookings({
      aggregate: makeAggregate({ dominantCurrency: 'USD' }),
      chartRows: [
        {
          day: new Date('2026-04-03T00:00:00Z'),
          gross: 5_000,
          completedCount: 2,
        },
      ],
    });
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig(1000));
    const out = await svc.revenue('2026-04-01', '2026-04-07');
    const apr3 = out.buckets.find((b) => b.date === '2026-04-03')!;
    expect(apr3.grossEarnings).toBe(5_000);
    expect(apr3.platformFees).toBe(500);
    expect(apr3.netProviderEarnings).toBe(4_500);
    expect(apr3.completedBookings).toBe(2);
  });

  it('inherits the same date validation as overview()', async () => {
    const bookings = makeBookings();
    const svc = new AdminAnalyticsService(makePrisma(), bookings, makeConfig());
    await expect(svc.revenue('2025-01-01', '2026-12-31')).rejects.toMatchObject({
      status: 400,
    });
  });
});
