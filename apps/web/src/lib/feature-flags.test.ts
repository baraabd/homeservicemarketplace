import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  PROVIDER_ONBOARDING_V2_OVERRIDE_KEY as KEY,
  isProviderOnboardingV2Enabled,
} from './feature-flags';

// Sprint 9B.16 — the flag.
//
// The single most important assertion in this file is the first one: with
// nothing configured, the answer is FALSE. The flag is the rollback for a
// half-built journey, and a flag that defaults on is not one.

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllEnvs();
});

describe('isProviderOnboardingV2Enabled', () => {
  it('is OFF when nothing is configured', () => {
    expect(isProviderOnboardingV2Enabled()).toBe(false);
  });

  it('is OFF for a build-time value that is not a truthy spelling', () => {
    for (const value of ['false', '0', 'off', '', 'maybe']) {
      vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', value);
      expect(isProviderOnboardingV2Enabled(), `env=${value}`).toBe(false);
    }
  });

  it.each(['true', '1', 'on', 'yes', 'TRUE', ' true '])(
    'is ON for the build-time value %j',
    (value) => {
      vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', value);
      expect(isProviderOnboardingV2Enabled()).toBe(true);
    },
  );

  it('lets a browser opt IN when the deployment default is off', () => {
    window.localStorage.setItem(KEY, 'true');
    expect(isProviderOnboardingV2Enabled()).toBe(true);
  });

  it('lets a browser opt OUT when the deployment default is on', () => {
    // Both directions, so the override is a genuine escape hatch and not just
    // an on-switch: a provider who hits a problem can get back to the wizard.
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', 'true');
    window.localStorage.setItem(KEY, 'false');
    expect(isProviderOnboardingV2Enabled()).toBe(false);
  });

  it('ignores an empty override and falls back to the deployment default', () => {
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', 'true');
    window.localStorage.setItem(KEY, '   ');
    expect(isProviderOnboardingV2Enabled()).toBe(true);
  });

  it('does not throw when localStorage is unavailable', () => {
    // Safari private mode THROWS on access. A flag read must never be the
    // thing that takes down a render.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data blocked');
    });
    expect(() => isProviderOnboardingV2Enabled()).not.toThrow();
    expect(isProviderOnboardingV2Enabled()).toBe(false);
    spy.mockRestore();
  });
});
