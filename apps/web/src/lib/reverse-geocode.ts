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
  /** Best-effort city extraction. Empty string when the geocoder
   *  returned a formatted address but none of the known city-typed
   *  components matched (rare, but possible for remote points). */
  city: string;
  country: string;
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
  /** Empty when the lookup failed before parsing. Kept on the type so
   *  the consumer's branches stay symmetric with the OK shape. */
  city: '';
  country: '';
  lat: number;
  lng: number;
}

export type ReverseGeocodeResult = ReverseGeocodeOk | ReverseGeocodePartial;

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function partial(
  lat: number,
  lng: number,
  reason: ReverseGeocodePartial['reason'],
): ReverseGeocodePartial {
  return {
    status: 'partial',
    formattedAddress: formatCoords(lat, lng),
    reason,
    city: '',
    country: '',
    lat,
    lng,
  };
}

/** Resolve the Google Maps API key at call time, not module-load time,
 *  so tests / preview builds can override `import.meta.env` without
 *  module-cache eviction games. */
function readApiKey(): string {
  const k = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return typeof k === 'string' ? k.trim() : '';
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResult {
  formatted_address: string;
  address_components?: GoogleAddressComponent[];
}

interface GoogleGeocodeResponse {
  status: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
}

/** Preference order when extracting a "city" string. The geocoder
 *  populates different types depending on the country / region:
 *
 *    - locality                       — most cities globally (e.g. "Riyadh", "Aleppo")
 *    - postal_town                    — UK cities ("Edinburgh") that aren't admin localities
 *    - sublocality_level_1            — large city districts (parts of Tokyo, NYC boroughs)
 *    - administrative_area_level_2    — county-level (some EU regions)
 *    - administrative_area_level_1    — state/province fallback so a remote point still
 *                                       resolves to *something* useful for filtering
 */
const CITY_TYPE_PREFERENCE: readonly string[] = [
  'locality',
  'postal_town',
  'sublocality_level_1',
  'administrative_area_level_2',
  'administrative_area_level_1',
];

/** Search every result + every component for the requested type.
 *  Google often returns the most specific result first (a street
 *  address whose own components don't include `locality`); the
 *  surrounding city sits in a sibling result further down the
 *  array. Scanning all results plugs that gap. */
function pickAcrossResults(results: GoogleGeocodeResult[], type: string): string | null {
  for (const r of results) {
    const hit = r.address_components?.find((c) => c.types.includes(type));
    if (hit) return hit.long_name;
  }
  return null;
}

function extractCity(results: GoogleGeocodeResult[]): string {
  for (const t of CITY_TYPE_PREFERENCE) {
    const v = pickAcrossResults(results, t);
    if (v) return v;
  }
  return '';
}

function extractCountry(results: GoogleGeocodeResult[]): string {
  return pickAcrossResults(results, 'country') ?? '';
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
    console.warn(
      '[reverse-geocode] VITE_GOOGLE_MAPS_API_KEY not configured — falling back to coordinates.',
    );
    return partial(lat, lng, 'no_api_key');
  }

  const url = `${GOOGLE_GEOCODE_URL}?latlng=${encodeURIComponent(`${lat},${lng}`)}&key=${encodeURIComponent(apiKey)}`;

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    console.warn('[reverse-geocode] fetch failed:', err);
    return partial(lat, lng, 'network');
  }

  if (!res.ok) {
    console.warn(`[reverse-geocode] HTTP ${res.status} from Google Geocoding API`);
    return partial(lat, lng, 'network');
  }

  let body: GoogleGeocodeResponse;
  try {
    body = (await res.json()) as GoogleGeocodeResponse;
  } catch (err) {
    console.warn('[reverse-geocode] response was not JSON:', err);
    return partial(lat, lng, 'network');
  }

  // Google returns 200 with `status` carrying the real outcome
  // (`OK`, `ZERO_RESULTS`, `REQUEST_DENIED`, `OVER_QUERY_LIMIT`,
  // `INVALID_REQUEST`, `UNKNOWN_ERROR`). Anything other than `OK`
  // collapses to a partial fallback so the caller has one error path.
  if (body.status !== 'OK' || !body.results || body.results.length === 0) {
    console.warn(
      `[reverse-geocode] Google status=${body.status}` +
        (body.error_message ? ` — ${body.error_message}` : ''),
    );
    return partial(lat, lng, body.status === 'ZERO_RESULTS' ? 'no_match' : 'network');
  }

  const results = body.results;
  const top = results[0];
  const city = extractCity(results);
  const country = extractCountry(results);
  if (!city) {
    // Genuinely useful telemetry — when the geocode resolves but no
    // city-typed component matches, the available-requests filter
    // will silently produce zero matches downstream. Surface it.
    console.warn(
      '[reverse-geocode] Geocoded result has no city-typed component:',
      top.formatted_address,
    );
  }
  return {
    status: 'ok',
    formattedAddress: top.formatted_address,
    city,
    country,
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
      /** Always a string on the OK branch — empty when the geocoder
       *  resolved a formatted address but no city-typed component
       *  matched. Downstream filters MUST gate on truthiness. */
      city: string;
      country: string;
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
