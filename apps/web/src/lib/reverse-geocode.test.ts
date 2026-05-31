import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getCurrentLocationAddress,
  reverseGeocode,
  reverseGeocodeViaNominatim,
} from './reverse-geocode';

// CRITICAL bug fix — the geocoder used to short-circuit to a
// formatted-coords partial whenever VITE_GOOGLE_MAPS_API_KEY was
// unset, which fed the wizard's comma-pop heuristic with strings like
// "36.20120, 37.16110" and surfaced numeric coordinates as the city.
// The new contract:
//
//   - Nominatim is the PRIMARY (and only) geocoder. No API key needed.
//   - The pure HTTP call resolves to `status: 'ok'` with a real city
//     string when Nominatim returns a `display_name`, OR to a typed
//     `partial` on network / no_match. NEVER throws.
//   - Accept-Language defaults to Arabic-first ('ar,en') because the
//     primary market is RTL.
//   - The OSM TOS contact channel is included via the `email` query
//     param (the User-Agent header is set in code but stripped by
//     browsers — see module header). Tests pin both.

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('reverseGeocodeViaNominatim', () => {
  it('returns "ok" with display_name + city + country on a successful response', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'King Fahd Rd, Riyadh, Saudi Arabia',
            address: {
              road: 'King Fahd Rd',
              city: 'Riyadh',
              country: 'Saudi Arabia',
              country_code: 'sa',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(24.7136, 46.6753);
    expect(r).toEqual({
      status: 'ok',
      formattedAddress: 'King Fahd Rd, Riyadh, Saudi Arabia',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
    });
  });

  it('hits Nominatim with format=jsonv2, the email contact param, and the lat/lon coords', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ display_name: 'X', address: {} }), { status: 200 }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocodeViaNominatim(36.2012, 37.1612);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(calledUrl).toContain('nominatim.openstreetmap.org/reverse');
    expect(calledUrl).toContain('format=jsonv2');
    expect(calledUrl).toContain('lat=36.2012');
    expect(calledUrl).toContain('lon=37.1612');
    // email query param is the OSM TOS identification channel — the
    // User-Agent header is forbidden in browser fetch, so the email
    // param is the only signal that actually lands at the server.
    expect(calledUrl).toContain('email=contact%40fixnow.com');
  });

  it('sends Accept-Language: ar,en by default (Arabic-first market)', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ display_name: 'X', address: {} }), { status: 200 }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocodeViaNominatim(36.2012, 37.1612);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Accept-Language']).toBe('ar,en');
  });

  it('flips Accept-Language to en,ar when lang="en" is passed', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ display_name: 'X', address: {} }), { status: 200 }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocodeViaNominatim(24.7136, 46.6753, 'en');

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Accept-Language']).toBe('en,ar');
  });

  it('sets the User-Agent header on the request init (no-op in browser, honoured by node)', async () => {
    const fetchSpy = vi.fn(
      async () => new Response(JSON.stringify({ display_name: 'X', address: {} }), { status: 200 }),
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    await reverseGeocodeViaNominatim(0, 0);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['User-Agent']).toBe('FixNowApp/1.0 (contact@fixnow.com)');
  });

  it('picks the most-specific city-like field when `city` is absent (rural village pattern)', async () => {
    // Real Nominatim payloads for rural points often surface `town`,
    // `village`, or `municipality` instead of `city`. The picker
    // prefers the most-specific available field so downstream
    // city-keyed filters keep matching.
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'Some Village, Aleppo, Syria',
            address: {
              village: 'Some Village',
              state: 'Aleppo',
              country: 'Syria',
            },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(36.2012, 37.1612);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.city).toBe('Some Village');
      expect(r.country).toBe('Syria');
    }
  });

  it('returns city: "" when Nominatim resolves only to a country (remote point)', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'Saudi Arabia',
            address: {
              country: 'Saudi Arabia',
              country_code: 'sa',
            },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(20, 45);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.city).toBe('');
      expect(r.country).toBe('Saudi Arabia');
    }
  });

  it('falls back to "no_match" partial when Nominatim returns an error payload', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Unable to geocode' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(0, 0);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') {
      expect(r.reason).toBe('no_match');
      expect(r.formattedAddress).toBe('0.00000, 0.00000');
    }
  });

  it('falls back to "network" partial when fetch rejects', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(1, 2);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') {
      expect(r.reason).toBe('network');
      expect(r.formattedAddress).toBe('1.00000, 2.00000');
    }
  });

  it('falls back to "network" partial on a non-2xx HTTP response', async () => {
    global.fetch = vi.fn(async () => new Response('rate limited', { status: 429 })) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(1, 2);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') expect(r.reason).toBe('network');
  });

  it('falls back to "network" partial on a non-JSON body (defensive)', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    ) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(1, 2);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') expect(r.reason).toBe('network');
  });

  it('NEVER throws — every failure surfaces as a typed result', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('uncaught');
    }) as typeof fetch;

    await expect(reverseGeocodeViaNominatim(1, 2)).resolves.toMatchObject({ status: 'partial' });
  });

  it('partial outcomes carry city: "" + country: "" so the union stays symmetric', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('boom');
    }) as typeof fetch;

    const r = await reverseGeocodeViaNominatim(1, 2);
    expect(r).toMatchObject({
      status: 'partial',
      city: '',
      country: '',
    });
  });
});

