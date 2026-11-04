import type { ProviderProfile } from '@homeservicemarketplace/database';

import type { BookedValueGroupRow } from '../../../infrastructure/persistence/bookings/booked-value';
import type {
  BookingRepository,
  AdminFinancialBookingListRow,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import type { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { AdminFinancialsService } from './admin-financials.service';

// K02 (hsm.amount-unit.v1): booked value per currency, verified FIXED-price
// only, exclusions counted, no fee/net/refund totals.

function group(over: Partial<BookedValueGroupRow> = {}): BookedValueGroupRow {
  return {
    currency: 'SAR',
    amountScale: 2,
    pricingType: 'FIXED',
    completedCount: 0,
    completedValue: 0,
    currentMonthValue: 0,
    inFlightCount: 0,
    inFlightValue: 0,
    ...over,
  };
}

function makeBookingRow(
  over: Partial<AdminFinancialBookingListRow> = {},
): AdminFinancialBookingListRow {
  const date = new Date('2026-05-02T10:00:00Z');
  return {
    id: 'bk-1',
    priceAmount: 4500,
    currency: 'SAR',
    amountScale: 2,
    updatedAt: date,
    ...over,
    request: {
      customServiceText: null,
      addressSnapshot: { city: 'Riyadh', country: 'SA', line1: 'private' },
      category: {
        id: 'cat-plumbing',
        slug: 'plumbing',
        labelEn: 'Plumbing',
        labelAr: 'سباكة',
      },
    },
    bid: { pricingType: 'FIXED' },
    provider: {
      id: 'pp-1',
      displayName: 'Ada L.',
      user: { id: 'u-prov-1', email: 'p@example.com' },
    },
    seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
  };
}

interface Mocks {
  bookings: BookingRepository;
  providers: ProviderProfileRepository;
}

type ProviderGroup = {
  providerId: string;
  currency: string;
  amountScale: number;
  gross: number;
  completedCount: number;
};

function makeMocks(
  over: {
    groups?: BookedValueGroupRow[];
    bookingRows?: AdminFinancialBookingListRow[];
    providerGroups?: ProviderGroup[];
    providerProfiles?: Array<ProviderProfile & { user: { id: string; email: string } | null }>;
  } = {},
): Mocks {
  return {
    bookings: {
      bookedValueGroups: jest.fn().mockResolvedValue(over.groups ?? []),
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

function makeService(m: Mocks): AdminFinancialsService {
  return new AdminFinancialsService(m.bookings, m.providers);
}

describe('AdminFinancialsService.summary', () => {
  it('rolls up booked value per currency with no fee or net figure', async () => {
    const m = makeMocks({
      groups: [
        group({ completedCount: 17, completedValue: 12_000, inFlightCount: 1, inFlightValue: 800 }),
      ],
    });
    const out = await makeService(m).summary();
    expect(out.byCurrency).toEqual([
      expect.objectContaining({
        currency: 'SAR',
        amountScale: 2,
        completedValue: 12_000,
        completedCount: 17,
        inFlightValue: 800,
      }),
    ]);
    expect(out.completedBookingsCount).toBe(17);
    expect(out.feeStatus).toBe('NOT_APPROVED');
    expect(out.platformFeeRateBps).toBeNull();
    expect(out).not.toHaveProperty('totalPlatformFees');
    expect(out).not.toHaveProperty('totalProviderEarnings');
    expect(out).not.toHaveProperty('totalRefunds');
    // Marketplace-wide: no provider filter.
    expect((m.bookings.bookedValueGroups as jest.Mock).mock.calls[0][0].providerId).toBeUndefined();
  });

  it('never sums two currencies and reports legacy-unit rows as an exclusion, not as zero', async () => {
    const m = makeMocks({
      groups: [
        group({ completedCount: 1, completedValue: 10_025 }),
        group({ currency: 'USD', amountScale: null, completedCount: 4, completedValue: 1_000 }),
      ],
    });
    const out = await makeService(m).summary();
    expect(out.byCurrency.map((c) => c.currency)).toEqual(['SAR']);
    expect(out.byCurrency[0].completedValue).toBe(10_025);
    expect(out.excluded).toEqual([
      { currency: 'USD', reason: 'LEGACY_UNVERIFIED', completedCount: 4, inFlightCount: 0 },
    ]);
  });

  it('returns no currency entry (no USD fallback) for an empty marketplace', async () => {
    const out = await makeService(makeMocks()).summary();
    expect(out.byCurrency).toEqual([]);
    expect(out.excluded).toEqual([]);
    expect(out.completedBookingsCount).toBe(0);
  });
});

describe('AdminFinancialsService.listBookings', () => {
  it('projects rows to the canonical financials shape with provider identity', async () => {
    const row = makeBookingRow();
    const m = makeMocks({ bookingRows: [row] });
    const out = await makeService(m).listBookings({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({
      bookingId: 'bk-1',
      amount: 4500,
      currency: 'SAR',
      amountScale: 2,
      pricingType: 'FIXED',
      provider: { id: 'pp-1', displayName: 'Ada L.', email: 'p@example.com' },
      seeker: { id: 'user-seeker-1', firstName: 'Ahmed' },
      city: 'Riyadh',
    });
    expect(out.items[0]).not.toHaveProperty('platformFee');
    expect(out.items[0]).not.toHaveProperty('netAmount');
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

  it('preserves nullable category/user fields and a legacy row’s own unit in the narrow projection', async () => {
    const row = makeBookingRow({ priceAmount: 101, currency: 'USD', amountScale: null });
    row.request.category = null;
    row.request.customServiceText = 'Custom service';
    row.provider.user = null;
    const out = await makeService(makeMocks({ bookingRows: [row] })).listBookings({
      cursor: 'prior',
    });
    expect(out.items[0]).toMatchObject({
      amount: 101,
      currency: 'USD',
      amountScale: null,
      occurredAt: '2026-05-02T10:00:00.000Z',
      provider: { userId: null, email: null },
      service: {
        categorySlug: null,
        categoryLabelEn: null,
        categoryLabelAr: null,
        customServiceText: 'Custom service',
      },
    });
  });
});

describe('AdminFinancialsService.listProviderEarnings', () => {
  it('hydrates display name + email from ProviderProfileRepository, per currency', async () => {
    const m = makeMocks({
      providerGroups: [
        { providerId: 'pp-1', currency: 'SAR', amountScale: 2, gross: 10_000, completedCount: 5 },
      ],
      providerProfiles: [
        {
          id: 'pp-1',
          displayName: 'Ada L.',
          user: { id: 'u-prov-1', email: 'p@example.com' },
        } as unknown as ProviderProfile & { user: { id: string; email: string } | null },
      ],
    });
    const out = await makeService(m).listProviderEarnings({});
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual({
      providerId: 'pp-1',
      displayName: 'Ada L.',
      userId: 'u-prov-1',
      email: 'p@example.com',
      grossEarnings: 10_000,
      completedBookings: 5,
      currency: 'SAR',
      amountScale: 2,
    });
  });

  it('falls back when the provider profile is missing (best-effort hydration)', async () => {
    const m = makeMocks({
      providerGroups: [
        {
          providerId: 'pp-orphan',
          currency: 'SAR',
          amountScale: 2,
          gross: 5_000,
          completedCount: 2,
        },
      ],
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
        currency: 'SAR',
        amountScale: 2,
        gross: 1000,
        completedCount: 1,
      })),
    });
    const out = await makeService(m).listProviderEarnings({ limit: 2 });
    expect(out.items.map((r) => r.providerId)).toEqual(['pp-1', 'pp-2']);
    expect(out.nextCursor).toBe('2');
  });
});
