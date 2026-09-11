import { isValidTimezone, type SupportedMarket } from './supported-market';

// Sprint 09B.29 Phase 5 (C3) — which timezone a provider's hours are stored in.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// WHY THIS IS NOT ONE PLATFORM SETTING
//
// Because the platform is multi-country. A single platform-wide zone would
// silently shift every working-hours window a provider in another market
// entered, and they would have no way to see it happen — the UI never shows an
// IANA identifier.
//
// THE PRECEDENCE, AND WHY EACH STEP IS WHERE IT IS
//
//   1. an existing explicit provider timezone     never overwritten, ever
//   2. resolved from the confirmed work origin    the provider told us WHERE
//   3. the market's declared default              only if it declares one
//   4. ASK                                        anything else
//
// Step 3 is conditional on purpose. A market spanning several zones must not
// carry a default, because a default is indistinguishable from an answer; the
// registry leaves `defaultTimezone` undefined for those, and this policy then
// falls to `ASK` rather than guessing.
//
// The browser's timezone is absent from the list entirely. It may be shown as a
// suggestion by the UI, but it can never decide: a provider in Damascus setting
// up on a laptop still on European time would have every window shifted.

export type TimezoneDecision =
  | { readonly kind: 'KEEP'; readonly timezone: string }
  | { readonly kind: 'RESOLVED'; readonly timezone: string; readonly from: 'ORIGIN' | 'MARKET' }
  | { readonly kind: 'ASK'; readonly reason: 'AMBIGUOUS_MARKET' | 'NO_MARKET' };

export interface TimezoneInput {
  /** What is already stored against the provider. */
  readonly existingTimezone?: string | null;
  /** A zone derived from the confirmed work origin — a place id, a city, or
   *  coordinates the provider has confirmed. */
  readonly originTimezone?: string | null;
  /** The provider's confirmed market, if one has been resolved. */
  readonly market?: SupportedMarket | null;
}

/**
 * Decide the timezone, or decide to ask.
 *
 * Every candidate is validated against the runtime's IANA database before it is
 * returned, at every level — including the stored one. A profile carrying a
 * zone this runtime does not recognise (a legacy value, a hand-edited row, a
 * zone since retired) must not be treated as explicit, because storing hours
 * against it would produce times nobody can compute.
 */
/**
 * The zones a market declares, or an empty list when it declares none.
 *
 * `timezones` when present; otherwise the single-zone shorthand of
 * `defaultTimezone`; otherwise nothing. An empty result means "the operator
 * has not described this market's zones", which is a different statement from
 * "no zone is allowed" and is why callers must handle it explicitly.
 */
export function marketTimezones(market: SupportedMarket | null | undefined): readonly string[] {
  if (!market) return [];
  if (market.timezones && market.timezones.length > 0) return market.timezones;
  return isValidTimezone(market.defaultTimezone) ? [market.defaultTimezone] : [];
}

/** Why a chosen timezone was, or could not be, judged against a market. */
export type TimezoneCompatibility =
  /** The zone belongs to this market. */
  | { readonly kind: 'COMPATIBLE' }
  /** A real IANA zone, but not one of this market's. */
  | { readonly kind: 'NOT_IN_MARKET'; readonly allowed: readonly string[] }
  /** The market declares no zones, so nothing was checked. Reported rather
   *  than silently treated as a pass: a caller that accepts on this basis is
   *  accepting an unverified value and should say so in its own comment. */
  | { readonly kind: 'UNDECLARED' };

/**
 * Is this zone one the confirmed market permits?
 *
 * Sprint 09B.29 Phase 5 (C3). Valid IANA syntax is NOT the test. Every zone in
 * the database is syntactically valid, so a syntax check accepts Asia/Riyadh
 * for a provider in Sweden and stores a week nobody can read correctly.
 */
export function checkTimezoneAgainstMarket(
  timezone: string,
  market: SupportedMarket | null | undefined,
): TimezoneCompatibility {
  const allowed = marketTimezones(market);
  if (allowed.length === 0) return { kind: 'UNDECLARED' };
  return allowed.includes(timezone) ? { kind: 'COMPATIBLE' } : { kind: 'NOT_IN_MARKET', allowed };
}

export function decideTimezone(input: TimezoneInput): TimezoneDecision {
  // 1. An explicit, still-valid provider timezone is never overwritten —
  //    unless the market it belonged to is no longer the provider's.
  //
  //    Sprint 09B.29 Phase 5 (C3): a provider who moves from Sweden to Syria
  //    keeps Europe/Stockholm under a rule that only asks "is it a real
  //    zone?", and every hour they had entered silently means something else.
  //    A change of country therefore INVALIDATES a stored zone the new market
  //    does not declare, and the precedence continues below to resolve or ask.
  //
  //    A market that declares no zones cannot invalidate anything: there is
  //    nothing to compare against, and discarding a provider's explicit value
  //    on the strength of an unfinished registry would be worse than keeping
  //    it.
  if (isValidTimezone(input.existingTimezone)) {
    const compatibility = checkTimezoneAgainstMarket(input.existingTimezone, input.market);
    if (compatibility.kind !== 'NOT_IN_MARKET') {
      return { kind: 'KEEP', timezone: input.existingTimezone };
    }
  }

  // 2. Where they actually work beats where their market is centred. A
  //    provider in a border city is in their city's zone.
  if (isValidTimezone(input.originTimezone)) {
    return { kind: 'RESOLVED', timezone: input.originTimezone, from: 'ORIGIN' };
  }

  // 3. The market's own default, only when it declares one.
  const market = input.market ?? null;
  if (market && isValidTimezone(market.defaultTimezone)) {
    return { kind: 'RESOLVED', timezone: market.defaultTimezone, from: 'MARKET' };
  }

  // 4. Ask. The two reasons are distinguished so the UI can say either "which
  //    part of the country?" or "where do you work?", which are different
  //    questions with different answers.
  return { kind: 'ASK', reason: market ? 'AMBIGUOUS_MARKET' : 'NO_MARKET' };
}

/**
 * The timezone a caller may WRITE, or null when the provider must be asked.
 *
 * `KEEP` also returns null: the value is already stored and rewriting it would
 * be a no-op at best and an overwrite at worst. The single place the
 * never-overwrite rule is enforced, so it cannot be forgotten at a call site.
 */
export function persistableTimezone(decision: TimezoneDecision): string | null {
  return decision.kind === 'RESOLVED' ? decision.timezone : null;
}
