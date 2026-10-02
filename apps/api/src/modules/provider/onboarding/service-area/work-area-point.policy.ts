import { marketContainsPoint, type SupportedMarket } from '../market/supported-market';

// R09 — the one rule for a provider's starting point.
//
// docs/production-readiness/r09/GEO_AUTHORITY_MATRIX.md
//
// WHY THIS EXISTS
//
// Matching is decided by the provider's point and radius whenever both exist
// (ADR 0003). Until R09 that point was accepted with a range check and nothing
// else, so three states could be stored that no screen described:
//
//   - a latitude with no longitude, which matching silently treats as "no
//     point" while the provider's map shows nothing either way;
//   - a point on another continent from the market the provider chose, so the
//     application said Syria and the feed was computed around the Sahara;
//   - the old market's point surviving a change of market.
//
// WHY IT IS A PURE FUNCTION
//
// Two routes write these columns: the onboarding step and the profile edit an
// approved provider uses afterwards. One decision, called by both, is what
// stops them drifting again.
//
// WHAT IT DOES NOT DO
//
// It does not compare the point to the CITY. A city here is free text with no
// geometry, and ADR 0003 deliberately lets a provider serve across a municipal
// boundary. The market envelope is the only geography the server holds.

export type WorkAreaPointRefusal = 'COORDINATES_INCOMPLETE' | 'POINT_OUTSIDE_MARKET';

export type WorkAreaPointVerdict =
  | {
      ok: true;
      /** Whether the columns must be written at all. */
      write: boolean;
      lat: number | null;
      lng: number | null;
      /** True when a STORED point was cleared because the market it was
       *  chosen in is no longer the provider's market. */
      invalidated: boolean;
    }
  | { ok: false; code: WorkAreaPointRefusal };

export interface WorkAreaPointInput {
  stored: { lat: number | null; lng: number | null };
  /** `undefined` means the request does not mention that coordinate. */
  requested: { lat?: number | null; lng?: number | null };
  /** The market the write will leave the provider in, or null when they have
   *  none. A market without `bounds` cannot judge a point. */
  market: Pick<SupportedMarket, 'bounds'> | null;
  /** Whether this same write moves the provider to a different market. */
  marketChanged: boolean;
}

export function resolveWorkAreaPoint(input: WorkAreaPointInput): WorkAreaPointVerdict {
  const { stored, requested, market, marketChanged } = input;
  const touched = requested.lat !== undefined || requested.lng !== undefined;

  if (touched) {
    const lat = requested.lat !== undefined ? requested.lat : stored.lat;
    const lng = requested.lng !== undefined ? requested.lng : stored.lng;
    // A point is two numbers or it is nothing.
    if ((lat === null) !== (lng === null)) return { ok: false, code: 'COORDINATES_INCOMPLETE' };
    if (
      lat !== null &&
      lng !== null &&
      market &&
      marketContainsPoint(market, { lat, lng }) === false
    ) {
      return { ok: false, code: 'POINT_OUTSIDE_MARKET' };
    }
    return { ok: true, write: true, lat, lng, invalidated: false };
  }

  // The request does not mention the point. It is left alone unless the
  // provider is moving to a market that the stored point is not in: keeping it
  // would leave their feed computed around the market they just left. The same
  // rule the stored timezone already follows.
  if (
    marketChanged &&
    market &&
    stored.lat !== null &&
    stored.lng !== null &&
    marketContainsPoint(market, { lat: stored.lat, lng: stored.lng }) === false
  ) {
    return { ok: true, write: true, lat: null, lng: null, invalidated: true };
  }

  return { ok: true, write: false, lat: stored.lat, lng: stored.lng, invalidated: false };
}

/** The sentence for each refusal. Kept beside the rule so both routes say the
 *  same thing. */
export const WORK_AREA_POINT_MESSAGE: Record<WorkAreaPointRefusal, string> = {
  COORDINATES_INCOMPLETE: 'A starting point needs both a latitude and a longitude.',
  POINT_OUTSIDE_MARKET:
    'That point is outside the country you selected. Choose a point inside it, or change the country.',
};
