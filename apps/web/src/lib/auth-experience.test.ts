import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUTH_EXPERIENCES,
  DEFAULT_EXPERIENCE_ID,
  SELECT_PATH,
  getExperienceForIntendedApp,
  getExperienceForReturnTo,
  resolveAuthExperience,
  resolvePostAuthDestination,
} from './auth-experience';
import { setIntendedApp, clearIntendedApp } from './intended-app';

beforeEach(() => {
  clearIntendedApp();
});

describe('AUTH_EXPERIENCES — visual config integrity', () => {
  it('declares all three apps with non-empty theme + brand fields', () => {
    for (const id of ['seeker', 'provider', 'admin'] as const) {
      const exp = AUTH_EXPERIENCES[id];
      expect(exp.id).toBe(id);
      expect(exp.path).toMatch(/^\//);
      expect(exp.gradient).toContain('from-');
      expect(exp.classes.accentBg).toBeTruthy();
      expect(exp.classes.accentText).toBeTruthy();
      expect(exp.brand.title).toBeTruthy();
      expect(exp.brand.subtitle).toBeTruthy();
    }
  });

  it('seeker stays on the historical orange identity (regression guard)', () => {
    const seeker = AUTH_EXPERIENCES.seeker;
    expect(seeker.gradient).toMatch(/amber/);
    expect(seeker.classes.accentBg).toMatch(/amber/);
    expect(seeker.path).toBe('/home');
  });

  it('provider uses the blue/indigo/purple identity from /select', () => {
    const provider = AUTH_EXPERIENCES.provider;
    // Match the AppSelector card gradient so the visual stays consistent
    // from launcher → login → app shell.
    expect(provider.gradient).toMatch(/blue|indigo|purple/);
    expect(provider.classes.accentBg).not.toMatch(/amber/);
    expect(provider.path).toBe('/provider');
  });

  it('admin uses the slate identity', () => {
    const admin = AUTH_EXPERIENCES.admin;
    expect(admin.gradient).toMatch(/slate/);
    expect(admin.classes.accentBg).toMatch(/slate/);
    expect(admin.path).toBe('/admin');
  });
});

describe('getExperienceForReturnTo — prefix match against in-app paths', () => {
  it('returns seeker for /home and nested seeker URLs', () => {
    expect(getExperienceForReturnTo('/home')).toBe('seeker');
    expect(getExperienceForReturnTo('/home/profile')).toBe('seeker');
  });

  it('returns provider for /provider and nested provider URLs', () => {
    expect(getExperienceForReturnTo('/provider')).toBe('provider');
    expect(getExperienceForReturnTo('/provider/jobs')).toBe('provider');
  });

  it('returns admin for /admin and nested admin URLs', () => {
    expect(getExperienceForReturnTo('/admin')).toBe('admin');
    expect(getExperienceForReturnTo('/admin/users')).toBe('admin');
  });

  it('returns null for unknown paths and bogus inputs', () => {
    expect(getExperienceForReturnTo('/elsewhere')).toBeNull();
    expect(getExperienceForReturnTo(null)).toBeNull();
    expect(getExperienceForReturnTo(undefined)).toBeNull();
    expect(getExperienceForReturnTo('')).toBeNull();
  });

  it('refuses to map external or protocol-relative URLs (defence vs. open-redirect)', () => {
    expect(getExperienceForReturnTo('//evil.com/home')).toBeNull();
    expect(getExperienceForReturnTo('https://evil.com/home')).toBeNull();
  });
});

describe('getExperienceForIntendedApp — sessionStorage round-trip', () => {
  it('returns the recorded intent', () => {
    setIntendedApp('provider');
    expect(getExperienceForIntendedApp()).toBe('provider');
    setIntendedApp('admin');
    expect(getExperienceForIntendedApp()).toBe('admin');
  });

  it('returns null when no intent is recorded', () => {
    expect(getExperienceForIntendedApp()).toBeNull();
  });
});

describe('resolveAuthExperience — precedence order', () => {
  it('explicit override wins over every other signal', () => {
    setIntendedApp('admin');
    const exp = resolveAuthExperience({
      explicit: 'provider',
      returnTo: '/home',
      intentApp: 'admin',
    });
    expect(exp.id).toBe('provider');
  });

  it('returnTo wins over sessionStorage intent', () => {
    setIntendedApp('admin');
    const exp = resolveAuthExperience({ returnTo: '/provider' });
    expect(exp.id).toBe('provider');
  });

  it('intentApp argument is honoured even without sessionStorage', () => {
    const exp = resolveAuthExperience({ intentApp: 'admin' });
    expect(exp.id).toBe('admin');
  });

  it('falls back to sessionStorage intent when no other signal exists', () => {
    setIntendedApp('provider');
    const exp = resolveAuthExperience({});
    expect(exp.id).toBe('provider');
  });

  it('returns the seeker default when nothing matches', () => {
    const exp = resolveAuthExperience({});
    expect(exp.id).toBe(DEFAULT_EXPERIENCE_ID);
    expect(exp.id).toBe('seeker');
  });

  it('rejects garbage explicit values and falls through to next signal', () => {
    setIntendedApp('provider');
    const exp = resolveAuthExperience({
      explicit: 'banana' as never,
    });
    expect(exp.id).toBe('provider');
  });
});

describe('resolvePostAuthDestination — multi-role precedence', () => {
  it('returnTo wins over every other signal', () => {
    setIntendedApp('provider');
    const dest = resolvePostAuthDestination({
      returnTo: '/home/somewhere',
      intentApp: 'admin',
      userRoles: ['customer', 'provider', 'admin'],
    });
    expect(dest).toBe('/home/somewhere');
  });

  it('intentApp wins over role inference', () => {
    const dest = resolvePostAuthDestination({
      intentApp: 'provider',
      userRoles: ['customer', 'admin'],
    });
    expect(dest).toBe('/provider');
  });

  it('falls back to sessionStorage intent when no intentApp argument is passed', () => {
    setIntendedApp('admin');
    const dest = resolvePostAuthDestination({ userRoles: ['customer', 'provider'] });
    expect(dest).toBe('/admin');
  });

  it('routes a sole-provider user with no intent to /provider', () => {
    const dest = resolvePostAuthDestination({ userRoles: ['customer', 'provider'] });
    expect(dest).toBe('/provider');
  });

  it('routes a sole-admin user with no intent to /admin', () => {
    const dest = resolvePostAuthDestination({ userRoles: ['customer', 'admin'] });
    expect(dest).toBe('/admin');
  });

  it('routes a multi-role user (provider + admin) with no intent to /select', () => {
    const dest = resolvePostAuthDestination({ userRoles: ['customer', 'provider', 'admin'] });
    expect(dest).toBe(SELECT_PATH);
  });

  it('routes a customer-only user with no intent to /home', () => {
    const dest = resolvePostAuthDestination({ userRoles: ['customer'] });
    expect(dest).toBe('/home');
  });

  it('routes a user with no roles array to /home', () => {
    const dest = resolvePostAuthDestination({});
    expect(dest).toBe('/home');
  });

  it('does not crash on null roles', () => {
    const dest = resolvePostAuthDestination({ userRoles: null });
    expect(dest).toBe('/home');
  });

  // ── experienceId fallback (patch 2) ──────────────────────────────────────
  it('experienceId is honoured when neither returnTo nor intent exists', () => {
    // Intent has been cleared (e.g. Provider signup OTP closure). The
    // experience the screen was themed as becomes the destination.
    const dest = resolvePostAuthDestination({
      experienceId: 'provider',
      userRoles: ['customer'],
    });
    expect(dest).toBe('/provider');
  });

  it('experienceId admin → /admin', () => {
    const dest = resolvePostAuthDestination({
      experienceId: 'admin',
      userRoles: ['customer'],
    });
    expect(dest).toBe('/admin');
  });

  it('experienceId still loses to returnTo', () => {
    const dest = resolvePostAuthDestination({
      returnTo: '/home/profile',
      experienceId: 'provider',
      userRoles: ['customer'],
    });
    expect(dest).toBe('/home/profile');
  });

  it('experienceId still loses to intent', () => {
    const dest = resolvePostAuthDestination({
      intentApp: 'admin',
      experienceId: 'provider',
      userRoles: ['customer'],
    });
    expect(dest).toBe('/admin');
  });

  it('experienceId beats role inference (the regression this fix repairs)', () => {
    // A brand new customer-only user signing up from a Provider-themed
    // signup flow MUST land on /provider, not /home.
    const dest = resolvePostAuthDestination({
      experienceId: 'provider',
      userRoles: ['customer'],
    });
    expect(dest).not.toBe('/home');
    expect(dest).toBe('/provider');
  });
});
