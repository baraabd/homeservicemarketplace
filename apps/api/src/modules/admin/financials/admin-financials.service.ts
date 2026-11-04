import { Injectable } from '@nestjs/common';
import type {
  AdminFinancialsBookingRow,
  AdminFinancialsProviderEarningsRow,
  AdminFinancialsSummary,
  ListAdminFinancialsBookingsQuery,
  ListAdminFinancialsBookingsResponse,
  ListAdminFinancialsProviderEarningsQuery,
  ListAdminFinancialsProviderEarningsResponse,
} from '@homeservicemarketplace/contracts';

import { summarizeBookedValue } from '../../../infrastructure/persistence/bookings/booked-value';
import {
  BookingRepository,
  type AdminFinancialBookingListRow,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';

const DEFAULT_PAGE_SIZE = 30;

// Admin financials — read-only BOOKED value of marketplace bookings (not
// collected money). K02: per currency, verified FIXED-price only,
// exclusions counted, no fee/net/refund totals (no fee is approved and no
// booking refund exists). Cancelled bookings are excluded.
@Injectable()
export class AdminFinancialsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly providers: ProviderProfileRepository,
  ) {}

  async summary(): Promise<AdminFinancialsSummary> {
    const value = summarizeBookedValue(
      await this.bookings.bookedValueGroups({ monthStart: startOfCurrentMonthUtc() }),
    );
    return {
      byCurrency: value.byCurrency,
      excluded: value.excluded,
      completedBookingsCount: value.completedCount,
      feeStatus: 'NOT_APPROVED',
      platformFeeRateBps: null,
      generatedAt: new Date().toISOString(),
    };
  }

  async listBookings(
    query: ListAdminFinancialsBookingsQuery,
  ): Promise<ListAdminFinancialsBookingsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.bookings.listCompletedBookingsForAdmin({
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: AdminFinancialsBookingRow[] = page.map(toBookingRow);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async listProviderEarnings(
    query: ListAdminFinancialsProviderEarningsQuery,
  ): Promise<ListAdminFinancialsProviderEarningsResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const skip = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
    const rows = await this.bookings.groupCompletedBookingsByProvider({
      take: take + 1,
      skip,
    });
    const page = rows.slice(0, take);
    // Hydrate display data for the providerIds we actually surface;
    // the groupBy itself returns only ids + sums.
    const profiles = await Promise.all(
      page.map((r) => this.providers.findByIdForAdmin(r.providerId)),
    );
    const items: AdminFinancialsProviderEarningsRow[] = page.map((r, i) => {
      const profile = profiles[i] ?? null;
      return {
        providerId: r.providerId,
        displayName: profile?.displayName ?? '—',
        userId: profile?.user?.id ?? null,
        email: profile?.user?.email ?? null,
        completedBookings: r.completedCount,
        grossEarnings: r.gross,
        currency: r.currency,
        amountScale: r.amountScale,
      };
    });
    const nextCursor = rows.length > take ? String(skip + take) : null;
    return { items, nextCursor };
  }
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function toBookingRow(row: AdminFinancialBookingListRow): AdminFinancialsBookingRow {
  const snapshot = row.request.addressSnapshot as { city?: string };
  return {
    id: row.id,
    bookingId: row.id,
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
    provider: {
      id: row.provider.id,
      displayName: row.provider.displayName,
      userId: row.provider.user?.id ?? null,
      email: row.provider.user?.email ?? null,
    },
    seeker: {
      id: row.seeker.id,
      firstName: row.seeker.firstName,
    },
  };
}
