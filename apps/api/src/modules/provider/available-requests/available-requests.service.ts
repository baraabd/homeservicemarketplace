import { Injectable } from '@nestjs/common';
import type {
  ProviderAvailableRequestBudget,
  ProviderAvailableRequestDetail,
  ProviderAvailableRequestListResponse,
  ProviderAvailableRequestSeekerPreview,
  ProviderAvailableRequestSummary,
  ProviderAvailableRequestsQuery,
} from '@homeservicemarketplace/contracts';

import { BidRepository } from '../../../infrastructure/persistence/bids/bid.repository';
import {
  ProviderProfileRepository,
  type ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import {
  ServiceRequestRepository,
  type ServiceRequestForProvider,
} from '../../../infrastructure/persistence/requests/service-request.repository';
import { ServiceCategoryRepository } from '../../../infrastructure/persistence/services/service-category.repository';
import { AppError } from '../../../shared/errors/app-error';
import { normaliseCityKey } from '../../requests/requests.service';

const DEFAULT_PAGE_SIZE = 20;

// Sprint 5.2 (canonical) — provider available-requests feed.
// Sprint 7.x — STRICT location + category match (was: optional).
// Sprint 7.4 — completed the privacy-safe summary projection
//   (distanceKm, budget, seekerPublicLabel, seekerRating).
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
// The wire DTO is a NARROW privacy projection — see `toSummary` for
// what is intentionally stripped (seekerUserId, line1, last name,
// email, phone). Sprint 7.4 added the seeker preview + budget + distance
// fields on top of the existing media/location surface; nothing in the
// new shape exposes the seeker's identifying information.
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
    // Case-insensitive city match: normalise the provider's city
    // (or the explicit `near` override) into the same lowercase
    // trimmed form the snapshot's `cityKey` carries. Without this
    // step, a provider profile typed as "Aleppo" would silently miss
    // requests geocoded as "aleppo" / "ALEPPO".
    const rawCity = (query.near ?? profile.serviceAreaCity ?? '').trim();
    const effectiveCity = rawCity ? normaliseCityKey(rawCity) : null;

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
    const items = page.map((row) => toSummary(row, bidCountByRequest.get(row.id) ?? 0, profile));
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(providerUserId: string, requestId: string): Promise<ProviderAvailableRequestDetail> {
    const profile = await this.providers.findByUserIdWithCategories(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    const providerCityRaw = profile.serviceAreaCity?.trim() || null;
    const providerCity = providerCityRaw ? normaliseCityKey(providerCityRaw) : null;
    // Sprint 7.x — STRICT detail visibility (mirrors list). A provider
    // who hasn't onboarded (no city / no categories) cannot fetch
    // request details either, even by guessing the id. The city
    // passed to the repo is the lowercase-trimmed key so a manual
    // "Aleppo" profile matches an "aleppo" or "ALEPPO" snapshot.
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
    return toSummary(row, bidCountByRequest.get(row.id) ?? 0, profile);
  }
}

function toSummary(
  row: ServiceRequestForProvider,
  bidsCount: number,
  provider: ProviderProfileWithCategories,
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
  const media = (row as ServiceRequestForProvider & { mediaUrls?: string[] }).mediaUrls ?? [];

  // Sprint 7.4 — privacy-safe seeker preview. NEVER exposes userId,
  // last name, email, phone, or avatar; matches the conversation
  // summary's seeker projection so the provider sees the same label
  // across both surfaces.
  const seeker = toSeekerPreview(row.seeker);

  // Sprint 7.4 — budget passthrough. No seeker-side budget input
  // exists today, so every field is `null`. The mapper signature is
  // shaped so a future migration adding `budgetAmountMin`/`Max`/
  // `Currency` columns to ServiceRequest can be threaded in with a
  // single-line change — no contract churn required.
  const budget = toBudget(row);

  // Sprint 7.4 — Haversine distance from the provider's service-area
  // centre to the request snapshot. Null when either end is missing
  // coordinates (legacy address, coarse-city-only profile). The
  // helper rounds to 0.1 km so the wire value is stable across
  // requests (the UI renders to one decimal place either way).
  const distanceKm = computeDistanceKm(
    provider.serviceAreaLat,
    provider.serviceAreaLng,
    snapshot.lat,
    snapshot.lng,
  );

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
    distanceKm,
    budget,
    seeker,
    bidsCount,
    createdAt: row.createdAt.toISOString(),
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

// First name + last initial. Identical to the conversation summary's
// seeker projection so a provider sees the same label across surfaces.
// "Customer" fallback when the User row has no usable name.
function toSeekerPreview(
  user: ServiceRequestForProvider['seeker'],
): ProviderAvailableRequestSeekerPreview {
  const first = (user.firstName ?? '').trim();
  const last = (user.lastName ?? '').trim();
  const lastInitial = last.length > 0 ? `${last[0].toUpperCase()}.` : '';
  const publicLabel = [first, lastInitial].filter(Boolean).join(' ') || 'Customer';
  return {
    publicLabel,
    // Reputation source not implemented yet — explicit null on the
    // wire so the UI doesn't render a fabricated zero.
    rating: null,
  };
}

// Budget passthrough. Today the ServiceRequest row has no budget
// columns, so we emit an all-null shape. The mapper kept on a row
// reference (rather than a hardcoded constant) so a future schema
// change adding the columns becomes a one-line read.
function toBudget(_row: ServiceRequestForProvider): ProviderAvailableRequestBudget {
  // Touch the row reference so a future `_row.budgetAmountMin` read
  // is a one-line diff. Today every branch returns nulls; the
  // pre-formatted `label` is left null so the client renders its
  // own locale-appropriate "Open budget" copy.
  return {
    amountMin: null,
    amountMax: null,
    currency: null,
    label: null,
  };
}

// Haversine distance in kilometres, rounded to one decimal place.
// Returns null when either end is missing a coordinate so the wire
// is unambiguous about "we don't know" vs "we know it's zero".
export function computeDistanceKm(
  fromLat: number | null,
  fromLng: number | null,
  toLat: number | null,
  toLng: number | null,
): number | null {
  if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
    return null;
  }
  // Guard against the obvious garbage. Out-of-range lat/lng → null
  // so a malformed snapshot can't poison the renderer with NaN.
  if (
    Math.abs(fromLat) > 90 ||
    Math.abs(toLat) > 90 ||
    Math.abs(fromLng) > 180 ||
    Math.abs(toLng) > 180
  ) {
    return null;
  }
  const R_KM = 6371; // Earth radius
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const lat1 = toRad(fromLat);
  const lat2 = toRad(toLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R_KM * c;
  // One decimal place: enough precision for a "1.2 km" / "12.4 km"
  // chip, stable enough that floating-point noise doesn't churn the
  // displayed value between renders.
  return Math.round(km * 10) / 10;
}
