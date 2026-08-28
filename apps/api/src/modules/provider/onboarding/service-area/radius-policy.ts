import type { ProviderTransportModeCode } from '@homeservicemarketplace/contracts';

// Sprint 9B.19 — how far we suggest a provider travels.
//
// WHY THIS IS NOT IN THE CLIENT
//
// "Walking is 3 km, a car is 25" looks like a constant and is not one. It is a
// MARKET judgement: 25 km by car is a suburb in one city and three cities in
// another, and the number that makes a provider's feed useful in Damascus is
// not the one that works in Dubai. Baked into React it takes a deploy to
// change and there is no record of who changed it or when; as a platform
// setting it is one admin edit and an audited row.
//
// So this module reads the operator's numbers and decides. It contains no
// distances of its own — every value here comes from settings, and the only
// thing that is hardcoded is which SETTING KEY belongs to which mode.
//
// WHAT A SUGGESTION IS
//
// A starting point the provider may lower. The only hard bounds are the
// configured floor and ceiling, and both are policy rather than UI constants:
// a client that invented its own would either refuse a radius the server
// accepts or offer one it is about to reject.

/** Which setting carries the suggestion for each mode.
 *
 *  A total map rather than a lookup with a fallback, so adding a transport
 *  mode to the enum without giving it a policy is a compile error rather than
 *  a provider silently getting the generic default. */
export const RADIUS_SETTING_BY_MODE: Record<ProviderTransportModeCode, string> = {
  ON_FOOT: 'provider_service_radius_on_foot_km',
  MOTORCYCLE: 'provider_service_radius_motorcycle_km',
  PUBLIC_TRANSPORT: 'provider_service_radius_public_transport_km',
  CAR: 'provider_service_radius_car_km',
  VAN: 'provider_service_radius_van_km',
  TRUCK: 'provider_service_radius_truck_km',
};

export const RADIUS_MAX_SETTING = 'provider_service_radius_max_km';
export const RADIUS_MIN_SETTING = 'provider_service_radius_min_km';

export interface RadiusPolicy {
  /** What we suggest, in km. Always within [minKm, maxKm]. */
  suggestedKm: number;
  /** The floor and the ceiling, both operator-configured. The ceiling is the
   *  only hard bound; the client renders it rather than inventing one. */
  minKm: number;
  maxKm: number;
  /**
   * The transport mode the suggestion was derived from, or null when the
   * provider has not told us how they travel.
   *
   * Returned so the UI can SAY why the number is what it is — "because you
   * said you drive" — rather than presenting an unexplained default that
   * looks arbitrary and gets ignored.
   */
  basedOn: ProviderTransportModeCode | null;
}

/** Reads one integer setting, falling back to the schema default. */
export type SettingReader = (key: string) => Promise<number>;

/**
 * The suggested radius for this provider.
 *
 * `primaryMode` is the provider's PRIMARY transport (Sprint 9B.18): the mode
 * they use most, not the fastest one they own. Suggesting a truck's radius to
 * someone who owns a truck but usually walks would fill their feed with jobs
 * they will not take.
 *
 * With no transport known the suggestion is the on-foot number — the most
 * conservative one — rather than a separate "default" setting nobody would
 * remember to tune. A provider who travels further will raise it; one who does
 * not was never going to be helped by a larger number.
 */
export async function resolveRadiusPolicy(
  primaryMode: ProviderTransportModeCode | null,
  read: SettingReader,
): Promise<RadiusPolicy> {
  const [minKm, maxKm] = await Promise.all([read(RADIUS_MIN_SETTING), read(RADIUS_MAX_SETTING)]);

  const key = primaryMode ? RADIUS_SETTING_BY_MODE[primaryMode] : RADIUS_SETTING_BY_MODE.ON_FOOT;
  const raw = await read(key);

  // An operator can set a per-mode suggestion outside the floor/ceiling — the
  // settings validate independently of each other. Clamping here means the
  // suggestion is always a value the provider is actually allowed to keep,
  // which is not true of the raw number.
  return {
    suggestedKm: clamp(raw, minKm, maxKm),
    minKm,
    maxKm,
    basedOn: primaryMode,
  };
}

/**
 * Is a radius the provider asked for allowed?
 *
 * Bounds come from the same policy the suggestion did, so the number the UI
 * offers and the number the server accepts cannot disagree. Returns the
 * refusal reason rather than a boolean: "too large" and "too small" need
 * different sentences, and one of them is the provider trying to be careful.
 */
export function checkRadius(
  km: number,
  policy: Pick<RadiusPolicy, 'minKm' | 'maxKm'>,
): { ok: true } | { ok: false; code: 'BELOW_MIN' | 'ABOVE_MAX' } {
  if (!Number.isFinite(km) || km < policy.minKm) return { ok: false, code: 'BELOW_MIN' };
  if (km > policy.maxKm) return { ok: false, code: 'ABOVE_MAX' };
  return { ok: true };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
