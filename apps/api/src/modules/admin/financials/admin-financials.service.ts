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

import { AppConfigService } from '../../../config/app-config.service';
import {
  BookingRepository,
  type BookingWithAdminRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_CURRENCY = 'USD';
const BPS_DENOMINATOR = 10_000;

// Sprint 6.4 — admin financials service. Three read-only methods that
// roll up the marketplace's revenue using the same env-driven
// platform-fee math as the provider wallet (Sprint 5.6). Cancelled
// bookings are excluded from revenue; refunds aren't tracked yet so
// `totalRefunds` is constant 0.
@Injectable()
export class AdminFinancialsService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly providers: ProviderProfileRepository,
    private readonly config: AppConfigService,
  ) {}

  async summary(): Promise<AdminFinancialsSummary> {
    const feeBps = this.platformFeeBps();
    const agg = await this.bookings.aggregateGrossRevenueForMarketplace();
    const totalPlatformFees = applyFee(agg.grossLifetime, feeBps);
    return {
      totalRevenue: agg.grossLifetime,
      totalPlatformFees,
      totalProviderEarnings: agg.grossLifetime - totalPlatformFees,
      totalRefunds: 0,
      pendingBalance: agg.pendingAmount,
      completedBookingsCount: agg.completedLifetime,
      currency: agg.dominantCurrency ?? DEFAULT_CURRENCY,
      platformFeeRateBps: feeBps,
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
    const feeBps = this.platformFeeBps();
    const items: AdminFinancialsBookingRow[] = page.map((row) => toBookingRow(row, feeBps));
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
    const feeBps = this.platformFeeBps();
    const dominantCurrency = await this.bookings
      .aggregateGrossRevenueForMarketplace()
      .then((agg) => agg.dominantCurrency ?? DEFAULT_CURRENCY);
    const items: AdminFinancialsProviderEarningsRow[] = page.map((r, i) => {
      const profile = profiles[i] ?? null;
      const platformFees = applyFee(r.gross, feeBps);
      return {
        providerId: r.providerId,
        displayName: profile?.displayName ?? '—',
        userId: profile?.user?.id ?? null,
        email: profile?.user?.email ?? null,
        completedBookings: r.completedCount,
        grossEarnings: r.gross,
        platformFees,
        netEarnings: r.gross - platformFees,
        currency: dominantCurrency,
      };
    });
    const nextCursor = rows.length > take ? String(skip + take) : null;
    return { items, nextCursor };
  }

  private platformFeeBps(): number {
    return this.config.get('PROVIDER_PLATFORM_FEE_BPS');
  }
}

function applyFee(amount: number, feeBps: number): number {
  if (amount <= 0 || feeBps <= 0) return 0;
  return Math.round((amount * feeBps) / BPS_DENOMINATOR);
}

function toBookingRow(row: BookingWithAdminRelations, feeBps: number): AdminFinancialsBookingRow {
  const platformFee = applyFee(row.priceAmount, feeBps);
  const snapshot = row.request.addressSnapshot as { city?: string };
  return {
    id: row.id,
    bookingId: row.id,
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
