import type { ProviderProfile } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../config/app-config.service';
import type { BookingRepository } from '../../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ProviderEarningsService } from './provider-earnings.service';

// ProviderEarningsService unit tests (Sprint 5.6 refined). Pin:
//  - summary platform-fee math from PROVIDER_PLATFORM_FEE_BPS
//  - summary returns net = gross − platformFees
//  - cancelled bookings excluded (the repository aggregate already
//    filters status=COMPLETED; tests verify the wire shape doesn't
//    pull in cancelled state via some side channel)
//  - transactions endpoint is COMPLETED-only on the wire (no status
//    filter accepted)
//  - chart returns one bucket per day in range, zero-filled for empty
//    days, range '7d'/'30d'/'90d'
//  - foreign provider profile → 404 NOT_FOUND
//  - empty state → all zeros, currency falls back to USD

function makeProfile(over: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'pp-1',
    userId: 'user-provider-1',
    displayName: 'Ada L.',
    initials: 'AL',
    avatarUrl: null,
    ratingAvg: 4.8,
    reviewCount: 12,
    completedJobs: 12,
    verified: true,
    topPro: false,
    bio: null,
    headline: null,
    phoneNumber: null,
    serviceAreaCity: null,
    serviceAreaCountry: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    availability: 'ONLINE',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...over,
  } as ProviderProfile;
}

function makeConfig(feeBps = 1000): AppConfigService {
  return {
    get: (k: string) => (k === 'PROVIDER_PLATFORM_FEE_BPS' ? feeBps : undefined),
  } as unknown as AppConfigService;
}

interface Mocks {
  providers: ProviderProfileRepository;
  bookings: BookingRepository;
}

function makeMocks(
  over: {
    profile?: ProviderProfile | null;
    aggregate?: {
      totalGross: number;
      currentMonthGross: number;
      pendingAmount: number;
      completedJobsCount: number;
      dominantCurrency: string | null;
    };
    listRows?: unknown[];
    chartRows?: Array<{ day: Date; gross: number; completedCount: number }>;
  } = {},
): Mocks {
  const profile = over.profile === undefined ? makeProfile() : over.profile;
  return {
    providers: {
      findByUserId: jest.fn().mockResolvedValue(profile),
    } as unknown as ProviderProfileRepository,
    bookings: {
      aggregateEarningsForProvider: jest.fn().mockResolvedValue(
        over.aggregate ?? {
          totalGross: 0,
          currentMonthGross: 0,
          pendingAmount: 0,
          completedJobsCount: 0,
          dominantCurrency: null,
        },
      ),
      listForProvider: jest.fn().mockResolvedValue(over.listRows ?? []),
      aggregateEarningsByDayForProvider: jest.fn().mockResolvedValue(over.chartRows ?? []),
    } as unknown as BookingRepository,
  };
}

function makeService(m: Mocks, feeBps = 1000): ProviderEarningsService {
  return new ProviderEarningsService(m.providers, m.bookings, makeConfig(feeBps));
}

