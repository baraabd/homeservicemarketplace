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
import {
  haversineKm,
  normaliseCityKey,
  usesRadiusMatching,
  type ServiceArea,
} from '../../../shared/geo/service-area';

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
    const serviceArea = toServiceArea(profile, query.near ?? null);

    // Strict mode: an empty filter set → empty page, never a global feed.
    //
    // Sprint 6 — the second condition is now "the service area constrains
    // nothing", not "there is no city". A provider who set a map pin and a
    // radius but never typed a city name is fully onboarded for matching
    // purposes and must get results; under the old check they got an empty
    // feed forever with no indication why.
    if (effectiveCategoryIds.length === 0 || !constrainsAnything(serviceArea)) {
      return { items: [], nextCursor: null };
    }

    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const rows = await this.requests.listAvailableForProvider({
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: effectiveCategoryIds,
      serviceArea,
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
    // Sprint 6 — STRICT detail visibility, driven by the SAME service-area
    // value the list uses. Detail and list must agree exactly: a request the
    // feed hides but the detail endpoint serves is an access-control hole
    // reachable by guessing an id.
    //
    // No `near` override here — an explicit query parameter may widen what a
    // provider BROWSES, but it must not widen what they are authorised to
    // open.
    const serviceArea = toServiceArea(profile, null);
    if (providerCategoryIds.length === 0 || !constrainsAnything(serviceArea)) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const row = await this.requests.findAvailableForProvider(requestId, {
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: providerCategoryIds,
      serviceArea,
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

  // Sprint 6 — distance now comes from the SAME haversineKm the matching
  // predicate uses, over the SAME promoted columns the query filtered on.
  //
  // Previously this was a second, private copy of the formula reading the
  // snapshot JSON while the filter read something else entirely. A displayed
  // distance that disagrees with the radius that admitted the row is the most
  // confusing possible bug: the provider sees "31 km" on a job inside their
  // 25 km area and reasonably concludes the filter is broken.
  //
  // Falls back to the snapshot for rows written before the backfill.
  const row6 = row as ServiceRequestForProvider & {
    locationLat?: number | null;
    locationLng?: number | null;
  };
  const distanceKm = haversineKm(
    { lat: provider.serviceAreaLat, lng: provider.serviceAreaLng },
    { lat: row6.locationLat ?? snapshot.lat, lng: row6.locationLng ?? snapshot.lng },
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

// Sprint 6 — the private Haversine copy that used to live here is gone.
// Its formula is now shared/geo/service-area.ts:haversineKm, which is also
// what the matching predicate uses, so a displayed distance and the radius
// that admitted the row can no longer disagree.
//
// Re-exported under the old name so existing importers keep compiling.
export function computeDistanceKm(
  fromLat: number | null,
  fromLng: number | null,
  toLat: number | null,
  toLng: number | null,
): number | null {
  return haversineKm({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng });
}

// ─── service area ──────────────────────────────────────────────────────────

/** Provider profile → the geo predicate's view of it.
 *
 *  `near` is the caller's explicit city override. It replaces the profile's
 *  city for BROWSING only — the detail endpoint deliberately passes null, so
 *  a query parameter can never widen what a provider is allowed to open. */
export function toServiceArea(
  profile: {
    serviceAreaLat: number | null;
    serviceAreaLng: number | null;
    serviceAreaRadiusKm: number | null;
    serviceAreaCity: string | null;
    serviceAreaCityKey?: string | null;
  },
  near: string | null,
): ServiceArea {
  // Prefer the stored normalised key; fall back to normalising the display
  // value for rows written before the column existed and not yet re-saved.
  const cityKey = near
    ? normaliseCityKey(near)
    : (profile.serviceAreaCityKey ?? normaliseCityKey(profile.serviceAreaCity));

  return {
    lat: profile.serviceAreaLat,
    lng: profile.serviceAreaLng,
    radiusKm: profile.serviceAreaRadiusKm,
    cityKey,
  };
}

/** True when the area restricts the feed to something narrower than "all
 *  requests". A false here must produce an EMPTY feed, never an unfiltered
 *  one — see the strict-mode comment at the call site. */
export function constrainsAnything(area: ServiceArea): boolean {
  return usesRadiusMatching(area) || area.cityKey != null;
}
