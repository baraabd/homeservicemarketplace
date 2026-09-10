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
export function decideTimezone(input: TimezoneInput): TimezoneDecision {
  // 1. An explicit, still-valid provider timezone is never overwritten.
  if (isValidTimezone(input.existingTimezone)) {
    return { kind: 'KEEP', timezone: input.existingTimezone };
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
