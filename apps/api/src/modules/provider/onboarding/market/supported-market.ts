import { isISO31661Alpha2 } from 'class-validator';

// Sprint 09B.29 Phase 5 — which markets this platform actually serves.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// WHY THIS EXISTS
//
// Until now the provider's country arrived in the request body and was checked
// against `/^[A-Z]{2}$/`. So `ZZ` was a country, `AQ` was a country, and the
// operator had no way to say which markets they serve — the API had no opinion
// to express. `market-entry-gap.spec.ts` records that state.
//
// The product-owner decision of this phase makes the marketplace multi-country
// from launch, so the answer is NOT a single platform country. It is a
// registry, read from the operator's own audited configuration, listing every
// market and whether it is enabled.
//
// WHY THE VALIDATION IS HERE AND NOT IN THE SERVICE
//
// Parsing a stored blob is a pure function of the blob, and it is the part with
// all the edge cases: a code that is not a country, a timezone that is not a
// zone, a duplicate, an empty list. Keeping it pure means those cases are
// tested without a database, and the service is left with the one thing it has
// to do — read the row and hand it here.
//
// NO NEW DEPENDENCY, AND NO HAND-MAINTAINED LIST
//
//   countries  `class-validator` is already a dependency and ships the ISO
//              3166-1 alpha-2 register. A hand-written array here would be
//              wrong within a year and nobody would notice.
//   timezones  `Intl.supportedValuesOf('timeZone')` is in the Node runtime and
//              carries the IANA database the platform is already using to
//              format times. Anything else would be a second, disagreeing copy.

/** One market the operator has configured. */
export interface SupportedMarket {
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly countryCode: string;
  readonly enabled: boolean;
  /** An i18n key, resolved by the existing localisation system. Never a
   *  human-readable name: a country's name is different in Arabic and English
   *  and the server does not know which one the reader wants. */
  readonly displayNameKey: string;
  /**
   * The market's default IANA zone, when the country has ONE unambiguous zone.
   *
   * Optional on purpose. A country spanning several zones must not be given a
   * default here, because a default is indistinguishable from an answer — and
   * the Phase 5 timezone precedence requires such a market to ask the provider
   * rather than guess.
   */
  readonly defaultTimezone?: string;
  /**
   * Every IANA zone providers in this market may work in.
   *
   * Sprint 09B.29 Phase 5 (C3). Optional, and it answers a question
   * `defaultTimezone` cannot: WHICH zones are legitimate here. A valid IANA
   * identifier is not the same thing as a zone that belongs to this country,
   * and without a declared set the server can only check syntax — so a
   * provider in Sweden could store their week in Asia/Riyadh and every seeker
   * would read the wrong hours.
   *
   * A single-zone market need not repeat itself: `defaultTimezone` alone
   * implies a set of exactly one. A multi-zone market lists its zones and
   * declares no default, because a default is indistinguishable from an
   * answer.
   *
   * Absent from BOTH means the operator has not described this market's zones
   * at all. The server then cannot judge compatibility and says so, rather
   * than pretending a check happened.
   */
  readonly timezones?: readonly string[];
  /**
   * The geographic envelope of the market, in decimal degrees.
   *
   * R09. Optional, and it answers the question the country code cannot: is a
   * POINT in this market? Until now a provider could choose Syria and then
   * place their starting point anywhere on the planet; matching is decided by
   * that point, so their application said one place and their feed another.
   *
   * A coarse rectangle, deliberately. It is not a border: it contains the
   * country and some of its neighbours' edges. Its job is to refuse a point
   * that is plainly somewhere else, not to adjudicate a frontier.
   *
   * Absent means the operator has not described where this market is. The
   * server then cannot judge a point and does not pretend to — exactly as
   * with `timezones` above.
   */
  readonly bounds?: MarketBounds;
}

/** A latitude/longitude rectangle. `west` < `east`: a market spanning the
 *  antimeridian cannot be described and is refused by the parser. */
