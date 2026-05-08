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
import { getBoundingBox, haversineDistance } from '../../../shared/geo/geo';
import { normaliseCityKey } from '../../requests/requests.service';

const DEFAULT_PAGE_SIZE = 20;
// Sprint 7.x — fallback radius for providers whose
// `serviceAreaRadiusKm` column is null. 50 km is generous enough to
// cover any one city + its near suburbs (Riyadh's diameter is ~30 km,
// Aleppo's ~10 km) without spilling into the next metro area.
const DEFAULT_RADIUS_KM = 50;
// The bbox pre-filter over-includes corners (the bbox is the
// circumscribed square around the radius circle), so the Haversine
// post-filter rejects rows beyond the true radius. To keep pagination
// honest under heavy rejection rates we ask the repository for more
// candidates than the page size; 4× is the empirically defensible
// upper bound (the worst-case rejection ratio for a uniformly-
// distributed candidate set is 1 - π/4 ≈ 21%, so 4× is well over the
// expected discount).
const RADIUS_CANDIDATE_MULTIPLIER = 4;

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

    // Sprint 7.x (radius) — location filter resolved to one of:
    //   - bbox + post-Haversine: when the provider has lat/lng on
    //     their profile (auto-filled from the city centroid table on
    //     update — see provider.service.ts CITY_CENTROIDS).
    //   - cityKey equality: when the provider has a city but no
    //     coords yet (legacy rows that haven't been touched since the
    //     auto-geo migration).
    //   - empty page: when the provider has neither coords nor city.
    const location = this.resolveLocationFilter(profile, query);
    if (effectiveCategoryIds.length === 0 || location === null) {
      // Strict mode: empty profile filter set → empty page. We
      // early-return with a stable envelope so the client cache
      // doesn't see a global feed (which would leak unrelated jobs
      // into the provider's UI).
      return { items: [], nextCursor: null };
    }

    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    // Pull a generous candidate window when the bbox path is active:
    // the post-Haversine filter rejects bbox corners, so asking for
    // exactly `take + 1` rows can leave us short. With cityKey-only
    // there's no post-filter so the legacy +1 sizing is enough.
    const repoTake = location.kind === 'bbox' ? take * RADIUS_CANDIDATE_MULTIPLIER + 1 : take + 1;
    const rows = await this.requests.listAvailableForProvider({
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: effectiveCategoryIds,
      city: location.cityKey ?? undefined,
      bbox: location.kind === 'bbox' ? location.bbox : undefined,
      excludeBidsByProviderId: profile.id,
      take: repoTake,
      cursor: query.cursor,
    });
    // Haversine post-filter — clip the bbox corners. Rows that came
    // through the cityKey OR-arm have no lat/lng on the snapshot, so
    // we let those pass unconditionally; that's the design intent
    // (cityKey is the legacy fallback for un-geocoded data).
    const inRadius =
      location.kind === 'bbox'
        ? rows.filter((row) => isWithinRadius(row, location.center, location.radiusKm))
        : rows;
    const page = inRadius.slice(0, take);
    const requestIds = page.map((r) => r.id);
    const bidCountByRequest = await this.bids.countActiveByRequestIds(requestIds);
    const items = page.map((row) => toSummary(row, bidCountByRequest.get(row.id) ?? 0));
    const nextCursor = inRadius.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  // Resolve the provider's profile + (optional) `near` query override
  // into the location half of the filter. Returns:
  //   - null: provider has no coords AND no city → empty feed.
  //   - { kind: 'bbox', ... }: provider has coords (and optionally a
  //     city) → bbox + Haversine. cityKey is included on the OR-arm
  //     so requests without lat/lng still surface via the legacy
  //     equality match.
  //   - { kind: 'cityKey', ... }: provider has only a city → legacy
  //     cityKey equality alone.
  private resolveLocationFilter(
    profile: {
      serviceAreaCity: string | null;
      serviceAreaLat: number | null;
      serviceAreaLng: number | null;
      serviceAreaRadiusKm: number | null;
    },
    query: ProviderAvailableRequestsQuery,
  ): LocationFilter | null {
    const rawCity = (query.near ?? profile.serviceAreaCity ?? '').trim();
    const cityKey = rawCity ? normaliseCityKey(rawCity) : null;
    const hasCoords =
      profile.serviceAreaLat !== null &&
      profile.serviceAreaLng !== null &&
      Number.isFinite(profile.serviceAreaLat) &&
      Number.isFinite(profile.serviceAreaLng);

    if (hasCoords) {
      const radiusKm = profile.serviceAreaRadiusKm ?? DEFAULT_RADIUS_KM;
      const lat = profile.serviceAreaLat as number;
      const lng = profile.serviceAreaLng as number;
      return {
        kind: 'bbox',
        center: { lat, lng },
        radiusKm,
        bbox: getBoundingBox(lat, lng, radiusKm),
        cityKey,
      };
    }
    if (cityKey) {
      return { kind: 'cityKey', cityKey };
    }
    return null;
  }

  async detail(providerUserId: string, requestId: string): Promise<ProviderAvailableRequestDetail> {
    const profile = await this.providers.findByUserIdWithCategories(providerUserId);
    if (!profile) {
      throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    }
    const providerCategoryIds = profile.serviceCategories.map((link) => link.serviceCategoryId);
    // Sprint 7.x — STRICT detail visibility (mirrors list). A provider
    // who hasn't onboarded (no city / no coords AND no categories)
    // cannot fetch request details either, even by guessing the id.
    // The location resolution mirrors `list` exactly so a probing
    // provider can't fetch a row by id when the list filter would
    // have hidden it.
    const location = this.resolveLocationFilter(profile, {});
    if (providerCategoryIds.length === 0 || location === null) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const row = await this.requests.findAvailableForProvider(requestId, {
      excludeSeekerUserId: profile.userId ?? null,
      categoryIds: providerCategoryIds,
      city: location.cityKey ?? undefined,
      bbox: location.kind === 'bbox' ? location.bbox : undefined,
      excludeBidsByProviderId: profile.id,
    });
    if (!row) {
      // Foreign / deleted / cancelled / assigned / category-mismatch /
      // already-bid all collapse to 404 so a probing provider cannot
      // distinguish "not visible to me" from "doesn't exist".
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    // Apply the precise Haversine cut on the bbox path. Rows that
    // matched via cityKey alone (no lat/lng on the snapshot) are
    // accepted unconditionally — same contract as the list endpoint.
    if (location.kind === 'bbox' && !isWithinRadius(row, location.center, location.radiusKm)) {
      throw new AppError('NOT_FOUND', 'Request not found.', 404);
    }
    const bidCountByRequest = await this.bids.countActiveByRequestIds([row.id]);
    return toSummary(row, bidCountByRequest.get(row.id) ?? 0);
  }
}

