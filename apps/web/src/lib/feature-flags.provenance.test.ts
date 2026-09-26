import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProviderOnboardingV2Enabled, PROVIDER_ONBOARDING_V2_OVERRIDE_KEY as KEY, resolveProviderOnboardingV2Flag } from './feature-flags';
import { unobservedRouteFlagEvidence } from '../../e2e/provider-v2-flag-evidence';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('S06 actual V2 flag provenance', () => {
  it('records default-off without pretending an unconfigured build opted in', () => {
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', undefined);
    expect(resolveProviderOnboardingV2Flag()).toEqual({ enabled: false, source: 'default-off', key: 'VITE_PROVIDER_ONBOARDING_V2' });
  });
  it('records the exact real build key and agrees with the existing routing API', () => {
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', 'true');
    const result = resolveProviderOnboardingV2Flag();
    expect(result).toEqual({ enabled: true, source: 'build-env', key: 'VITE_PROVIDER_ONBOARDING_V2' });
    expect(isProviderOnboardingV2Enabled()).toBe(result.enabled);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each(['true', 'false'])('records browser override %s rather than the build it replaced', (value) => {
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', 'true');
    window.localStorage.setItem(KEY, value);
    expect(resolveProviderOnboardingV2Flag()).toEqual({ enabled: value === 'true', source: 'browser-override', key: KEY });
  });
  it('keeps the build fallback when storage is empty or unavailable', () => {
    vi.stubEnv('VITE_PROVIDER_ONBOARDING_V2', 'true');
    window.localStorage.setItem(KEY, '  ');
    expect(resolveProviderOnboardingV2Flag().source).toBe('build-env');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(resolveProviderOnboardingV2Flag()).toMatchObject({ enabled: true, source: 'build-env' });
  });
  it.each(['build-env:VITE_FF_PROVIDER_ONBOARDING_V2', 'build-env:VITE_PROVIDER_ONBOARDING_V2', 'browser-override:hsm.ff.providerOnboardingV2'])('never turns a self-declared source into a verified deployment claim: %s', (declared) => {
    expect(unobservedRouteFlagEvidence(declared)).toEqual({
      flagSource: 'unverified:effective-browser-source-not-captured',
      declaredFlagSource: declared,
      flagSourceVerified: false,
      browserOverrideAbsent: null,
      deploymentDefaultProven: false,
    });
  });
});
