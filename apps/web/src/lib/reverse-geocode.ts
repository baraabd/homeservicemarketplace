// Reverse geocoding utility — coordinates → human-readable address.
//
// Used by:
//   - apps/web/src/app/components/profile/SavedAddressesPage.tsx
//     ("Use my current location" → auto-fill the Full address input)
//   - apps/web/src/app/components/wizard/JobWizardModal.tsx
//     (Job-posting Location step → auto-fill the address field)
//
// CRITICAL bug fix: develop's reverseGeocode short-circuited to a
// `partial(no_api_key)` outcome whenever VITE_GOOGLE_MAPS_API_KEY was
// unset (the default in dev shells). The wizard then ran the
// `formattedAddress` ("36.20120, 37.16110") through `splitFullAddress`,
// which lifted the second-to-last comma chunk as the city — so the
// backend cityKey ended up `"37.16271"` and the provider feed never
// matched. Fix: move the primary path to OpenStreetMap Nominatim
// (free, keyless, supports Arabic), so reverseGeocode resolves to
// `status: 'ok'` with a real city string by default.
//
// Architecture:
//   - `reverseGeocodeViaNominatim(lat, lng, lang?, signal?)` is the
//     pure HTTP call against Nominatim. Exported so call sites that
//     need explicit language control can use it directly.
//   - `reverseGeocode(lat, lng, signal?)` is the public wrapper used
//     by the wizard / saved-addresses surfaces. It calls Nominatim
//     with `Accept-Language: ar,en` (RTL-first market) and never
//     throws — every failure path resolves to a typed `partial`
//     result with formatted lat/lng as the address fallback.
//   - `getCurrentLocationAddress()` wraps
//     `navigator.geolocation.getCurrentPosition` + `reverseGeocode`
//     into a single typed outcome.
//
// We intentionally do NOT throw from this module. Every code path
// resolves to a typed result so the caller's UI branches are
// exhaustive at compile time.

const NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

// OSM TOS asks operators of Nominatim clients to identify themselves
// so abuse can be contacted. The `User-Agent` header is the canonical
// channel in the Nominatim docs, but browsers strip / override
// User-Agent on fetch (it's on the Fetch Standard's forbidden-header
// list). The line below sets it anyway because:
//   1) the spec requires it,
//   2) when the same module runs on the backend (SSR / tests / a
//      future Nest endpoint), node-fetch DOES honour it,
//   3) tests can still assert it's been set on the request init.
//
// In practice the browser-side User-Agent that lands at osm.org is
// the regular browser UA. To give OSM a real contact channel for
// rate-limit / abuse, we ALSO append the documented `email` query
// param — that channel is honoured by Nominatim regardless of what
// the User-Agent header says.
const NOMINATIM_USER_AGENT = 'FixNowApp/1.0 (contact@fixnow.com)';
const NOMINATIM_CONTACT_EMAIL = 'contact@fixnow.com';

export type GeoErrorReason = 'denied' | 'unsupported' | 'timeout' | 'failed';

export interface ReverseGeocodeOk {
  status: 'ok';
  formattedAddress: string;
  /** Best-effort city extraction. Empty string when the geocoder
   *  returned a formatted address but none of the known city-typed
   *  fields matched (rare, but possible for remote points). */
  city: string;
  country: string;
  lat: number;
  lng: number;
}

export interface ReverseGeocodePartial {
  status: 'partial';
  /** Best-effort fallback the UI can show in the address field —
   *  formatted lat/lng to 5 decimals (~1.1 m precision). */
  formattedAddress: string;
  /** Why the lookup couldn't produce a real address. */
  reason: 'network' | 'no_match';
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

// ─── Nominatim payload shape ─────────────────────────────────────────────────
//
// Nominatim's `address` payload is locale-keyed: city / town / village /
// hamlet / municipality / county / state / country / country_code etc.
// We pick the most-specific available city-like field so the
// available-requests filter (which keys on a normalised cityKey) keeps
// working for rural points without losing precision in dense urban areas.
interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
}

interface NominatimReverseResponse {
  display_name?: string;
  address?: NominatimAddress;
  /** Nominatim returns `{ "error": "Unable to geocode" }` for points
   *  it can't resolve (mid-ocean, Antarctica, etc.) — we treat that
   *  as `no_match`, not `network`. */
  error?: string;
}

