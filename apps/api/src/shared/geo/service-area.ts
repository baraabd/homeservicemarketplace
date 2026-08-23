// Sprint 6 — the service-area matching rule. ONE definition, three call sites.
//
// Before this module the rule was written out three times (feed list, feed
// detail, request fan-out) and all three implemented "same city string", while
// `ProviderProfile.serviceAreaRadiusKm` — required at onboarding — was never
// read by any of them. Three copies is how a column stays dead for a sprint
// without anyone noticing.
//
// Everything here is pure. No Prisma, no Nest, no I/O: the rule is decidable
// from four numbers and two strings, so it is testable without a database and
// the SQL builder and the in-memory checker cannot disagree about what a match
// is.
//
// See docs/adr/0003-service-area-geo-strategy.md for why bounded Haversine
// rather than PostGIS.

/** Mean Earth radius, km. The spherical approximation the ADR accepts. */
export const EARTH_RADIUS_KM = 6371;

/** Upper bound on a service-area radius, km.
 *
 *  Not a validation rule — the DTO enforces its own. This is a blast radius:
 *  a corrupt or hostile value must not turn the bounding box into "the whole
 *  planet" and silently degrade the feed into a table scan. */
export const MAX_SERVICE_AREA_RADIUS_KM = 500;

export interface Coordinates {
  lat: number;
  lng: number;
}

/** A provider's matching configuration, as far as geography is concerned. */
export interface ServiceArea {
  lat: number | null;
  lng: number | null;
  radiusKm: number | null;
  /** Normalised (btrim + lower) city key, or null when unset. */
  cityKey: string | null;
}

/** A request's location, as far as geography is concerned. */
export interface RequestLocation {
  lat: number | null;
  lng: number | null;
  cityKey: string | null;
}

/** Which rule decided a match — carried so callers can log and test the
 *  REASON, not merely the boolean. A silent fallback is indistinguishable
 *  from a working radius until someone complains their feed is wrong. */
export type MatchStrategy =
  | 'radius' // both ends geocoded: bounding box + Haversine
  | 'city-fallback' // at least one end lacks coordinates: city equality
  | 'unmatchable'; // the request has neither coordinates nor a city

export interface ServiceAreaMatch {
  matches: boolean;
  strategy: MatchStrategy;
  /** Great-circle distance, km, rounded to 0.1. Null unless both ends are
   *  geocoded — null means "unknown", never "zero". */
  distanceKm: number | null;
}

// ─── validation ────────────────────────────────────────────────────────────

/** True when the pair is a usable coordinate.
 *
 *  Rejects null, NaN, Infinity, and out-of-range values. NaN matters: every
 *  comparison against it is false, so an unchecked NaN latitude would make a
 *  request quietly unmatchable rather than loudly wrong. */
export function isValidCoordinate(lat: number | null, lng: number | null): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** True when the radius is a usable positive distance. Zero is NOT usable:
 *  "0 km" is how an unfinished onboarding looks, and treating it literally
 *  would match nothing at all. Such a provider falls back to city. */
export function isValidRadiusKm(radiusKm: number | null): boolean {
  return radiusKm != null && Number.isFinite(radiusKm) && radiusKm > 0;
}

/** Clamp a radius into the range the bounding box can serve. */
export function clampRadiusKm(radiusKm: number): number {
  return Math.min(Math.max(radiusKm, 0), MAX_SERVICE_AREA_RADIUS_KM);
}

/** The normalisation applied to every city string before comparison.
 *
 *  Must stay identical to the value written into `locationCityKey` and
 *  `serviceAreaCityKey`, and to the SQL backfill in the Sprint 6 migration
 *  (`btrim(lower(...))`). If these three ever diverge, city fallback silently
 *  stops matching. */
export function normaliseCityKey(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  return key.length > 0 ? key : null;
}

// ─── distance ──────────────────────────────────────────────────────────────

/** Great-circle distance in km between two points, rounded to 0.1 km.
 *
 *  Returns null when either end is not a valid coordinate — the wire must be
 *  able to say "unknown" distinctly from "zero". */
export function haversineKm(
  from: { lat: number | null; lng: number | null },
  to: { lat: number | null; lng: number | null },
): number | null {
  if (!isValidCoordinate(from.lat, from.lng) || !isValidCoordinate(to.lat, to.lng)) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat! - from.lat!);
  const dLng = toRad(to.lng! - from.lng!);
  const lat1 = toRad(from.lat!);
  const lat2 = toRad(to.lat!);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // atan2 rather than asin: numerically stable for antipodal points, where the
  // asin form loses precision as `a` approaches 1.
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

// ─── bounding box ──────────────────────────────────────────────────────────

/** A latitude/longitude window that fully contains the radius circle.
 *
 *  `lngRanges` is a LIST because a box crossing the antimeridian is two
 *  disjoint ranges in a coordinate system that wraps at ±180. Callers must
 *  OR them together; a single min/max would silently select the entire
 *  planet except the intended sliver. */
export interface BoundingBox {
  minLat: number;
  maxLat: number;
  lngRanges: Array<{ minLng: number; maxLng: number }>;
  /** True when the longitude bound had to be widened to the whole world —
   *  a near-polar circle, where "east" stops being meaningful. The latitude
   *  band still constrains it, and Haversine still does the real work. */
  wholeWorldLng: boolean;
}

