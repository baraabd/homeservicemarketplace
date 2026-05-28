import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCurrentLocationAddress, reverseGeocode } from './reverse-geocode';

// Phase 2 Bug 3 — graceful-fallback contract pinned by tests.
//
// Every code path resolves to a typed result; nothing throws. The
// caller's UI branches are exhaustive at compile time, and we want
// to keep them exhaustive at runtime too.

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  // Vitest's documented hook for overriding `import.meta.env.VITE_*`
  // — assigning to import.meta.env directly is not picked up by the
  // module under test under Vite's transformed runtime.
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key');
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('reverseGeocode', () => {
  it('returns "ok" with formatted address + city + country on a Google OK response', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                formatted_address: '7 Olaya St, Riyadh 12333, Saudi Arabia',
                address_components: [
                  { long_name: '7', short_name: '7', types: ['street_number'] },
                  { long_name: 'Olaya St', short_name: 'Olaya St', types: ['route'] },
                  { long_name: 'Riyadh', short_name: 'Riyadh', types: ['locality', 'political'] },
                  { long_name: 'Saudi Arabia', short_name: 'SA', types: ['country', 'political'] },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as typeof fetch;

    const r = await reverseGeocode(24.7136, 46.6753);
    expect(r).toEqual({
      status: 'ok',
      formattedAddress: '7 Olaya St, Riyadh 12333, Saudi Arabia',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
    });
  });

  it('falls through to Nominatim when VITE_GOOGLE_MAPS_API_KEY is missing and returns its display_name', async () => {
    // Sprint 7.x — the no-key path used to return `partial` with
    // formatted coords. It now hits OpenStreetMap Nominatim (free,
    // keyless) and surfaces the real street name.
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    const fetchSpy = vi.fn(
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
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const r = await reverseGeocode(24.7136, 46.6753);
    expect(r).toEqual({
      status: 'ok',
      formattedAddress: 'King Fahd Rd, Riyadh, Saudi Arabia',
      city: 'Riyadh',
      country: 'Saudi Arabia',
      lat: 24.7136,
      lng: 46.6753,
    });
    // The Nominatim path requests Arabic-first localisation per the
    // page's RTL audience.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(calledUrl).toContain('nominatim.openstreetmap.org/reverse');
    expect(calledUrl).toContain('lat=24.7136');
    expect(calledUrl).toContain('lon=46.6753');
    const headers = calledInit?.headers as Record<string, string> | undefined;
    expect(headers?.['Accept-Language']).toBe('ar,en');
  });

  it('falls back to formatted coords when Nominatim itself fails (network)', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const r = await reverseGeocode(24.7136, 46.6753);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') {
      expect(r.reason).toBe('network');
      expect(r.formattedAddress).toBe('24.71360, 46.67530');
    }
  });

  it('falls back to formatted coords when Nominatim returns an empty / no-match payload', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Unable to geocode' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const r = await reverseGeocode(0, 0);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') {
      expect(r.reason).toBe('no_match');
      expect(r.formattedAddress).toBe('0.00000, 0.00000');
    }
  });

  it('Nominatim picks the most-specific city-like field when `city` is absent', async () => {
    // Real Nominatim payloads for rural points often surface `town`,
    // `village`, or `municipality` instead of `city`. The picker
    // prefers the most-specific field available so downstream
    // city-keyed filters keep matching.
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '');
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
    ) as unknown as typeof fetch;

    const r = await reverseGeocode(36.2012, 37.1612);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.city).toBe('Some Village');
      expect(r.country).toBe('Syria');
    }
  });

  it('falls back to formatted coords on a non-OK Google status (ZERO_RESULTS)', async () => {
    global.fetch = vi.fn(
      async () => new Response(JSON.stringify({ status: 'ZERO_RESULTS' }), { status: 200 }),
    ) as typeof fetch;

    const r = await reverseGeocode(0, 0);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') expect(r.reason).toBe('no_match');
  });

  it('falls back on a network failure (fetch rejects)', async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const r = await reverseGeocode(1, 2);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') {
      expect(r.reason).toBe('network');
      expect(r.formattedAddress).toBe('1.00000, 2.00000');
    }
  });

  it('falls back on an HTTP non-2xx (e.g. quota exhausted)', async () => {
    global.fetch = vi.fn(async () => new Response('Forbidden', { status: 403 })) as typeof fetch;

    const r = await reverseGeocode(1, 2);
    expect(r.status).toBe('partial');
    if (r.status === 'partial') expect(r.reason).toBe('network');
  });

  it('NEVER throws — every failure is a typed result', async () => {
    // Hostile body: HTTP 200 with a payload that's not JSON. Our
    // handler must catch the JSON parse error.
    global.fetch = vi.fn(
      async () =>
        new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    ) as typeof fetch;

    await expect(reverseGeocode(1, 2)).resolves.toMatchObject({ status: 'partial' });
  });

  // Step 1 of the Geocoding & City Filter sprint — pin the robust
  // city extraction so the available-requests filter has a reliable
  // city string to match against.
  it('extracts city from a SIBLING result when the top result has no locality', async () => {
    // Top result is a street_address with NO locality (Google does
    // this — the locality lives in the next result, the city itself).
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                formatted_address: 'King Fahd Rd, Riyadh, Saudi Arabia',
                address_components: [
                  { long_name: 'King Fahd Rd', short_name: 'King Fahd Rd', types: ['route'] },
                  { long_name: 'Saudi Arabia', short_name: 'SA', types: ['country', 'political'] },
                ],
              },
              {
                formatted_address: 'Riyadh, Saudi Arabia',
                address_components: [
                  { long_name: 'Riyadh', short_name: 'Riyadh', types: ['locality', 'political'] },
                  { long_name: 'Saudi Arabia', short_name: 'SA', types: ['country', 'political'] },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocode(24.7, 46.7);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.city).toBe('Riyadh');
      expect(r.country).toBe('Saudi Arabia');
    }
  });

  it('falls back to postal_town when locality is missing (UK pattern)', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                formatted_address: '1 Princes St, Edinburgh EH2, UK',
                address_components: [
                  {
                    long_name: 'Edinburgh',
                    short_name: 'Edinburgh',
                    types: ['postal_town'],
                  },
                  {
                    long_name: 'United Kingdom',
                    short_name: 'GB',
                    types: ['country', 'political'],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocode(55.95, -3.19);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') expect(r.city).toBe('Edinburgh');
  });

  it('returns city: "" when no city-typed component matches anywhere', async () => {
    // Remote point — geocode resolves but only to a country.
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: 'OK',
            results: [
              {
                formatted_address: 'Saudi Arabia',
                address_components: [
                  { long_name: 'Saudi Arabia', short_name: 'SA', types: ['country', 'political'] },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await reverseGeocode(20, 45);
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.city).toBe('');
      expect(r.country).toBe('Saudi Arabia');
    }
  });

  it('partial outcomes carry city: "" + country: "" so the union stays symmetric', async () => {
    // Force a partial via a network failure on the Google path (key
    // present + fetch rejects). The symmetry assertion is independent
    // of which provider produced the partial.
    global.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const r = await reverseGeocode(1, 2);
    expect(r).toMatchObject({
      status: 'partial',
      city: '',
      country: '',
      reason: 'network',
    });
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

  it('on success calls reverseGeocode and returns "ok" when the API responds', async () => {
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
            status: 'OK',
            results: [
              {
                formatted_address: 'Test address',
                address_components: [
                  { long_name: 'Riyadh', short_name: 'Riyadh', types: ['locality'] },
                  { long_name: 'Saudi Arabia', short_name: 'SA', types: ['country'] },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const r = await getCurrentLocationAddress();
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.formattedAddress).toBe('Test address');
      expect(r.lat).toBe(24.7);
      expect(r.lng).toBe(46.7);
    }
  });
});