function nominatimCity(addr: NominatimAddress): string {
  return (
    addr.city ??
    addr.town ??
    addr.village ??
    addr.hamlet ??
    addr.municipality ??
    addr.county ??
    addr.state ??
    ''
  );
}

/** Pure Nominatim reverse-geocoding call. Caller controls the
 *  `Accept-Language` header via the `lang` arg (defaults to Arabic
 *  with English fallback for the RTL market). Never throws — every
 *  failure path resolves to a typed `partial` result. */
export async function reverseGeocodeViaNominatim(
  lat: number,
  lng: number,
  lang: 'ar' | 'en' = 'ar',
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  // `format=jsonv2` gives us the cleaner address-component shape;
  // `email` is the OSM-documented operator-contact channel that
  // works around the User-Agent forbidden-header issue in browsers.
  const url =
    `${NOMINATIM_REVERSE_URL}?format=jsonv2` +
    `&lat=${encodeURIComponent(String(lat))}` +
    `&lon=${encodeURIComponent(String(lng))}` +
    `&email=${encodeURIComponent(NOMINATIM_CONTACT_EMAIL)}`;

  const headers: Record<string, string> = {
    'Accept-Language': lang === 'ar' ? 'ar,en' : 'en,ar',
    // See module header — this is a no-op in browser fetch (forbidden
    // header). Kept so the same code path identifies cleanly when run
    // from node / a future backend proxy, and so tests can pin it.
    'User-Agent': NOMINATIM_USER_AGENT,
  };

  let res: Response;
  try {
    res = await fetch(url, { signal, headers });
  } catch (err) {
    console.warn('[reverse-geocode/nominatim] fetch failed:', err);
    return partial(lat, lng, 'network');
  }
  if (!res.ok) {
    console.warn(`[reverse-geocode/nominatim] HTTP ${res.status}`);
    return partial(lat, lng, 'network');
  }
  let body: NominatimReverseResponse;
  try {
    body = (await res.json()) as NominatimReverseResponse;
  } catch (err) {
    console.warn('[reverse-geocode/nominatim] response was not JSON:', err);
    return partial(lat, lng, 'network');
  }
  if (body.error || !body.display_name) {
    return partial(lat, lng, 'no_match');
  }
  const addr = body.address ?? {};
  return {
    status: 'ok',
    formattedAddress: body.display_name,
    city: nominatimCity(addr),
    country: addr.country ?? '',
    lat,
    lng,
  };
}

/** Public reverse-geocoder. Calls Nominatim with the platform's
 *  default Arabic-first language preference. Never throws.
 *
 *  CRITICAL FIX: this used to short-circuit to a `partial` outcome
 *  when VITE_GOOGLE_MAPS_API_KEY was unset, which left the wizard
 *  with formatted-coords as the only "address" string. The wizard's
 *  comma-pop heuristic then wrote a numeric coordinate into the
 *  request's `city` field, breaking provider matching. The fix is
 *  this Nominatim-first path: every dev shell now gets a real
 *  city/country pair on the OK branch. */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult> {
  return reverseGeocodeViaNominatim(lat, lng, 'ar', signal);
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
  /** Hint to the UA to use the most precise positioning available
   *  (GPS, multi-WiFi triangulation). Costs power + time but produces
   *  street-accurate coords instead of cell-tower-accuracy. Default
   *  `false` so casual flows (saved-addresses lookup) stay snappy.
   *  Set `true` for write-once flows where the value lands in a
   *  database (job creation, provider service-area pin). */
  enableHighAccuracy?: boolean;
  /** Max age of a cached position the UA may return without re-querying.
   *  Default 60 s lets the UA reuse a fresh fix between consecutive
   *  reads in the same session. Set `0` for write-once flows that
   *  must capture the device's CURRENT position (a stale 60 s cache
   *  could mean the user has since walked into a different building
   *  by the time the value is persisted). */
  maximumAgeMs?: number;
}

/** Wrap `navigator.geolocation.getCurrentPosition` + `reverseGeocode`
 *  in a single Promise that always resolves with a typed outcome.
 *  Never rejects — the UI branches on `outcome.status`. */
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
        {
          enableHighAccuracy: opts.enableHighAccuracy ?? false,
          timeout: opts.timeoutMs ?? 10_000,
          maximumAge: opts.maximumAgeMs ?? 60_000,
        },
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
