import { useEffect, useState } from 'react';

// Best-effort, non-blocking geolocation bootstrap for onboarding.
//
// Layering (strongest → weakest):
//   1. navigator.geolocation (lat/lng + fallback country via locale).
//   2. Browser locale region tag (e.g. `en-SA` → `SA`).
//   3. IANA timezone heuristic (only a small allowlist; unknown → null).
//
// This hook MUST NOT block registration: if the user denies geolocation or
// the API is unavailable, we still return a best-effort countryCode via
// locale/timezone so the phone-prefix selector can pre-select sensibly.
// The UX layer is responsible for being honest about the source.

export type GeoSource = 'geo' | 'locale' | 'timezone' | 'unknown';

export interface GeoBootstrap {
  /** ISO 3166-1 alpha-2 country code, or null if unresolved. */
  countryCode: string | null;
  /** Browser-reported lat/lng. Only populated when source==='geo'. */
  latitude: number | null;
  longitude: number | null;
  /** Where the countryCode came from. `unknown` → no fallback applied. */
  source: GeoSource;
  /** True while the geolocation permission prompt / fetch is in flight. */
  isResolving: boolean;
}

const INITIAL: GeoBootstrap = {
  countryCode: null,
  latitude: null,
  longitude: null,
  source: 'unknown',
  isResolving: false,
};

// Pure helpers — exported for testability.

/** Read a country from the browser's locale (e.g. `en-SA` → `SA`). */
export function countryFromLocale(locale: string | undefined): string | null {
  if (!locale) return null;
  const match = locale.match(/-([A-Z]{2})(?:-|$|@)/);
  return match?.[1] ?? null;
}

// Timezone → country heuristic. Only a small, high-confidence set; any
// timezone not listed here returns null (the UI should then fall back to
// locale). We avoid bundling a full tz → country map (that is a 10KB+ asset
// belonging to a real i18n provider).
const TIMEZONE_COUNTRY_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'Africa/Cairo': 'EG',
  'Asia/Riyadh': 'SA',
  'Asia/Dubai': 'AE',
  'Asia/Qatar': 'QA',
  'Asia/Bahrain': 'BH',
  'Asia/Kuwait': 'KW',
  'Asia/Muscat': 'OM',
  'Asia/Amman': 'JO',
  'Asia/Beirut': 'LB',
  'Asia/Baghdad': 'IQ',
  'Asia/Istanbul': 'TR',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'America/New_York': 'US',
  'America/Los_Angeles': 'US',
  'America/Chicago': 'US',
  'America/Toronto': 'CA',
});

export function countryFromTimezone(timezone: string | undefined): string | null {
  if (!timezone) return null;
  return TIMEZONE_COUNTRY_HINTS[timezone] ?? null;
}

/** Resolve a best-effort country code from locale + timezone (no network). */
export function resolveCountryFallback(): {
  countryCode: string | null;
  source: GeoSource;
} {
  try {
    const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;
    const fromLocale = countryFromLocale(locale);
    if (fromLocale) return { countryCode: fromLocale, source: 'locale' };
    const tz =
      typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
    const fromTz = countryFromTimezone(tz);
    if (fromTz) return { countryCode: fromTz, source: 'timezone' };
  } catch {
    // Intl / navigator absent (SSR, old runtimes) → return nothing.
  }
  return { countryCode: null, source: 'unknown' };
}

// ─── Hook ────────────────────────────────────────────────────────────────
//
// Resolves the fallback country synchronously on mount so the UI has a
// sensible dial-code pre-selection the moment the screen renders. Then, on
// mount, fires a one-shot `navigator.geolocation.getCurrentPosition` — on
// success it updates lat/lng but leaves the countryCode alone (we don't run
// reverse-geocoding here; that belongs to a server-side geocoding service
// added in a later phase). If the user denies geolocation, nothing breaks:
// the fallback countryCode stays.
//
// Options:
//   requestPreciseOnMount (default false) — call getCurrentPosition eagerly.
//     Most UX should pass `false` and trigger the precise ask behind a CTA.
export interface UseGeoBootstrapOptions {
  requestPreciseOnMount?: boolean;
  /** Max time to wait for the geolocation fix. Default 10 s. */
  timeoutMs?: number;
}

export function useGeoBootstrap(opts: UseGeoBootstrapOptions = {}): GeoBootstrap {
  const [state, setState] = useState<GeoBootstrap>(() => {
    const fb = resolveCountryFallback();
    return { ...INITIAL, countryCode: fb.countryCode, source: fb.source };
  });

  useEffect(() => {
    if (!opts.requestPreciseOnMount) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let cancelled = false;
    setState((s) => ({ ...s, isResolving: true }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          // Upgrade the source label when we got a real fix. We still keep
          // the locale-derived country — in-browser reverse geocoding is
          // out of scope.
          source: 'geo',
          isResolving: false,
        }));
      },
      () => {
        if (cancelled) return;
        // Denied / errored. Keep the locale fallback that was set in
        // initial state; just clear the in-flight flag.
        setState((s) => ({ ...s, isResolving: false }));
      },
      { enableHighAccuracy: false, timeout: opts.timeoutMs ?? 10_000 },
    );
    return () => {
      cancelled = true;
    };
  }, [opts.requestPreciseOnMount, opts.timeoutMs]);

  return state;
}
