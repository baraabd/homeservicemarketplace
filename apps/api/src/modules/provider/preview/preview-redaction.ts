import { createHmac } from 'node:crypto';

// Sprint 9B.9 — what a provider without work access is allowed to see.
//
// docs/sprint-09b9/REDACTED_MARKETPLACE_PREVIEW.md
//
// Pure, so every redaction can be asserted without a database, and total: the
// output type names every field that may ever leave this module. Anything not
// listed here cannot reach a preview client, whatever a caller passes in.
//
// THE THREAT THIS IS SHAPED AGAINST
//
// A preview user is unverified by definition. They may be a competitor
// harvesting the marketplace, or someone who wants to turn up at a stranger's
// address. So the question is never "is this field sensitive?" but "what can
// someone rebuild by collecting many of these?"
//
// That is why the location is SNAPPED to a fixed grid rather than jittered.
// Jitter looks more private and is strictly worse: random offsets around a
// true point average out, so an attacker who can re-request the same listing
// converges on the exact location. Snapping is deterministic — the same input
// always yields the same cell, so repeated sampling yields nothing new, and
// every point inside a cell is genuinely indistinguishable from every other.
//
// It is also why times and budgets are BANDED rather than exact. A precise
// createdAt is a near-unique key: a preview user who later gains real feed
// access could join their harvested set to the real one on it and de-anonymise
// every listing they ever saw. Bands are lossy on purpose.

/** Earth's radius, for the degrees-per-km conversion. */
const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_KM) / 180;

export interface PreviewPolicy {
  /** Grid size in km. Larger is more private. */
  cellKm: number;
  /** Items per page. */
  pageSize: number;
  /** Total items reachable through pagination, ever. */
  maxItems: number;
}

/** The row shape the preview query selects. Deliberately narrow: the columns
 *  that carry identity or free text are never read, so they cannot leak
 *  through a mapping bug. */
export interface PreviewSourceRow {
  id: string;
  categoryId: string | null;
  category: { slug: string; labelEn: string; labelAr: string } | null;
  scheduleType: string;
  locationCityKey: string | null;
  locationLat: number | null;
  locationLng: number | null;
  createdAt: Date;
}

export type PreviewFreshness = 'TODAY' | 'THIS_WEEK' | 'EARLIER';

export interface PreviewArea {
  /** Coarse city key. Never a line1, never a postcode. */
  cityKey: string | null;
  /** Centre of the grid cell the request falls in, or null when the request
   *  has no coordinates at all. NEVER the request's own coordinates. */
  cellLat: number | null;
  cellLng: number | null;
  /** The edge length of that cell, so a client can render honest uncertainty
   *  instead of drawing a pin. */
  cellKm: number;
}

/** THE ALLOWLIST. Every field a preview client can ever receive. */
export interface PreviewItem {
  /** Opaque, salt-derived, and NOT the request id. See previewRef. */
  ref: string;
  categorySlug: string | null;
  categoryLabelEn: string | null;
  categoryLabelAr: string | null;
  scheduleType: string;
  area: PreviewArea;
  freshness: PreviewFreshness;
}

/**
 * A stable pseudonym for a request, scoped to one viewer.
 *
 * NOT the request id, and not reversible without the salt. Two things follow,
 * and both are the point:
 *
 *   the same request looks the same to one provider across pages, so a client
 *   can de-duplicate and key a list;
 *
 *   two different providers see DIFFERENT refs for the same request, so
 *   colluding preview users cannot align their harvests, and neither can join
 *   a harvest to the real feed later.
 */
export function previewRef(requestId: string, viewerSalt: string): string {
  return createHmac('sha256', viewerSalt).update(requestId).digest('hex').slice(0, 16);
}

/**
 * Snap a coordinate to the centre of its grid cell.
 *
 * Deterministic by construction: floor to a cell index, then return that
 * cell's centre. No randomness, so re-sampling the same request reveals
 * nothing further, and every point within a cell maps to one identical output.
 *
 * The longitude cell widens with latitude so cells stay roughly `cellKm`
 * across on the ground rather than only in degrees — otherwise a cell near the
 * poles would be a fraction of its nominal width and leak far more precision
 * than the policy claims.
 */
export function snapToCell(lat: number, lng: number, cellKm: number): { lat: number; lng: number } {
  const latStep = cellKm / KM_PER_DEG_LAT;

  const latIndex = Math.floor(lat / latStep);
  const cellLat = (latIndex + 0.5) * latStep;

  // cos() of the CELL's latitude, not the point's: using the point's would
  // make the longitude step depend on where inside the cell the point sits,
  // which reintroduces the precision the snap exists to remove.
  const cosLat = Math.max(Math.cos((cellLat * Math.PI) / 180), 0.01);
  const lngStep = cellKm / (KM_PER_DEG_LAT * cosLat);

  const lngIndex = Math.floor(lng / lngStep);
  const cellLng = (lngIndex + 0.5) * lngStep;

  return { lat: round6(cellLat), lng: round6(cellLng) };
}

/** How recently a request was posted, in buckets.
 *
 *  Never the exact timestamp: a precise createdAt is close to a unique key,
 *  and would let a harvested preview set be joined to the real feed later. */
export function freshnessOf(createdAt: Date, now: Date): PreviewFreshness {
  const ageMs = now.getTime() - createdAt.getTime();
  if (ageMs < 86_400_000) return 'TODAY';
  if (ageMs < 7 * 86_400_000) return 'THIS_WEEK';
  return 'EARLIER';
}

/**
 * Project one request into the preview allowlist.
 *
 * Everything the source row does not carry is absent rather than nulled: the
 * function cannot emit a description, a media URL, a seeker, a bid count, an
 * exact coordinate, an exact timestamp or the real request id, because the
 * output type has nowhere to put them.
 */
export function redactForPreview(
  row: PreviewSourceRow,
  policy: PreviewPolicy,
  viewerSalt: string,
  now: Date,
): PreviewItem {
  const hasCoords = row.locationLat !== null && row.locationLng !== null;
  const cell = hasCoords
    ? snapToCell(row.locationLat as number, row.locationLng as number, policy.cellKm)
    : null;

  return {
    ref: previewRef(row.id, viewerSalt),
    categorySlug: row.category?.slug ?? null,
    categoryLabelEn: row.category?.labelEn ?? null,
    categoryLabelAr: row.category?.labelAr ?? null,
    scheduleType: row.scheduleType,
    area: {
      cityKey: row.locationCityKey,
      cellLat: cell?.lat ?? null,
      cellLng: cell?.lng ?? null,
      cellKm: policy.cellKm,
    },
    freshness: freshnessOf(row.createdAt, now),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
