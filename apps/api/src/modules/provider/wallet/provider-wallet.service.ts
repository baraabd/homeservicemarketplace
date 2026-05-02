import { Injectable } from '@nestjs/common';
import type {
  ListEarningsTransactionsQuery,
  ListEarningsTransactionsResponse,
  ProviderEarningsSummary,
  ProviderEarningsTransaction,
} from '@homeservicemarketplace/contracts';
import type { BookingStatus } from '@homeservicemarketplace/database';

import {
  BookingRepository,
  type BookingWithProviderRelations,
} from '../../../infrastructure/persistence/bookings/booking.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 30;
const DEFAULT_CURRENCY = 'USD';

// Provider earnings read model (Sprint 5 slice 5.6). Read-only — no
// payouts, no withdrawals, no balance reconciliation. The summary is
// computed at query time via Postgres SUM aggregates; the transactions
// list is a cursor-paginated projection of the BookingRepository.
@Injectable()
export class ProviderWalletService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly bookings: BookingRepository,
  ) {}

  async summary(providerUserId: string): Promise<ProviderEarningsSummary> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const monthStart = startOfCurrentMonthUtc();
    const agg = await this.bookings.aggregateEarningsForProvider(profile.id, monthStart);
    return {
      totalGross: agg.totalGross,
      currentMonthGross: agg.currentMonthGross,
      pendingAmount: agg.pendingAmount,
      completedJobsCount: agg.completedJobsCount,
      currency: agg.dominantCurrency ?? DEFAULT_CURRENCY,
      ratingAvg: profile.ratingAvg,
      reviewCount: profile.reviewCount,
    };
  }

  async transactions(
    providerUserId: string,
    query: ListEarningsTransactionsQuery,
  ): Promise<ListEarningsTransactionsResponse> {
    const profile = await this.providers.findByUserId(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    // Default to COMPLETED-only when no status filter is set — that's
    // the wallet-y mental model. Callers can pivot to scheduled /
    // in-progress via the status query param.
    const status: BookingStatus = (query.status ?? 'COMPLETED') as BookingStatus;
    const rows = await this.bookings.listForProvider({
      providerId: profile.id,
      status,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items: ProviderEarningsTransaction[] = page.map(toTransaction);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}

function toTransaction(row: BookingWithProviderRelations): ProviderEarningsTransaction {
  // For COMPLETED bookings, surface `updatedAt` as the "occurredAt"
  // — that's the moment the provider marked it complete (the booking
  // row never updates again unless it's deleted). For everything else,
  // fall back to createdAt, which is a sensible default for the
  // "scheduled" / "in flight" pipelines.
  const occurredAt = row.status === 'COMPLETED' ? row.updatedAt : row.createdAt;
  const snapshot = row.request.addressSnapshot as { city?: string };
  return {
    id: row.id,
    bookingId: row.id,
    status: row.status,
    amount: row.priceAmount,
    currency: row.currency,
    occurredAt: occurredAt.toISOString(),
    service: {
      categorySlug: row.request.category?.slug ?? null,
      categoryLabelEn: row.request.category?.labelEn ?? null,
      categoryLabelAr: row.request.category?.labelAr ?? null,
      customServiceText: row.request.customServiceText,
    },
    city: snapshot.city ?? '',
  };
}

function startOfCurrentMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