// Internal location-filter ADT — the resolver returns one of these
// shapes so the list/detail call sites can branch on the exact mode
// without inspecting individual flags.
type LocationFilter =
  | {
      kind: 'bbox';
      center: { lat: number; lng: number };
      radiusKm: number;
      bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
      // Always the lowercase-trimmed cityKey when the provider has
      // configured a city alongside their coords. The repository
      // OR-s it against the bbox arm so geocoded providers still see
      // un-geocoded requests in their city.
      cityKey: string | null;
    }
  | { kind: 'cityKey'; cityKey: string };

// Haversine post-filter helper. Reads lat/lng out of the snapshot
// JSON (typed loosely because Prisma surfaces JSON columns as `unknown`
// at the application layer); rows missing either coordinate fall
// through unaccepted on the bbox path. Caller already knows the row
// passed the bbox pre-filter, so a missing coord here means the row
// matched the cityKey OR-arm — those are accepted unconditionally and
// must NOT call this helper.
function isWithinRadius(
  row: ServiceRequestWithCategory,
  center: { lat: number; lng: number },
  radiusKm: number,
): boolean {
  const snap = row.addressSnapshot as unknown as { lat?: number | null; lng?: number | null };
  if (
    typeof snap?.lat !== 'number' ||
    typeof snap?.lng !== 'number' ||
    !Number.isFinite(snap.lat) ||
    !Number.isFinite(snap.lng)
  ) {
    // Row matched the cityKey OR-arm. Let it through — that's the
    // legacy equality contract and the radius doesn't apply.
    return true;
  }
  return haversineDistance(center.lat, center.lng, snap.lat, snap.lng) <= radiusKm;
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