export interface MarketBounds {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Why a stored registry was refused. Codes rather than sentences: these reach
 *  an operator through a config error and a log line, both of which need a
 *  stable identifier rather than prose. */
export type MarketRegistryErrorCode =
  | 'NOT_AN_ARRAY'
  | 'EMPTY'
  | 'NO_ENABLED_MARKET'
  | 'NOT_AN_OBJECT'
  | 'INVALID_COUNTRY_CODE'
  | 'DUPLICATE_COUNTRY_CODE'
  | 'INVALID_ENABLED'
  | 'INVALID_DISPLAY_NAME_KEY'
  | 'INVALID_TIMEZONE'
  | 'INVALID_TIMEZONE_LIST'
  | 'INVALID_BOUNDS';

export class MarketRegistryError extends Error {
  constructor(
    readonly code: MarketRegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketRegistryError';
  }
}

/** The setting key the registry lives under. One key holding a JSON array,
 *  rather than a key per market: the operator edits the SET, and a per-key
 *  layout would make "which markets are enabled" a scan rather than a read. */
export const SUPPORTED_MARKETS_SETTING = 'platform_supported_markets';

/**
 * Every IANA zone this runtime knows.
 *
 * Computed once. `Intl.supportedValuesOf` walks the whole database, and this is
 * called on every registry read.
 *
 * NOTE: it returns only canonical GEOGRAPHIC zones — `UTC` and the whole
 * `Etc/*` family are absent, and that is the behaviour we want. A market's
 * default timezone describes a place where providers work; `UTC` is not one,
 * and a market configured with it would silently shift every working-hours
 * window a provider entered. The spec asserts this explicitly because it comes
 * from the runtime rather than from code here.
 */
let zoneCache: Set<string> | null = null;
export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (zoneCache === null) zoneCache = new Set(Intl.supportedValuesOf('timeZone'));
  return zoneCache.has(value);
}

/** Is this an assigned ISO 3166-1 alpha-2 code, in the canonical uppercase? */
export function isValidCountryCode(value: unknown): value is string {
  return typeof value === 'string' && value === value.toUpperCase() && isISO31661Alpha2(value);
}

/**
 * Parse and validate a stored registry.
 *
 * Throws rather than returning a partial list. A registry with one bad row is
 * a configuration mistake, and silently dropping that row would leave the
 * operator believing a market is live when it is not — which is worse than a
 * loud failure at read time.
 *
 * An EMPTY or all-disabled registry is also an error, and deliberately so: the
 * decision requires that it "fail safely with a clear configuration error" and
 * never fall back to an invented country. There is no default market anywhere
 * in this module.
 */
function isValidBounds(value: unknown): value is MarketBounds {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const b = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
  if (!finite(b.south) || !finite(b.west) || !finite(b.north) || !finite(b.east)) return false;
  return (
    b.south >= -90 &&
    b.north <= 90 &&
    b.south < b.north &&
    b.west >= -180 &&
    b.east <= 180 &&
    b.west < b.east
  );
}

/**
 * Is this point inside the market?
 *
 * `null` when the market declares no bounds: the server cannot judge, and a
 * caller must not read that as either answer. The edges are inside.
 */
export function marketContainsPoint(
  market: Pick<SupportedMarket, 'bounds'>,
  point: { lat: number; lng: number },
): boolean | null {
  const b = market.bounds;
  if (!b) return null;
  return point.lat >= b.south && point.lat <= b.north && point.lng >= b.west && point.lng <= b.east;
}

