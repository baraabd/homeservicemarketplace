import type { ProviderProfile } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../../config/app-config.service';
import type {
  BookingRepository,
  BookingWithAdminRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { AdminFinancialsService } from './admin-financials.service';

function makeConfig(feeBps = 1000): AppConfigService {
  return {
    get: (k: string) => (k === 'PROVIDER_PLATFORM_FEE_BPS' ? feeBps : undefined),
  } as unknown as AppConfigService;
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

function makeBookingRow(over: Partial<BookingWithAdminRelations> = {}): BookingWithAdminRelations {
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
      categoryId: 'cat-plumbing',
      customServiceText: null,
      addressSnapshot: { city: 'Riyadh', country: 'SA', line1: 'private' },
      category: {
        id: 'cat-plumbing',
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
      },
    },
    bid: { id: 'bid-1', amount: 4500, currency: 'USD' },
    provider: {
      id: 'pp-1',
      displayName: 'Ada L.',
      user: { id: 'u-prov-1', email: 'p@example.com' },
    },
    seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
  } as unknown as BookingWithAdminRelations;
}

interface Mocks {
  bookings: BookingRepository;
  providers: ProviderProfileRepository;
}

function makeMocks(
  over: {
    aggregate?: ReturnType<typeof makeAggregate>;
    bookingRows?: BookingWithAdminRelations[];
    providerGroups?: Array<{ providerId: string; gross: number; completedCount: number }>;
    providerProfiles?: Array<ProviderProfile & { user: { id: string; email: string } | null }>;
  } = {},
): Mocks {
  return {
    bookings: {
      aggregateGrossRevenueForMarketplace: jest
        .fn()
        .mockResolvedValue(over.aggregate ?? makeAggregate({ dominantCurrency: 'USD' })),
      listCompletedBookingsForAdmin: jest.fn().mockResolvedValue(over.bookingRows ?? []),
      groupCompletedBookingsByProvider: jest.fn().mockResolvedValue(over.providerGroups ?? []),
    } as unknown as BookingRepository,
    providers: {
      findByIdForAdmin: jest.fn().mockImplementation((id: string) => {
        const found = (over.providerProfiles ?? []).find((p) => p.id === id);
        return Promise.resolve(found ?? null);
      }),
    } as unknown as ProviderProfileRepository,
  };
}

function makeService(m: Mocks, feeBps = 1000): AdminFinancialsService {
  return new AdminFinancialsService(m.bookings, m.providers, makeConfig(feeBps));
}

describe('AdminFinancialsService.summary', () => {
  it('rolls up gross / fees / net using PROVIDER_PLATFORM_FEE_BPS', async () => {
    const m = makeMocks({
      aggregate: makeAggregate({
        grossLifetime: 12_000,
        completedLifetime: 17,
        pendingAmount: 800,
        dominantCurrency: 'USD',
      }),
    });
    const out = await makeService(m, 1000).summary();
    expect(out.totalRevenue).toBe(12_000);
    expect(out.totalPlatformFees).toBe(1_200); // 10%
    expect(out.totalProviderEarnings).toBe(10_800);
    expect(out.completedBookingsCount).toBe(17);
    expect(out.pendingBalance).toBe(800);
    expect(out.totalRefunds).toBe(0);
    expect(out.platformFeeRateBps).toBe(1000);
  });

  it('returns USD fallback + zeros for an empty marketplace', async () => {
    const m = makeMocks({ aggregate: makeAggregate({ dominantCurrency: null }) });
    const out = await makeService(m).summary();
    expect(out.currency).toBe('USD');
    expect(out.totalRevenue).toBe(0);
    expect(out.totalPlatformFees).toBe(0);
    expect(out.totalProviderEarnings).toBe(0);
  });
});

describe('AdminFinancialsService.listBookings', () => {
  it('projects rows to the canonical financials shape with provider identity', async () => {
    const row = makeBookingRow();
    const m = makeMocks({ bookingRows: [row] });
    const out = await makeService(m, 1000).listBookings({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      bookingId: 'bk-1',
      amount: 4500,
      platformFee: 450,
      netAmount: 4050,
      provider: { id: 'pp-1', displayName: 'Ada L.', email: 'p@example.com' },
      seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
      city: 'Riyadh',
    });
    // line1 must NOT leak through.
    expect(JSON.stringify(out)).not.toContain('private');
  });

  it('emits nextCursor when the page overflows', async () => {
    const rows = ['a', 'b', 'c'].map((id) => makeBookingRow({ id }));
    const m = makeMocks({ bookingRows: rows });
    const out = await makeService(m).listBookings({ limit: 2 });
    expect(out.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.nextCursor).toBe('b');
  });
});

describe('AdminFinancialsService.listProviderEarnings', () => {
  it('hydrates display name + email from ProviderProfileRepository', async () => {
    const m = makeMocks({
      providerGroups: [{ providerId: 'pp-1', gross: 10_000, completedCount: 5 }],
      providerProfiles: [
        {
          id: 'pp-1',
          displayName: 'Ada L.',
          user: { id: 'u-prov-1', email: 'p@example.com' },
        } as unknown as ProviderProfile & { user: { id: string; email: string } | null },
      ],
      aggregate: makeAggregate({ dominantCurrency: 'USD' }),
    });
    const out = await makeService(m, 1000).listProviderEarnings({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      providerId: 'pp-1',
      displayName: 'Ada L.',
      email: 'p@example.com',
      grossEarnings: 10_000,
      platformFees: 1_000,
      netEarnings: 9_000,
      completedBookings: 5,
      currency: 'USD',
    });
  });

  it('falls back when the provider profile is missing (best-effort hydration)', async () => {
    const m = makeMocks({
      providerGroups: [{ providerId: 'pp-orphan', gross: 5_000, completedCount: 2 }],
      providerProfiles: [],
    });
    const out = await makeService(m).listProviderEarnings({});
    expect(out.items[0].displayName).toBe('—');
    expect(out.items[0].email).toBeNull();
  });

  it('forwards the cursor as a numeric skip offset', async () => {
    const m = makeMocks();
    await makeService(m).listProviderEarnings({ cursor: '50', limit: 25 });
    expect(m.bookings.groupCompletedBookingsByProvider).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 26 }),
    );
  });

  it('emits a numeric-string nextCursor when the page overflows', async () => {
    const m = makeMocks({
      providerGroups: ['pp-1', 'pp-2', 'pp-3'].map((id) => ({
        providerId: id,
        gross: 1000,
        completedCount: 1,
      })),
    });
    const out = await makeService(m).listProviderEarnings({ limit: 2 });
    expect(out.items.map((r) => r.providerId)).toEqual(['pp-1', 'pp-2']);
    expect(out.nextCursor).toBe('2');
  });
});
