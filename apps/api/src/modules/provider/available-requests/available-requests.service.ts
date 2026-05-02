import { Injectable } from '@nestjs/common';
import type {
  ProviderAvailableRequestDetail,
  ProviderAvailableRequestListResponse,
  ProviderAvailableRequestSummary,
  ProviderAvailableRequestsQuery,
} from '@homeservicemarketplace/contracts';

import { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import {
  ServiceRequestRepository,
  type ServiceRequestWithCategory,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import { AppError } from '../../../shared/errors/app-error';

const DEFAULT_PAGE_SIZE = 20;

// Sprint 5.2 (canonical) — provider available-requests feed.
//
// Visibility rules applied (in this order):
//   1. status = OPEN_FOR_BIDS, deletedAt = null (always)
//   2. seekerUserId != provider.userId — providers don't see their own
//      requests in the feed.
//   3. categoryId — explicit `category` query wins, else falls back to
//      the provider's configured serviceCategories. A provider with no
//      categories sees the global feed.
//   4. city (when `near` is set) — exact-match against the snapshotted
//      addressSnapshot.city.
//   5. providers.findActiveBidForRequest = none — hide every request
//      this provider already bid on (non-WITHDRAWN). The strict
//      "hide-already-bid" semantics in this slice replace the older
//      `hasOwnBid` flag the legacy /me/provider/jobs surface emitted.
//
// The wire DTO is a NARROW projection — see `toSummary` for what's
// stripped (seekerUserId, line1, etc.).
@Injectable()
export class AvailableRequestsService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly requests: ServiceRequestRepository,
    private readonly bids: BidRepository,
    private readonly categories: ServiceCategoryRepository,
  ) {}

  async list(
    providerUserId: string,
    query: ProviderAvailableRequestsQuery,
  ): Promise<ProviderAvailableRequestListResponse> {
    const profile = await this.providers.findByUserIdWithCategories(providerUserId);
    if (!profile) {
      // ProviderActiveGuard already proved a profile exists; this
      // covers the concurrent soft-delete race only.
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }

    if (query.category) {
      const cat = await this.categories.findById(query.category);
      if (!cat || !cat.isActive) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Selected category does not exist or is inactive.',
          400,
        );
      }
    }

    const explicitCategoryIds = query.category ? [query.category] : undefined;
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    const categoryIds = explicitCategoryIds ?? providerCategoryIds;

    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.requests.listAvailableForProvider({
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds,
      city: query.near,
      excludeBidsByProviderId: profile.id,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const requestIds = page.map((r) => r.id);
    const bidCountByRequest = await this.bids.countActiveByRequestIds(requestIds);
    const items = page.map((row) => toSummary(row, bidCountByRequest.get(row.id) ?? 0));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(providerUserId: string, requestId: string): Promise<ProviderAvailableRequestDetail> {
    const profile = await this.providers.findByUserIdWithCategories(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    // Same visibility rules as the list. We DON'T enforce category
    // when the provider has none configured (matches list).
    const row = await this.requests.findAvailableForProvider(requestId, {
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: providerCategoryIds,
      excludeBidsByProviderId: profile.id,
    });
    if (!row) {
      // Foreign / deleted / cancelled / assigned / category-mismatch /
      // already-bid all collapse to 404 so a probing provider cannot
      // distinguish "not visible to me" from "doesn't exist".
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const bidCountByRequest = await this.bids.countActiveByRequestIds([row.id]);
    return toSummary(row, bidCountByRequest.get(row.id) ?? 0);
  }
}

function toSummary(
  row: ServiceRequestWithCategory,
  bidsCount: number,
): ProviderAvailableRequestSummary {
  const snapshot = row.addressSnapshot as unknown as {
    city: string;
    country: string;
    lat: number | null;
    lng: number | null;
  };
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
    bidsCount,
    createdAt: row.createdAt.toISOString(),
  };
}