export function parseSupportedMarkets(raw: unknown): SupportedMarket[] {
  if (!Array.isArray(raw)) {
    throw new MarketRegistryError(
      'NOT_AN_ARRAY',
      `${SUPPORTED_MARKETS_SETTING} must be a JSON array of markets`,
    );
  }
  if (raw.length === 0) {
    throw new MarketRegistryError(
      'EMPTY',
      `${SUPPORTED_MARKETS_SETTING} is empty; no market is configured`,
    );
  }

  const seen = new Set<string>();
  const markets: SupportedMarket[] = raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new MarketRegistryError('NOT_AN_OBJECT', `market at index ${index} is not an object`);
    }
    const e = entry as Record<string, unknown>;

    if (!isValidCountryCode(e.countryCode)) {
      // The value is echoed because an operator fixing a config file needs to
      // see WHICH code was rejected. It is a country code, not a secret.
      throw new MarketRegistryError(
        'INVALID_COUNTRY_CODE',
        `market at index ${index} has countryCode ${JSON.stringify(e.countryCode)}, which is not an uppercase ISO 3166-1 alpha-2 code`,
      );
    }
    if (seen.has(e.countryCode)) {
      throw new MarketRegistryError(
        'DUPLICATE_COUNTRY_CODE',
        `${e.countryCode} appears more than once; the registry would be ambiguous`,
      );
    }
    seen.add(e.countryCode);

    if (typeof e.enabled !== 'boolean') {
      throw new MarketRegistryError(
        'INVALID_ENABLED',
        `market ${e.countryCode} must set enabled to a boolean`,
      );
    }
    if (typeof e.displayNameKey !== 'string' || e.displayNameKey.trim().length === 0) {
      throw new MarketRegistryError(
        'INVALID_DISPLAY_NAME_KEY',
        `market ${e.countryCode} must carry a non-empty displayNameKey`,
      );
    }
    if (e.defaultTimezone !== undefined && !isValidTimezone(e.defaultTimezone)) {
      throw new MarketRegistryError(
        'INVALID_TIMEZONE',
        `market ${e.countryCode} has defaultTimezone ${JSON.stringify(e.defaultTimezone)}, which is not a valid IANA identifier`,
      );
    }

    if (e.timezones !== undefined) {
      if (
        !Array.isArray(e.timezones) ||
        e.timezones.length === 0 ||
        !e.timezones.every((z) => isValidTimezone(z))
      ) {
        throw new MarketRegistryError(
          'INVALID_TIMEZONE_LIST',
          `market ${e.countryCode} has a timezones value that is not a non-empty array of valid IANA identifiers`,
        );
      }
      // A declared default that the declared list excludes is a contradiction,
      // and the resulting behaviour would depend on which one a reader
      // consulted first. Refused rather than reconciled.
      if (e.defaultTimezone !== undefined && !e.timezones.includes(e.defaultTimezone)) {
        throw new MarketRegistryError(
          'INVALID_TIMEZONE_LIST',
          `market ${e.countryCode} declares defaultTimezone ${JSON.stringify(e.defaultTimezone)}, which its own timezones list does not contain`,
        );
      }
    }

    if (e.bounds !== undefined && !isValidBounds(e.bounds)) {
      throw new MarketRegistryError(
        'INVALID_BOUNDS',
        `market ${e.countryCode} has bounds that are not { south, west, north, east } in degrees with south < north and west < east`,
      );
    }

    return Object.freeze({
      countryCode: e.countryCode,
      enabled: e.enabled,
      displayNameKey: e.displayNameKey.trim(),
      ...(e.defaultTimezone === undefined ? {} : { defaultTimezone: e.defaultTimezone as string }),
      ...(e.timezones === undefined
        ? {}
        : { timezones: Object.freeze([...(e.timezones as string[])]) }),
      ...(e.bounds === undefined
        ? {}
        : {
            bounds: Object.freeze({
              south: (e.bounds as MarketBounds).south,
              west: (e.bounds as MarketBounds).west,
              north: (e.bounds as MarketBounds).north,
              east: (e.bounds as MarketBounds).east,
            }),
          }),
    });
  });

  if (!markets.some((m) => m.enabled)) {
    throw new MarketRegistryError(
      'NO_ENABLED_MARKET',
      `${SUPPORTED_MARKETS_SETTING} contains no ENABLED market; onboarding would have nowhere to send a provider`,
    );
  }

  return markets;
}

/** The enabled subset, in registry order. The order is the operator's, so a
 *  picker can present markets the way they configured them rather than
 *  alphabetically by a name the server cannot localise. */
export function enabledMarkets(markets: readonly SupportedMarket[]): SupportedMarket[] {
  return markets.filter((m) => m.enabled);
}

/**
 * The enabled market for a code, or null.
 *
 * Case-insensitive on input and canonical on output, because the code arrives
 * from a request body, a cookie and a geocoder — three sources with three
 * conventions — and every one of them must resolve to the same registry row or
 * none.
 *
 * A DISABLED market answers null, exactly like an unknown one. The caller is
 * choosing whether a provider may operate there, and "configured but off" and
 * "never heard of it" are the same answer to that question.
 */
export function findEnabledMarket(
  markets: readonly SupportedMarket[],
  code: unknown,
): SupportedMarket | null {
  if (typeof code !== 'string') return null;
  const canonical = code.trim().toUpperCase();
  if (!isValidCountryCode(canonical)) return null;
  return markets.find((m) => m.countryCode === canonical && m.enabled) ?? null;
}
