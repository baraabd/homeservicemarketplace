import { Injectable } from '@nestjs/common';
import type {
  AddressSnapshot,
  AvailableJobSummary,
  ListAvailableJobsQuery,
  ListAvailableJobsResponse,
} from '@homeservicemarketplace/contracts';

import { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import {
  ServiceRequestRepository,
  type ServiceRequestWithCategory,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 20;

// Provider available-jobs feed (Sprint 5 slice 5.2).
//
// Filters applied (in this order):
//   1. status = OPEN_FOR_BIDS, deletedAt = null (always)
//   2. seekerUserId != provider.userId — never show a provider their
//      own request even if they happen to also be a seeker.
//   3. categoryId filter — explicit query.categoryId wins; otherwise
//      fall back to the provider's own configured `serviceCategories`
//      (a provider with no configured skills sees every open request).
//   4. city filter — when query.city is set, exact-match on the
//      snapshotted address city.
//
// The wire DTO is a NARROW projection of the underlying ServiceRequest
// row — see AvailableJobSummary for the rationale on which columns are
// deliberately hidden.
@Injectable()
export class ProviderJobsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly requests: ServiceRequestRepository,
    private readonly bids: BidRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async listAvailable(
    providerUserId: string,
    query: ListAvailableJobsQuery,
  ): Promise<ListAvailableJobsResponse> {
    // Re-load the provider to (a) confirm the row still exists — the
    // ProviderActiveGuard already proved status === ACTIVE — and (b)
    // pull the configured service categories for the implicit filter.
    const profile = await this.providers.findByUserIdWithCategories(providerUserId);
    if (!profile) {
      // Defensive: ProviderActiveGuard already ran and proved a profile
      // exists. A concurrent soft-delete is the only way to reach this
      // branch.
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }

    if (query.categoryId) {
      // Validate explicit category filter against the active catalog.
      // An unknown / inactive id surfaces as a 400 — never a Prisma
      // FK violation.
      const cat = await this.categories.findById(query.categoryId);
      if (!cat || !cat.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Selected category does not exist or is inactive.',
          400,
        );
      }
    }

    const explicitCategoryIds = query.categoryId ? [query.categoryId] : undefined;
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    const categoryIds = explicitCategoryIds ?? providerCategoryIds;

    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.requests.listAvailableForProvider({
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds,
      city: query.city,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const requestIds = page.map((r) => r.id);

    // Two parallel ID-batched queries to avoid N+1.
    const [bidCountByRequest, hasOwnBidSet] = await Promise.all([
      this.bids.countActiveByRequestIds(requestIds),
      this.bids.findRequestIdsBidByProvider(profile.id, requestIds),
    ]);

    const items = page.map((row) =>
      toSummary(row, {
        bidsCount: bidCountByRequest.get(row.id) ?? 0,
        hasOwnBid: hasOwnBidSet.has(row.id),
      }),
    );
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }
}

function toSummary(
  row: ServiceRequestWithCategory,
  opts: { bidsCount: number; hasOwnBid: boolean },
): AvailableJobSummary {
  // The snapshot column is JSON. Cast through `unknown` to the strict
  // contract type — the create path validates the shape on write so a
  // bad row would already have been rejected.
  const snapshot = row.addressSnapshot as unknown as AddressSnapshot;
  return {
    id: row.id,
    category: row.category
      ? {
          id: row.category.id,
          slug: row.category.slug,
          labelEn: row.category.labelEn,
          labelAr: row.category.labelAr,
        }
      : null,
    customServiceText: row.customServiceText,
    description: row.description,
    scheduleType: row.scheduleType,
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    location: {
      city: snapshot.city,
      country: snapshot.country,
      lat: snapshot.lat,
      lng: snapshot.lng,
    },
    bidsCount: opts.bidsCount,
    hasOwnBid: opts.hasOwnBid,
    createdAt: row.createdAt.toISOString(),
  };
}
