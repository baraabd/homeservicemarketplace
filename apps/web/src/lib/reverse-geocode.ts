// Reverse geocoding utility — coordinates → human-readable address.
//
// Phase 2 Bug 3. Used by:
//   - apps/web/src/app/components/profile/SavedAddressesPage.tsx
//     ("Use my current location" → auto-fill the Full address input)
//   - apps/web/src/app/components/wizard/JobWizardModal.tsx
//     (Job-posting Location step → auto-fill the address field)
//
// Architecture:
//   - `reverseGeocode(lat, lng)` is the pure API call. Returns a
//     `ReverseGeocodeResult` discriminated union so callers can
//     distinguish "no API key" from "network failure" from "no
//     match" without inspecting message strings.
//   - `getCurrentLocationAddress()` is the high-level helper that
//     wraps `navigator.geolocation.getCurrentPosition` +
//     `reverseGeocode` and reports a single structured outcome.
//     This is the function both UI call sites use.
//
// Graceful fallbacks (per the sprint spec):
//   - Permission denied → `{ status: 'error', reason: 'denied' }`.
//   - API key missing  → `{ status: 'partial', address: '<lat,lng>' }`
//     so the UI can still show *something* useful for testing /
//     manual-entry recovery.
//   - Network / non-OK response → `{ status: 'partial', address: '<lat,lng>' }`
//     same UX as missing key (raw coords > nothing).
//   - Empty results array → `{ status: 'partial', address: '<lat,lng>' }`
//     the geocoder didn't recognise the point but the user still
//     gets coordinates to work from.
//
// We intentionally do NOT throw from this module. Every code path
// resolves to a typed result so the caller's UI branches are
// exhaustive at compile time.

const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export type GeoErrorReason = 'denied' | 'unsupported' | 'timeout' | 'failed';

export interface ReverseGeocodeOk {
  status: 'ok';
  formattedAddress: string;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

export interface ReverseGeocodePartial {
  status: 'partial';
  /** Best-effort fallback the UI can show in the address field —
   *  formatted lat/lng to 5 decimals (~1.1m precision). */
  formattedAddress: string;
  /** Why the lookup couldn't produce a real address. */
  reason: 'no_api_key' | 'network' | 'no_match';
  lat: number;
  lng: number;
}

export type ReverseGeocodeResult = ReverseGeocodeOk | ReverseGeocodePartial;

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Resolve the Google Maps API key at call time, not module-load time,
 *  so tests / preview builds can override `import.meta.env` without
 *  module-cache eviction games. */
function readApiKey(): string {
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

interface GoogleGeocodeResponse {
  status: string;
  results?: Array<{
    formatted_address: string;
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
  error_message?: string;
}

function pickComponent(
  components: GoogleGeocodeResponse['results'][number]['address_components'],
  type: string,
): string | null {
  if (!components) return null;
  const hit = components.find((c) => c.types.includes(type));
  return hit?.long_name ?? null;
}

/** Pure HTTP call. Never throws — every failure path returns a
 *  `partial` result with raw coords as the formatted fallback. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  const apiKey = readApiKey();
  if (!apiKey) {
    return {
      status: 'partial',
      formattedAddress: formatCoords(lat, lng),
      reason: 'no_api_key',
      lat,
      lng,
    };
  }

  const url = `${GOOGLE_GEOCODE_URL}?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    return {
      status: 'partial',
      formattedAddress: formatCoords(lat, lng),
      reason: 'network',
      lat,
      lng,
    };
  }

  if (!res.ok) {
    return {
      status: 'partial',
      formattedAddress: formatCoords(lat, lng),
      reason: 'network',
      lat,
      lng,
    };
  }

  let body: GoogleGeocodeResponse;
  try {
    body = (await res.json()) as GoogleGeocodeResponse;
  } catch {
    return {
      status: 'partial',
      formattedAddress: formatCoords(lat, lng),
      reason: 'network',
      lat,
      lng,
    };
  }

  // Google returns 200 with `status` carrying the real outcome
  // (`OK`, `ZERO_RESULTS`, `REQUEST_DENIED`, `OVER_QUERY_LIMIT`,
  // `INVALID_REQUEST`, `UNKNOWN_ERROR`). Anything other than `OK`
  // collapses to a partial fallback so the caller has one error path.
  if (body.status !== 'OK' || !body.results || body.results.length === 0) {
    return {
      status: 'partial',
      formattedAddress: formatCoords(lat, lng),
      reason: body.status === 'ZERO_RESULTS' ? 'no_match' : 'network',
      lat,
      lng,
    };
  }

  const top = body.results[0];
  const components = top.address_components;
  return {
    status: 'ok',
    formattedAddress: top.formatted_address,
    // Prefer locality → fall back to administrative_area_level_1 (state/province).
    city:
      pickComponent(components, 'locality') ??
      pickComponent(components, 'administrative_area_level_1'),
    country: pickComponent(components, 'country'),
    lat,
    lng,
  };
}

// ─── High-level "click my-location button" helper ────────────────────────

export type LocationOutcome =
  | {
      status: 'ok';
      formattedAddress: string;
      lat: number;
      lng: number;
      city: string | null;
      country: string | null;
    }
  | {
      status: 'partial';
      formattedAddress: string;
      lat: number;
      lng: number;
      reason: ReverseGeocodePartial['reason'];
    }
  | { status: 'error'; reason: GeoErrorReason };

export interface GetCurrentLocationOptions {
  /** Total upper bound for `getCurrentPosition`. Default 10 s. */
  timeoutMs?: number;
  /** Forwarded to the geocoding fetch so callers can cancel on unmount. */
  signal?: AbortSignal;
}

/** Wrap `navigator.geolocation.getCurrentPosition` + `reverseGeocode`
 *  in a single Promise that always resolves with a typed outcome.
 *  Never rejects — the UI branch on `outcome.status`. */
export async function getCurrentLocationAddress(
  opts: GetCurrentLocationOptions = {},
): Promise<LocationOutcome> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { status: 'error', reason: 'unsupported' };
  }
  const coords = await new Promise<{ lat: number; lng: number } | { reason: GeoErrorReason }>(
    (resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
          if (err.code === 1) resolve({ reason: 'denied' });
          else if (err.code === 3) resolve({ reason: 'timeout' });
          else resolve({ reason: 'failed' });
        },
        { enableHighAccuracy: false, timeout: opts.timeoutMs ?? 10_000, maximumAge: 60_000 },
      );
    },
  );

  if ('reason' in coords) return { status: 'error', reason: coords.reason };

  const geo = await reverseGeocode(coords.lat, coords.lng, opts.signal);
  if (geo.status === 'ok') {
    return {
      status: 'ok',
      formattedAddress: geo.formattedAddress,
      lat: geo.lat,
      lng: geo.lng,
      city: geo.city,
      country: geo.country,
    };
  }
  return {
    status: 'partial',
    formattedAddress: geo.formattedAddress,
    lat: geo.lat,
    lng: geo.lng,
    reason: geo.reason,
  };
}
