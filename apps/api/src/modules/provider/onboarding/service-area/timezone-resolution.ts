// Sprint 9B.19 — working out the provider's timezone so they do not have to.
//
// WHY THE PROVIDER SHOULD NOT BE ASKED
//
// The availability step stores intervals against an IANA identifier, and until
// now the CLIENT supplied it. That put "Asia/Damascus" in front of a plumber
// as a thing to choose, which is a question about database conventions dressed
// up as a question about their working hours. Most people do not know their
// tz identifier, several plausible-looking ones are wrong for a given city,
// and picking the wrong one silently shifts every window they enter.
//
// So the server resolves it from the country the provider already told us, and
// the UI shows the OFFSET and the city — never the identifier — unless the
// answer is genuinely ambiguous.
//
// WHAT THIS IS NOT
//
// A geocoder. A country is enough for the markets this platform serves and for
// most others; where it is not — a country spanning several zones — this
// returns AMBIGUOUS rather than guessing, and the availability step asks. A
// guess here would be indistinguishable from an answer and would be wrong for
// half of Russia.

/** Countries whose whole territory observes one zone, for the markets this
 *  platform serves and their neighbours.
 *
 *  Deliberately a small, explicit list rather than a dependency: a full tz
 *  database is megabytes, ages, and answers a question nobody here asked. An
 *  absent country is not an error — it is AMBIGUOUS, which is handled. */
const SINGLE_ZONE_BY_COUNTRY: Record<string, string> = {
  SY: 'Asia/Damascus',
  LB: 'Asia/Beirut',
  JO: 'Asia/Amman',
  IQ: 'Asia/Baghdad',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  KW: 'Asia/Kuwait',
  QA: 'Asia/Qatar',
  BH: 'Asia/Bahrain',
  OM: 'Asia/Muscat',
  YE: 'Asia/Aden',
  EG: 'Africa/Cairo',
  TR: 'Europe/Istanbul',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  IT: 'Europe/Rome',
  ES: 'Europe/Madrid',
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  PL: 'Europe/Warsaw',
  IN: 'Asia/Kolkata',
  PK: 'Asia/Karachi',
  BD: 'Asia/Dhaka',
  MA: 'Africa/Casablanca',
  TN: 'Africa/Tunis',
  DZ: 'Africa/Algiers',
  LY: 'Africa/Tripoli',
  SD: 'Africa/Khartoum',
};

/** Countries known to span several zones. Listed so the answer is a confident
 *  "ask them" rather than an accidental "we have never heard of this". */
const MULTI_ZONE_COUNTRIES = new Set([
  'US',
  'CA',
  'RU',
  'AU',
  'BR',
  'MX',
  'CN',
  'ID',
  'KZ',
  'CD',
  'CL',
  'ES_CANARY',
]);

export type TimezoneResolution =
  /** One zone covers the whole country; nothing needs asking. */
  | { kind: 'RESOLVED'; timezone: string }
  /** The country has several zones, or we have no mapping for it. The
   *  availability step must ask, and this is the only case where an identifier
   *  may reasonably appear in the UI. */
  | { kind: 'AMBIGUOUS'; reason: 'MULTI_ZONE' | 'UNKNOWN_COUNTRY' }
  /** No country yet. Not a failure — the provider has not reached that field. */
  | { kind: 'UNKNOWN' };

/**
 * The provider's timezone, from their country code.
 *
 * `countryCode` is the NORMALISED code, not the display name: resolving prose
 * would be one spelling away from silently resolving to nothing, which is the
 * whole reason the code column exists.
 */
export function resolveTimezone(countryCode: string | null): TimezoneResolution {
  if (!countryCode) return { kind: 'UNKNOWN' };

  const code = countryCode.trim().toUpperCase();
  if (code.length === 0) return { kind: 'UNKNOWN' };

  const zone = SINGLE_ZONE_BY_COUNTRY[code];
  if (zone) return { kind: 'RESOLVED', timezone: zone };

  if (MULTI_ZONE_COUNTRIES.has(code)) return { kind: 'AMBIGUOUS', reason: 'MULTI_ZONE' };
  return { kind: 'AMBIGUOUS', reason: 'UNKNOWN_COUNTRY' };
}

/**
 * What the UI should SHOW for a resolved zone.
 *
 * The current UTC offset and the city part of the identifier — "Damascus
 * (UTC+3)" — because that is what a person can check against their own clock.
 * The raw "Asia/Damascus" is a database convention and is not shown.
 *
 * Computed rather than stored: an offset changes with daylight saving, and a
 * cached one is wrong for half the year.
 */
export function describeTimezone(timezone: string, at: Date): { city: string; offset: string } {
  const city = (timezone.split('/').pop() ?? timezone).replace(/_/g, ' ');

  // Intl gives the offset for THIS instant in that zone, which is the only
  // correct way to get it — a fixed table would be wrong every March.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(at);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'UTC';

  // "GMT+3" → "UTC+3". The platform says UTC everywhere else.
  return { city, offset: raw.replace(/^GMT/, 'UTC') };
}
