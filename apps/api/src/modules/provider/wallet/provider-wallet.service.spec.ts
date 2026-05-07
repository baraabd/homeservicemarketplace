import type { ProviderProfile } from '@homeservicemarketplace/database';

import type { BookingRepository } from '../../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ProviderWalletService } from './provider-wallet.service';

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
    } as unknown as BookingRepository,
  };
}

function makeService(m: Mocks): ProviderWalletService {
  return new ProviderWalletService(m.providers, m.bookings);
}

describe('ProviderWalletService.summary', () => {
  it('returns the four aggregate amounts plus rating + currency', async () => {
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
    const out = await makeService(mocks).summary('user-provider-1');
    expect(out).toEqual({
      totalGross: 12_000,
      currentMonthGross: 4_500,
      pendingAmount: 800,
      completedJobsCount: 17,
      currency: 'USD',
      ratingAvg: 4.7,
      reviewCount: 23,
    });
  });

  it('falls back to USD when no completed bookings exist', async () => {
    const mocks = makeMocks({
      aggregate: {
        totalGross: 0,
        currentMonthGross: 0,
        pendingAmount: 1500,
        completedJobsCount: 0,
        dominantCurrency: null,
      },
    });
    const out = await makeService(mocks).summary('user-provider-1');
    expect(out.currency).toBe('USD');
    expect(out.totalGross).toBe(0);
    expect(out.pendingAmount).toBe(1500);
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

describe('ProviderWalletService.transactions', () => {
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

  it('returns COMPLETED-only by default and projects to the transaction shape', async () => {
    const row = makeRow();
    const mocks = makeMocks({ listRows: [row] });
    const out = await makeService(mocks).transactions('user-provider-1', {});
    expect(mocks.bookings.listForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED', providerId: 'pp-1' }),
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      id: 'bk-1',
      bookingId: 'bk-1',
      status: 'COMPLETED',
      amount: 4500,
      currency: 'USD',
      city: 'Riyadh',
      service: { categorySlug: 'plumbing' },
    });
    // line1 must NOT leak through the wallet projection.
    expect(JSON.stringify(out)).not.toContain('private');
  });

  it('honours the explicit status filter', async () => {
    const mocks = makeMocks({ listRows: [] });
    await makeService(mocks).transactions('user-provider-1', { status: 'IN_PROGRESS' });
    expect(mocks.bookings.listForProvider).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'IN_PROGRESS' }),
    );
  });

  it('emits nextCursor when the page overflows', async () => {
    const rows = ['a', 'b', 'c'].map((id) => makeRow({ id }));
    const mocks = makeMocks({ listRows: rows });
    const out = await makeService(mocks).transactions('user-provider-1', { limit: 2 });
    expect(out.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });

  it('returns 404 when the provider profile is missing', async () => {
    const mocks = makeMocks({ profile: null });
    await expect(makeService(mocks).transactions('user-provider-1', {})).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
