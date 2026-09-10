// Sprint 09B.29 Phase 5 — turning coordinates into a market, behind a port.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// WHY A PORT RATHER THAN AN SDK CALL
//
// Reverse geocoding is the one part of market resolution that needs a third
// party, and the decision is explicit that onboarding policy must not be
// coupled to a vendor SDK. A port keeps three things true:
//
//   · the policy is testable with a deterministic fake, so no canonical test
//     ever reaches an external service;
//   · swapping or removing a vendor is an adapter change, not an onboarding
//     change;
//   · the failure modes are OURS to name. A vendor's timeout, rate limit and
//     500 all become the same `LocationResolutionFailure`, and the caller
//     handles one shape rather than a vendor's.
//
// NO VENDOR IS SELECTED HERE. The decision requires a stop before choosing one,
// so this repository ships the port, the validation, and a deterministic fake.
// The production adapter is a separate, explicitly authorised piece of work.
//
// WHAT THIS IS NOT
//
// Authorization, and not identity. A resolved country is a SUGGESTION until the
// provider confirms it — see `market-resolution.policy.ts`, where a geocoder
// answer that has not been confirmed can only ever produce `SUGGESTED`. Nothing
// downstream may treat a coordinate as proof of who someone is or what they may
// do.

/** How much the resolver trusts its own answer. */
export type LocationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface MarketLocationInput {
  readonly latitude: number;
  readonly longitude: number;
  /** GPS accuracy radius, when the browser reported one. A 5 km accuracy near
   *  a border is not a country answer, and the adapter may say so by lowering
   *  its confidence. */
  readonly accuracyMeters?: number;
}

export interface MarketLocationResult {
  /** ISO 3166-1 alpha-2, uppercase. Still validated against the registry by
   *  the caller — a resolver saying "GB" does not make GB a market. */
  readonly countryCode: string;
  /** An IANA identifier, when the resolver knows one. */
  readonly timezone?: string;
  readonly confidence: LocationConfidence;
}

/** Why a resolution did not produce a country. Every one of these ends the same
 *  way in the UI — offer manual selection — but they are distinguished so the
 *  logs can tell an outage from a provider standing in the sea. */
export type LocationFailureReason =
  | 'INVALID_COORDINATES'
  | 'UNRESOLVED'
  | 'TIMEOUT'
  | 'UNAVAILABLE';

export class LocationResolutionFailure extends Error {
  constructor(
    readonly reason: LocationFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'LocationResolutionFailure';
  }
}

/**
 * The port. One method, because there is one question.
 *
 * Implementations MUST NOT log precise coordinates, credentials, or a complete
 * third-party response, and MUST apply their own bounded timeout — a hanging
 * geocoder must not become a hanging onboarding request.
 */
export abstract class MarketLocationResolverPort {
  abstract resolve(input: MarketLocationInput): Promise<MarketLocationResult>;
}

/** DI token, following the repository's `*_PORT` convention. */
export const MARKET_LOCATION_RESOLVER_PORT = Symbol('HSM_MARKET_LOCATION_RESOLVER_PORT');

/**
 * Are these coordinates even coordinates?
 *
 * Checked before anything is sent anywhere, so a malformed or hostile payload
 * costs a vendor call rather than being forwarded to one. `Number.isFinite`
 * rejects NaN and both infinities, which `>=`/`<=` alone would not.
 */
export function areValidCoordinates(input: {
  latitude: unknown;
  longitude: unknown;
}): input is { latitude: number; longitude: number } {
  const { latitude, longitude } = input;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
