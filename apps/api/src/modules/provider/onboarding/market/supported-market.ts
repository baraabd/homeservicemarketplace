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
  | 'INVALID_TIMEZONE';

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

    return Object.freeze({
      countryCode: e.countryCode,
      enabled: e.enabled,
      displayNameKey: e.displayNameKey.trim(),
      ...(e.defaultTimezone === undefined ? {} : { defaultTimezone: e.defaultTimezone as string }),
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
