// Sprint 6 — the SQL half of the service-area predicate.
//
// `service-area.ts` decides matches in memory; this file expresses the SAME
// rule as a Prisma `where` fragment. They are kept in one directory and tested
// against shared fixtures precisely because two implementations of one rule is
// the failure mode this sprint is fixing.
//
// Why a Prisma fragment rather than raw SQL: the surrounding query already
// carries category, status, soft-delete, cursor pagination, and an
// already-bid-on NOT EXISTS. Dropping to `$queryRaw` for the geo term would
// mean hand-writing all of that too — and re-hand-writing it on every future
// change to visibility rules. The bounding box is expressible as ordinary
// range filters, which is the part that must hit the index.
//
// The exact Haversine term is NOT expressible in Prisma's query builder. It is
// applied as a post-filter in the repository over the box-selected candidates,
// which is sound because the box is a strict superset of the circle: the SQL
// can only ever return too many rows, never too few. See
// `filterByExactRadius` below and its caller.

import type { Prisma } from '@homeservicemarketplace/database';

import {
  boundingBox,
  clampRadiusKm,
  haversineKm,
  usesRadiusMatching,
  type ServiceArea,
} from './service-area';

/** Prisma `where` fragment restricting ServiceRequest rows to a service area.
 *
 *  Returns `null` when the area constrains nothing (no radius, no city) — the
 *  caller must treat that as "no rows", NOT as "no filter". An empty filter
 *  here would turn a half-onboarded provider's feed into the global feed,
 *  which is the exact leak the strict-filter rules were added to close. */
export function serviceAreaWhere(area: ServiceArea): Prisma.ServiceRequestWhereInput | null {
  if (usesRadiusMatching(area)) {
    const box = boundingBox({ lat: area.lat!, lng: area.lng! }, area.radiusKm!);

    // Longitude ranges are OR-ed: an antimeridian-crossing box is two disjoint
    // windows, and collapsing them to one min/max would select the whole globe
    // except the intended sliver.
    const lngFilter: Prisma.ServiceRequestWhereInput[] = box.lngRanges.map((r) => ({
      locationLng: { gte: r.minLng, lte: r.maxLng },
    }));

    const withinBox: Prisma.ServiceRequestWhereInput = {
      locationLat: { gte: box.minLat, lte: box.maxLat },
      ...(box.wholeWorldLng ? {} : { OR: lngFilter }),
      // NOT NULL is implied by the range bounds, but stating it lets the
      // planner use the index without evaluating the range against nulls.
      NOT: { locationLat: null },
    };

    // A geocoded provider ALSO sees same-city requests that were never
    // geocoded — ADR 0003's "request has no coords" row. Without this arm,
    // turning on radius matching would silently hide every request whose
    // address failed to geocode, which is a seeker-visible outage caused by a
    // provider-side setting.
    const cityFallback: Prisma.ServiceRequestWhereInput | null = area.cityKey
      ? { locationLat: null, locationCityKey: area.cityKey }
      : null;

    return cityFallback ? { OR: [withinBox, cityFallback] } : withinBox;
  }

  // No usable centre or radius → today's behaviour, unchanged: city equality.
  if (area.cityKey) {
    return { locationCityKey: area.cityKey };
  }

  return null;
}

/** Drop the bounding box's corners.
 *
 *  The box is a square around a circle, so it over-selects by up to
 *  4/π − 1 ≈ 27% at the corners. This removes exactly those rows. Applying it
 *  in application code rather than SQL is safe in one direction only, and this
 *  is that direction: the SQL is a superset, so filtering here can only ever
 *  remove false positives.
 *
 *  Rows the provider matched by CITY fallback (no coordinates) are kept — they
 *  were never selected by distance and have no distance to check. */
export function filterByExactRadius<T>(
  area: ServiceArea,
  rows: T[],
  // Explicit projection rather than a structural constraint: database rows
  // carry the promoted column names (locationLat / locationLng), while the
  // pure predicate speaks in lat / lng. Passing the mapping in keeps the
  // geo module free of persistence naming.
  project: (row: T) => { lat: number | null; lng: number | null },
): T[] {
  if (!usesRadiusMatching(area)) return rows;
  const radius = clampRadiusKm(area.radiusKm!);
  return rows.filter((row) => {
    const distance = haversineKm({ lat: area.lat, lng: area.lng }, project(row));
    // Ungeocoded row → it came in through the city-fallback arm. Keep it.
    if (distance == null) return true;
    return distance <= radius;
  });
}

/** How much the box over-selects, as a multiplier on the circle's area.
 *
 *  Used by the repository to decide how far to over-fetch before the exact
 *  filter, so a page of N rows does not come back short after the corners are
 *  dropped. 4/π for a full square; 1 when the box degenerated to a latitude
 *  band, where the over-selection is unbounded and the caller should not rely
 *  on a fixed multiplier. */
export const BOX_OVERSELECT_FACTOR = 4 / Math.PI;
