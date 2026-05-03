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
// Sprint 7.x — STRICT location + category match (was: optional).
//
// Visibility rules applied (in this order):
//   1. status = OPEN_FOR_BIDS, deletedAt = null (always)
//   2. seekerUserId != provider.userId — providers don't see their own
//      requests in the feed.
//   3. categoryId — explicit `category` query wins, else strict-filter
//      by the provider's configured serviceCategories. A provider with
//      NO categories configured sees an empty feed (was: global feed).
//      The provider must complete onboarding (skills) to receive jobs.
//   4. city — explicit `near` query wins, else strict-filter by the
//      provider's `serviceAreaCity`. A provider with no city configured
//      AND no `near` query sees an empty feed. Same onboarding intent
//      as categories: a provider must declare where they work.
//   5. providers.findActiveBidForRequest = none — hide every request
//      this provider already bid on (non-WITHDRAWN). The strict
//      "hide-already-bid" semantics in this slice replace the older
//      `hasOwnBid` flag the legacy /me/provider/jobs surface emitted.
//
// The wire DTO is a NARROW projection — see `toSummary` for what's
// stripped (seekerUserId, line1, etc.). Sprint 7.x adds `media[]` to
// the projection so the provider can see seeker-uploaded photos when
// deciding to bid.
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

    // Sprint 7.x — STRICT category + city filter. The provider must
    // either pass an explicit override (`category`, `near`) or have
    // the corresponding profile field set; otherwise the feed is empty.
    // This replaces the previous "fall back to global feed" behaviour
    // that surprised providers with mismatched jobs.
    const explicitCategoryIds = query.category ? [query.category] : null;
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    const effectiveCategoryIds = explicitCategoryIds ?? providerCategoryIds;
    const effectiveCity = (query.near ?? profile.serviceAreaCity ?? '').trim() || null;

    // Strict mode: empty profile filter set → empty page. We early-return
    // with a stable envelope so the client cache doesn't see a global
    // feed (which would leak unrelated jobs into the provider's UI).
    if (effectiveCategoryIds.length === 0 || !effectiveCity) {
      return { items: [], nextCursor: null };
    }

    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.requests.listAvailableForProvider({
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: effectiveCategoryIds,
      city: effectiveCity,
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
    const providerCity = profile.serviceAreaCity?.trim() || null;
    // Sprint 7.x — STRICT detail visibility (mirrors list). A provider
    // who hasn't onboarded (no city / no categories) cannot fetch
    // request details either, even by guessing the id.
    if (providerCategoryIds.length === 0 || !providerCity) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const row = await this.requests.findAvailableForProvider(requestId, {
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: providerCategoryIds,
      city: providerCity,
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
  // Sprint 7.x — `mediaUrls` is a Postgres text[] column with a default
  // of '{}', so it's always an array on the wire (never null). Defensive
  // `?? []` covers a hypothetical Prisma client returning undefined for
  // a row that was inserted via raw SQL bypassing the default.
  const media = (row as ServiceRequestWithCategory & { mediaUrls?: string[] }).mediaUrls ?? [];
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
    media,
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
