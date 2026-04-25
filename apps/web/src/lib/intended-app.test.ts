import { describe, it, expect, beforeEach } from 'vitest';
import {
  INTENDED_APP_PATHS,
  clearIntendedApp,
  getIntendedApp,
  getIntendedAppPath,
  setIntendedApp,
} from './intended-app';

beforeEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('intended-app — single source of truth for launcher selection', () => {
  it('exposes the canonical path for each app', () => {
    expect(INTENDED_APP_PATHS).toEqual({
      seeker: '/home',
      provider: '/provider',
      admin: '/admin',
    });
  });

  it('round-trips the user choice through sessionStorage', () => {
    setIntendedApp('provider');
    expect(getIntendedApp()).toBe('provider');
    expect(getIntendedAppPath()).toBe('/provider');

    setIntendedApp('admin');
    expect(getIntendedAppPath()).toBe('/admin');

    setIntendedApp('seeker');
    expect(getIntendedAppPath()).toBe('/home');
  });

  it('falls back to /home (Seeker) when no intent has been recorded', () => {
    expect(getIntendedApp()).toBeNull();
    expect(getIntendedAppPath()).toBe('/home');
  });

  it('honors a custom fallback for callers who want non-Seeker default', () => {
    expect(getIntendedAppPath('/elsewhere')).toBe('/elsewhere');
  });

  it('clearIntendedApp removes the recorded intent', () => {
    setIntendedApp('provider');
    expect(getIntendedAppPath()).toBe('/provider');
    clearIntendedApp();
    expect(getIntendedAppPath()).toBe('/home');
  });

  it('rejects garbage values written into storage by other code', () => {
    sessionStorage.setItem('fixnow_intended_app', 'something-else');
    expect(getIntendedApp()).toBeNull();
    // …and getIntendedAppPath falls back rather than constructing a bad URL.
    expect(getIntendedAppPath()).toBe('/home');
  });
});
