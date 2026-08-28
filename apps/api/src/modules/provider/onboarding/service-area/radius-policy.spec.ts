import { ADMIN_SETTINGS_SCHEMA } from '@homeservicemarketplace/contracts';

import {
  RADIUS_MAX_SETTING,
  RADIUS_MIN_SETTING,
  RADIUS_SETTING_BY_MODE,
  checkRadius,
  resolveRadiusPolicy,
} from './radius-policy';

// Sprint 9B.19 — the radius suggestion.
//
// The acceptance criterion is "policy-driven and auditable", so the tests are
// mostly about PROVENANCE: every number comes from a setting, every setting
// exists in the admin schema, and nothing in the resolution invents a distance
// of its own.

const defaults = new Map(ADMIN_SETTINGS_SCHEMA.map((f) => [f.key, f.default as number]));

/** Reads from the real schema defaults unless a test overrides a key. */
const reader =
  (over: Record<string, number> = {}) =>
  async (key: string) => {
    if (key in over) return over[key];
    const value = defaults.get(key);
    if (typeof value !== 'number') throw new Error(`no default for ${key}`);
    return value;
  };

describe('every mode has a real, auditable setting behind it', () => {
  it.each(Object.entries(RADIUS_SETTING_BY_MODE))(
    '%s reads from a key that exists in the admin schema',
    (_mode, key) => {
      expect(defaults.has(key)).toBe(true);
    },
  );

  it('the bounds are settings too, not constants', () => {
    expect(defaults.has(RADIUS_MIN_SETTING)).toBe(true);
    expect(defaults.has(RADIUS_MAX_SETTING)).toBe(true);
  });

  it('names a setting for EVERY transport mode', () => {
    // A total map: adding a mode without a policy would otherwise hand that
    // provider a silent generic default.
    const modes = ['ON_FOOT', 'MOTORCYCLE', 'PUBLIC_TRANSPORT', 'CAR', 'VAN', 'TRUCK'];
    expect(Object.keys(RADIUS_SETTING_BY_MODE).sort()).toEqual(modes.sort());
  });
});

describe('resolveRadiusPolicy', () => {
  it('suggests the number configured for the primary mode', async () => {
    const policy = await resolveRadiusPolicy('CAR', reader({ provider_service_radius_car_km: 30 }));
    expect(policy.suggestedKm).toBe(30);
    expect(policy.basedOn).toBe('CAR');
  });

  it('suggests a SMALLER radius on foot than by truck', async () => {
    // Not a hardcoded relationship — this asserts the shipped DEFAULTS are
    // sane, which is what an operator inherits before they tune anything.
    const foot = await resolveRadiusPolicy('ON_FOOT', reader());
    const truck = await resolveRadiusPolicy('TRUCK', reader());
    expect(foot.suggestedKm).toBeLessThan(truck.suggestedKm);
  });

  it('falls back to the most CONSERVATIVE suggestion when transport is unknown', async () => {
    // A provider who has not said how they travel is not helped by a large
    // number; they are helped by one they will raise if it is wrong.
    const unknown = await resolveRadiusPolicy(null, reader());
    const foot = await resolveRadiusPolicy('ON_FOOT', reader());
    expect(unknown.suggestedKm).toBe(foot.suggestedKm);
    // And says it was not based on anything, so the UI does not claim it was.
    expect(unknown.basedOn).toBeNull();
  });

  it('returns the operator floor and ceiling rather than inventing them', async () => {
    const policy = await resolveRadiusPolicy(
      'CAR',
      reader({ provider_service_radius_min_km: 2, provider_service_radius_max_km: 40 }),
    );
    expect(policy.minKm).toBe(2);
    expect(policy.maxKm).toBe(40);
  });

  it('CLAMPS a per-mode suggestion that an operator set above the ceiling', async () => {
    // The settings validate independently, so this combination is reachable.
    // An unclamped suggestion would be a number the provider is not allowed
    // to keep, offered to them as the default.
    const policy = await resolveRadiusPolicy(
      'TRUCK',
      reader({ provider_service_radius_truck_km: 400, provider_service_radius_max_km: 100 }),
    );
    expect(policy.suggestedKm).toBe(100);
  });

  it('clamps upward when a suggestion sits below the floor', async () => {
    const policy = await resolveRadiusPolicy(
      'ON_FOOT',
      reader({ provider_service_radius_on_foot_km: 1, provider_service_radius_min_km: 5 }),
    );
    expect(policy.suggestedKm).toBe(5);
  });

  it('changes when the provider changes transport', async () => {
    // The behaviour the screen depends on: switching from walking to a van
    // moves the suggestion, and the UI can say why.
    const foot = await resolveRadiusPolicy('ON_FOOT', reader());
    const van = await resolveRadiusPolicy('VAN', reader());
    expect(van.suggestedKm).not.toBe(foot.suggestedKm);
    expect(van.basedOn).toBe('VAN');
  });
});

describe('checkRadius — the bounds the server actually enforces', () => {
  const policy = { minKm: 1, maxKm: 100 };

  it('accepts a value the provider REDUCED below the suggestion', async () => {
    // The whole point of a suggestion: going lower is always allowed.
    expect(checkRadius(2, policy)).toEqual({ ok: true });
  });

  it('accepts both boundaries', () => {
    expect(checkRadius(1, policy)).toEqual({ ok: true });
    expect(checkRadius(100, policy)).toEqual({ ok: true });
  });

  it('refuses above the ceiling, and says which way it failed', () => {
    // "Too large" and "too small" need different sentences; one of them is a
    // provider being careful.
    expect(checkRadius(101, policy)).toEqual({ ok: false, code: 'ABOVE_MAX' });
  });

  it('refuses below the floor', () => {
    expect(checkRadius(0, policy)).toEqual({ ok: false, code: 'BELOW_MIN' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -5])('refuses the nonsense value %p', (n) => {
    expect(checkRadius(n, policy).ok).toBe(false);
  });

  it('the shipped ceiling stays within the matching blast radius', async () => {
    // MAX_SERVICE_AREA_RADIUS_KM exists so a hostile value cannot turn the
    // feed's bounding box into a table scan. A policy ceiling above it would
    // reintroduce exactly that.
    const { MAX_SERVICE_AREA_RADIUS_KM } = await import('../../../../shared/geo/service-area');
    expect(defaults.get(RADIUS_MAX_SETTING)).toBeLessThanOrEqual(MAX_SERVICE_AREA_RADIUS_KM);
  });
});