/** The smallest lat/lng window guaranteed to contain every point within
 *  `radiusKm` of the centre.
 *
 *  Over-selects by design — the corners of the square lie outside the circle.
 *  It exists to give the query planner an indexable range; the exact Haversine
 *  term removes the corners. A box that under-selected would drop real
 *  matches, so every edge case below widens rather than narrows. */
export function boundingBox(centre: Coordinates, radiusKm: number): BoundingBox {
  const r = clampRadiusKm(radiusKm);
  const latDelta = (r / EARTH_RADIUS_KM) * (180 / Math.PI);

  const minLat = centre.lat - latDelta;
  const maxLat = centre.lat + latDelta;

  // Longitude degrees shrink with latitude, so the widening factor is taken at
  // whichever edge of the band is closest to a pole — that is where a degree
  // of longitude is shortest and the box must therefore be widest.
  const worstLat =
    Math.min(Math.abs(minLat), Math.abs(maxLat)) > 90 - 1e-9
      ? 90
      : Math.max(Math.abs(minLat), Math.abs(maxLat));
  const cosWorst = Math.cos((Math.min(worstLat, 90) * Math.PI) / 180);

  // The band reaches a pole, or cos() has collapsed toward zero: no finite
  // longitude window is correct, so take the whole range and let the latitude
  // band plus Haversine do the filtering.
  if (maxLat >= 90 || minLat <= -90 || cosWorst < 1e-9) {
    return {
      minLat: Math.max(minLat, -90),
      maxLat: Math.min(maxLat, 90),
      lngRanges: [{ minLng: -180, maxLng: 180 }],
      wholeWorldLng: true,
    };
  }

  const lngDelta = ((r / EARTH_RADIUS_KM) * (180 / Math.PI)) / cosWorst;
  if (lngDelta >= 180) {
    return {
      minLat,
      maxLat,
      lngRanges: [{ minLng: -180, maxLng: 180 }],
      wholeWorldLng: true,
    };
  }

  const rawMin = centre.lng - lngDelta;
  const rawMax = centre.lng + lngDelta;

  // Antimeridian split. A window from 179 to 181 is not expressible as one
  // range in [-180, 180]; it is [179, 180] OR [-180, -179].
  if (rawMin < -180) {
    return {
      minLat,
      maxLat,
      lngRanges: [
        { minLng: -180, maxLng: rawMax },
        { minLng: rawMin + 360, maxLng: 180 },
      ],
      wholeWorldLng: false,
    };
  }
  if (rawMax > 180) {
    return {
      minLat,
      maxLat,
      lngRanges: [
        { minLng: rawMin, maxLng: 180 },
        { minLng: -180, maxLng: rawMax - 360 },
      ],
      wholeWorldLng: false,
    };
  }

  return {
    minLat,
    maxLat,
    lngRanges: [{ minLng: rawMin, maxLng: rawMax }],
    wholeWorldLng: false,
  };
}

// ─── the predicate ─────────────────────────────────────────────────────────

/** Does this request fall inside this provider's service area?
 *
 *  The in-memory twin of the SQL the repository builds. Used directly by
 *  fan-out (which already holds both rows) and by the tests that pin the
 *  behaviour table in ADR 0003. Both must agree; `service-area.spec.ts`
 *  asserts they do against the same fixtures. */
export function matchServiceArea(area: ServiceArea, location: RequestLocation): ServiceAreaMatch {
  const distanceKm = haversineKm(
    { lat: area.lat, lng: area.lng },
    { lat: location.lat, lng: location.lng },
  );

  const providerGeocoded = isValidCoordinate(area.lat, area.lng) && isValidRadiusKm(area.radiusKm);
  const requestGeocoded = isValidCoordinate(location.lat, location.lng);

  // Both ends known → the radius is the rule, and city is irrelevant. A job
  // across a municipal boundary but 3 km away is a match; that is the whole
  // reason this sprint exists.
  if (providerGeocoded && requestGeocoded) {
    return {
      matches: distanceKm != null && distanceKm <= clampRadiusKm(area.radiusKm!),
      strategy: 'radius',
      distanceKm,
    };
  }

  // A request with neither coordinates nor a city cannot match anything. Its
  // own creation path logs this; surfacing it as a distinct strategy means a
  // caller can count them instead of quietly returning false.
  if (!requestGeocoded && !location.cityKey) {
    return { matches: false, strategy: 'unmatchable', distanceKm: null };
  }

  // City fallback. Reached when the provider has no centre/radius, or the
  // request was never geocoded. Resolves toward INCLUDING the job: a false
  // positive costs a glance, a false negative costs a bid nobody knew about.
  return {
    matches: area.cityKey != null && area.cityKey === location.cityKey,
    strategy: 'city-fallback',
    distanceKm,
  };
}

/** True when the provider is configured to use radius matching at all.
 *
 *  The repository calls this to choose between the bounding-box SQL and the
 *  plain city equality, so the SQL builder branches on exactly the same
 *  condition `matchServiceArea` does. */
export function usesRadiusMatching(area: ServiceArea): boolean {
  return isValidCoordinate(area.lat, area.lng) && isValidRadiusKm(area.radiusKm);
}