describe('reverseGeocode (public wrapper)', () => {
  it('delegates to Nominatim and surfaces the OK result', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'Sheikh Maqsood, Aleppo, Syria',
            address: { suburb: 'Sheikh Maqsood', city: 'Aleppo', country: 'Syria' },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocode(36.2012, 37.1612);
    expect(r).toMatchObject({
      status: 'ok',
      formattedAddress: 'Sheikh Maqsood, Aleppo, Syria',
      city: 'Aleppo',
      country: 'Syria',
    });
  });

  it('does NOT depend on VITE_GOOGLE_MAPS_API_KEY (no env var read at all)', async () => {
    // The pre-fix path read VITE_GOOGLE_MAPS_API_KEY at module scope
    // and returned a `partial(no_api_key)` outcome when it was unset
    // — the bug the wizard then surfaced as `city: "37.16271"`. The
    // Nominatim-first path must work regardless of the env var.
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'Test address',
            address: { city: 'Riyadh', country: 'Saudi Arabia' },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    try {
      const r = await reverseGeocode(24.7, 46.7);
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        expect(r.city).toBe('Riyadh');
        // CRITICAL: the city is the locality string, NEVER a numeric
        // coordinate. This pin would have caught the original bug.
        expect(r.city).not.toMatch(/^-?\d+(\.\d+)?$/);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('getCurrentLocationAddress', () => {
  it('returns { status: "error", reason: "unsupported" } when navigator.geolocation is missing', async () => {
    const original = navigator.geolocation;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    });
    try {
      const r = await getCurrentLocationAddress();
      expect(r).toEqual({ status: 'error', reason: 'unsupported' });
    } finally {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: original,
      });
    }
  });

  it('maps PERMISSION_DENIED → reason "denied"', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (
          _ok: PositionCallback,
          err: PositionErrorCallback | null | undefined,
        ) => err?.({ code: 1, message: 'denied' } as GeolocationPositionError),
      },
    });
    const r = await getCurrentLocationAddress();
    expect(r).toEqual({ status: 'error', reason: 'denied' });
  });

  it('on success calls reverseGeocode and returns "ok" when Nominatim resolves', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: 24.7, longitude: 46.7 } } as GeolocationPosition),
      },
    });
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            display_name: 'Test address',
            address: { city: 'Riyadh', country: 'Saudi Arabia' },
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await getCurrentLocationAddress();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.formattedAddress).toBe('Test address');
      expect(r.city).toBe('Riyadh');
      expect(r.lat).toBe(24.7);
      expect(r.lng).toBe(46.7);
    }
  });
});