describe('ProviderEarningsService.summary', () => {
  it('returns gross/platformFees/net/available/pending and reconciles', async () => {
    const mocks = makeMocks({
      aggregate: {
        totalGross: 12_000,
        currentMonthGross: 4_500,
        pendingAmount: 800,
        completedJobsCount: 17,
        dominantCurrency: 'USD',
      },
      profile: makeProfile({ ratingAvg: 4.7, reviewCount: 23 }),
    });
    const out = await makeService(mocks, 1000).summary('user-provider-1');
    // 10% fee on 12_000 = 1200; net = 10_800
    expect(out).toEqual({
      grossEarnings: 12_000,
      platformFees: 1200,
      netEarnings: 10_800,
      availableBalance: 10_800,
      pendingBalance: 800,
      completedBookingsCount: 17,
      currency: 'USD',
      platformFeeRateBps: 1000,
      ratingAvg: 4.7,
      reviewCount: 23,
    });
  });

  it('handles a zero fee rate (0 bps → no platform take)', async () => {
    const mocks = makeMocks({
      aggregate: {
        totalGross: 5_000,
        currentMonthGross: 0,
        pendingAmount: 0,
        completedJobsCount: 1,
        dominantCurrency: 'USD',
      },
    });
    const out = await makeService(mocks, 0).summary('user-provider-1');
    expect(out.platformFees).toBe(0);
    expect(out.netEarnings).toBe(5_000);
    expect(out.availableBalance).toBe(5_000);
    expect(out.platformFeeRateBps).toBe(0);
  });

  it('rounds the platform fee to the nearest currency unit', async () => {
    const mocks = makeMocks({
      aggregate: {
        totalGross: 1233, // 1233 * 1000 / 10000 = 123.3 → rounds to 123
        currentMonthGross: 0,
        pendingAmount: 0,
        completedJobsCount: 1,
        dominantCurrency: 'USD',
      },
    });
    const out = await makeService(mocks, 1000).summary('user-provider-1');
    expect(out.platformFees).toBe(123);
    expect(out.netEarnings).toBe(1233 - 123);
  });

  it('returns all-zeros + USD fallback for an empty earnings state', async () => {
    const mocks = makeMocks({
      aggregate: {
        totalGross: 0,
        currentMonthGross: 0,
        pendingAmount: 0,
        completedJobsCount: 0,
        dominantCurrency: null,
      },
    });
    const out = await makeService(mocks).summary('user-provider-1');
    expect(out.grossEarnings).toBe(0);
    expect(out.platformFees).toBe(0);
    expect(out.netEarnings).toBe(0);
    expect(out.availableBalance).toBe(0);
    expect(out.pendingBalance).toBe(0);
    expect(out.completedBookingsCount).toBe(0);
    expect(out.currency).toBe('USD');
  });

  it('returns 404 when the provider profile is missing', async () => {
    const mocks = makeMocks({ profile: null });
    await expect(makeService(mocks).summary('user-provider-1')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('queries the aggregate with a UTC start-of-month timestamp', async () => {
    const mocks = makeMocks();
    await makeService(mocks).summary('user-provider-1');
    const callArgs = (mocks.bookings.aggregateEarningsForProvider as jest.Mock).mock.calls[0];
    const monthStart = callArgs[1] as Date;
    expect(monthStart.getUTCDate()).toBe(1);
    expect(monthStart.getUTCHours()).toBe(0);
    expect(monthStart.getUTCMinutes()).toBe(0);
  });
});

describe('ProviderEarningsService.transactions', () => {
  function makeRow(over: Record<string, unknown> = {}) {
    const date = new Date('2026-05-02T10:00:00Z');
    return {
      id: 'bk-1',
      requestId: 'req-1',
      bidId: 'bid-1',
      seekerUserId: 'user-seeker-1',
      providerId: 'pp-1',
      status: 'COMPLETED',
      scheduledAt: date,
      priceAmount: 4500,
      currency: 'USD',
      createdAt: date,
      updatedAt: date,
      deletedAt: null,
      ...over,
      request: {
        id: 'req-1',
        seekerUserId: 'user-seeker-1',
        categoryId: 'cat-plumbing',
        customServiceText: null,
        description: 'Pipe leak',
        addressSnapshot: { city: 'Riyadh', country: 'SA', line1: 'private' },
        category: {
          id: 'cat-plumbing',
          slug: 'plumbing',
          labelEn: 'Plumbing',
          labelAr: 'سباكة',
        },
      },
      bid: {
        id: 'bid-1',
        amount: 4500,
        currency: 'USD',
        pricingType: 'HOURLY',
        note: null,
      },
      provider: makeProfile(),
      seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
    };
  }

  it('forces status=COMPLETED on the wire — cancelled and in-flight rows are excluded by definition', async () => {
    const row = makeRow();
    const mocks = makeMocks({ listRows: [row] });
    await makeService(mocks).transactions('user-provider-1', {});
    expect(mocks.bookings.listForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED', providerId: 'pp-1' }),
    );
  });

  it('projects to the canonical EarningsTransaction shape with platformFee + netAmount', async () => {
    const row = makeRow();
    const mocks = makeMocks({ listRows: [row] });
    const out = await makeService(mocks, 1000).transactions('user-provider-1', {});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      id: 'bk-1',
      bookingId: 'bk-1',
      kind: 'BOOKING_COMPLETED',
      amount: 4500,
      platformFee: 450, // 4500 * 10% = 450
      netAmount: 4050,
      currency: 'USD',
      city: 'Riyadh',
      service: { categorySlug: 'plumbing' },
    });
    // line1 of the address snapshot must NOT leak through.
    expect(JSON.stringify(out)).not.toContain('private');
  });

  it('emits nextCursor when the page overflows', async () => {
    const rows = ['a', 'b', 'c'].map((id) => makeRow({ id }));
    const mocks = makeMocks({ listRows: rows });
    const out = await makeService(mocks).transactions('user-provider-1', { limit: 2 });
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });

  it('forwards the cursor on the wire so callers can paginate', async () => {
    const mocks = makeMocks({ listRows: [] });
    await makeService(mocks).transactions('user-provider-1', { cursor: 'opaque-1' });
    expect(mocks.bookings.listForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'opaque-1' }),
    );
  });

  it('returns 404 when the provider profile is missing', async () => {
    const mocks = makeMocks({ profile: null });
    await expect(makeService(mocks).transactions('user-provider-1', {})).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});

describe('ProviderEarningsService.chart', () => {
  it('returns one bucket per day for range=7d, zero-filled when no data', async () => {
    const mocks = makeMocks();
    const out = await makeService(mocks).chart('user-provider-1', '7d');
    expect(out.range).toBe('7d');
    expect(out.buckets).toHaveLength(7);
    expect(out.buckets.every((b) => b.grossEarnings === 0 && b.completedBookings === 0)).toBe(true);
    // Buckets sort chronologically by ISO 'YYYY-MM-DD' string.
    const sorted = [...out.buckets].map((b) => b.date).sort();
    expect(out.buckets.map((b) => b.date)).toEqual(sorted);
  });

  it('returns 30 buckets for the default range', async () => {
    const mocks = makeMocks();
    const out = await makeService(mocks).chart('user-provider-1', '30d');
    expect(out.buckets).toHaveLength(30);
  });

  it('returns 90 buckets for range=90d', async () => {
    const mocks = makeMocks();
    const out = await makeService(mocks).chart('user-provider-1', '90d');
    expect(out.buckets).toHaveLength(90);
  });

  it('zero-fills empty days while honouring the days that have data', async () => {
    // Pick a day in the recent window.
    const today = new Date();
    const todayUtc = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    const mocks = makeMocks({
      chartRows: [{ day: todayUtc, gross: 5000, completedCount: 2 }],
    });
    const out = await makeService(mocks, 1000).chart('user-provider-1', '7d');
    expect(out.buckets).toHaveLength(7);
    const todayIso = todayUtc.toISOString().slice(0, 10);
    const todayBucket = out.buckets.find((b) => b.date === todayIso);
    expect(todayBucket).toBeDefined();
    expect(todayBucket).toMatchObject({
      grossEarnings: 5000,
      platformFees: 500,
      netEarnings: 4500,
      completedBookings: 2,
    });
    // Other days zero-filled.
    const others = out.buckets.filter((b) => b.date !== todayIso);
    expect(others.every((b) => b.grossEarnings === 0 && b.completedBookings === 0)).toBe(true);
  });

  it('queries the repository with a [windowStart, windowEnd) day-aligned range', async () => {
    const mocks = makeMocks();
    await makeService(mocks).chart('user-provider-1', '30d');
    const args = (mocks.bookings.aggregateEarningsByDayForProvider as jest.Mock).mock.calls[0];
    const start = args[1] as Date;
    const end = args[2] as Date;
    // Day-aligned UTC midnight on both ends.
    expect(start.getUTCHours()).toBe(0);
    expect(start.getUTCMinutes()).toBe(0);
    expect(end.getUTCHours()).toBe(0);
    expect(end.getUTCMinutes()).toBe(0);
    // 30-day window: end - start = 30 * 86_400_000 ms.
    expect(end.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('returns 404 when the provider profile is missing', async () => {
    const mocks = makeMocks({ profile: null });
    await expect(makeService(mocks).chart('user-provider-1', '30d')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
