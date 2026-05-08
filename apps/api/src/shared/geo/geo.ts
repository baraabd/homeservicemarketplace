// Lightweight geo helpers used by the provider available-requests filter.
//
// Sprint 7.x — replace the strict cityKey-equality match (which fails on
// "حلب" vs "محافظة حلب") with a radius-based match keyed on the
// provider's `serviceAreaLat/Lng/RadiusKm`. The repository pre-filters
// candidates with a bounding box (cheap + index-friendly when we
// eventually denormalise lat/lng), and the service post-filters with the
// exact Haversine distance to clip the bbox corners.
//
// The helpers are pure / synchronous / dependency-free so they can run
// in the request hot path without overhead and stay trivially unit-
// testable.

const EARTH_RADIUS_KM = 6371;
// 1 degree of latitude is ~111.045 km globally — flat-Earth-enough for
// bounding-box estimation (the precise value varies a few tenths of a
// percent with latitude, but the post-filter Haversine clips the
// inaccuracy out anyway).
const KM_PER_DEGREE_LAT = 111.045;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points in kilometres.
 *
 *  Uses the standard Haversine formula. Accurate to within a few metres
 *  for any pair of points on Earth — sufficient for "is this request
 *  inside the provider's service radius?" decisions where the radius is
 *  measured in tens of km. */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const sinDLatHalf = Math.sin(dLat / 2);
  const sinDLngHalf = Math.sin(dLng / 2);
  const a =
    sinDLatHalf * sinDLatHalf +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinDLngHalf * sinDLngHalf;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Latitude/longitude axis-aligned bounding box that comfortably
 *  contains every point within `radiusKm` of the centre.
 *
 *  Used as a cheap pre-filter against a JSON-path lookup on
 *  `addressSnapshot.lat/lng`. Corners of the bbox are slightly outside
 *  the true circle of `radiusKm` (the bbox is the circumscribed square),
 *  so the caller MUST follow up with the precise `haversineDistance`
 *  check on the returned candidates.
 *
 *  Latitude conversion is the constant 111.045 km/° for everywhere on
 *  Earth. Longitude conversion shrinks with `cos(lat)` — tighter at high
 *  latitudes. Near the poles `cos(lat)` collapses to ~0, so the helper
 *  clamps the longitude delta to ±180° to avoid producing a degenerate
 *  / wrap-around bbox. (No real seeker is going to post a job at the
 *  geographic pole, but the clamp keeps the helper safe by construction
 *  for any tests that supply edge coordinates.) */
export function getBoundingBox(lat: number, lng: number, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / KM_PER_DEGREE_LAT;
  const cosLat = Math.cos(toRadians(lat));
  // Avoid division by zero exactly at the poles. 1e-6 keeps the bbox
  // wide (effectively half the globe) without producing Infinity.
  const safeCosLat = Math.abs(cosLat) < 1e-6 ? 1e-6 : Math.abs(cosLat);
  const lngDeltaRaw = radiusKm / (KM_PER_DEGREE_LAT * safeCosLat);
  const lngDelta = Math.min(lngDeltaRaw, 180);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
