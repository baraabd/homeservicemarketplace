import { findEnabledMarket, type SupportedMarket } from './supported-market';

// Sprint 09B.29 Phase 5 — which market a provider is in, and on whose authority.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// THE RULE THIS ENCODES
//
// The product-owner decision lists five sources in strict precedence, and the
// important half of it is what each source is ALLOWED to do:
//
//   1. persisted   the country already on the profile or draft   AUTHORITATIVE
//   2. confirmed   a market the user explicitly chose            AUTHORITATIVE
//   3. resolved    coordinates or a place, THEN confirmed        AUTHORITATIVE
//   4. cookie      a signed record of a previous confirmation    AUTHORITATIVE
//   5. hints       IP, Accept-Language, locale, browser timezone SUGGESTION ONLY
//
// So this function returns two different kinds of answer, and the type makes
// them impossible to confuse: `resolved` may be persisted, `suggested` may only
// be shown to the provider with a way to confirm or correct it. A caller that
// wanted to persist a suggestion would have to reach past the type to do it.
//
// WHY A PURE FUNCTION
//
// Every input is already a value by the time we get here — the registry has
// been read, the cookie verified, the geocoder called. What remains is a
// decision, and a decision with five branches and a security-relevant ordering
// is exactly the thing that should be testable without a database, a request,
// or a clock.
//
// WHAT IS NOT HERE
//
// No default market, no "primary country", no fallback. If nothing resolves,
// the answer is `NONE` and the UI asks. That is the whole point of the
// decision: an invented country is worse than no country, because the provider
// cannot see that it was invented.

/** Where an authoritative answer came from. Carried through so the UI can say
 *  "we remembered this" rather than presenting a value with no story. */
export type MarketSource = 'PERSISTED' | 'CONFIRMED' | 'RESOLVED_AND_CONFIRMED' | 'COOKIE';

/** Where a mere suggestion came from. None of these may be persisted. */
export type MarketHintSource = 'GEOLOCATION' | 'IP' | 'LOCALE' | 'BROWSER_TIMEZONE';

export type MarketResolution =
  | { readonly kind: 'RESOLVED'; readonly market: SupportedMarket; readonly source: MarketSource }
  | {
      readonly kind: 'SUGGESTED';
      readonly market: SupportedMarket;
      readonly source: MarketHintSource;
    }
  | { readonly kind: 'NONE' };

export interface MarketResolutionInput {
  /** The registry. Only ENABLED markets can ever be returned. */
  readonly markets: readonly SupportedMarket[];
  /** The country already stored against this provider, if any. */
  readonly persistedCountryCode?: string | null;
  /** A market the user explicitly chose and confirmed in this request. */
  readonly confirmedCountryCode?: string | null;
  /**
   * A country derived from coordinates or a trusted place id THAT THE USER HAS
   * CONFIRMED. An unconfirmed geocoder answer is a hint, not this.
   */
  readonly resolvedAndConfirmedCountryCode?: string | null;
  /** A country read from an already-verified market cookie. Verification —
   *  signature, expiry, tampering — happens before this function; by the time
   *  a value arrives here it is a previous confirmation, not a claim. */
  readonly cookieCountryCode?: string | null;
  /** Low-confidence signals. Never persisted, in any combination. */
  readonly hints?: {
    readonly geolocationCountryCode?: string | null;
    readonly ipCountryCode?: string | null;
    readonly localeCountryCode?: string | null;
    readonly browserTimezoneCountryCode?: string | null;
  };
}

/**
 * Decide the provider's market.
 *
 * Every candidate is checked against the ENABLED registry before it is
 * returned, at every level. A persisted country for a market the operator has
 * since switched off does not survive — it falls through to the next source,
 * and if nothing else answers the provider is asked again. That is deliberate:
 * a disabled market is one the platform can no longer serve, and continuing to
 * treat a stored value as authoritative would quietly keep a provider working
 * somewhere the operator has withdrawn from.
 */
export function resolveMarket(input: MarketResolutionInput): MarketResolution {
  const { markets } = input;

  const authoritative: readonly [string | null | undefined, MarketSource][] = [
    [input.persistedCountryCode, 'PERSISTED'],
    [input.confirmedCountryCode, 'CONFIRMED'],
    [input.resolvedAndConfirmedCountryCode, 'RESOLVED_AND_CONFIRMED'],
    [input.cookieCountryCode, 'COOKIE'],
  ];

  for (const [code, source] of authoritative) {
    const market = findEnabledMarket(markets, code);
    if (market) return { kind: 'RESOLVED', market, source };
  }

  // Hints, in descending confidence. A geolocation fix the user has NOT
  // confirmed sits here rather than above, which is the difference between
  // "we think you are in Sweden" and "you are in Sweden".
  const hints: readonly [string | null | undefined, MarketHintSource][] = [
    [input.hints?.geolocationCountryCode, 'GEOLOCATION'],
    [input.hints?.ipCountryCode, 'IP'],
    [input.hints?.localeCountryCode, 'LOCALE'],
    [input.hints?.browserTimezoneCountryCode, 'BROWSER_TIMEZONE'],
  ];

  for (const [code, source] of hints) {
    const market = findEnabledMarket(markets, code);
    if (market) return { kind: 'SUGGESTED', market, source };
  }

  return { kind: 'NONE' };
}

/**
 * The country a caller is allowed to WRITE, or null.
 *
 * The one function that turns a resolution into a persistable value, and the
 * only place the `RESOLVED`/`SUGGESTED` distinction is cashed in. Callers use
 * this rather than reading `.market` themselves, so "may I store this?" has a
 * single answer in one place instead of a condition repeated at every write.
 */
export function persistableCountryCode(resolution: MarketResolution): string | null {
  return resolution.kind === 'RESOLVED' ? resolution.market.countryCode : null;
}
