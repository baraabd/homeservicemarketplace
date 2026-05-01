import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { api } from '../api';
import { getProfile, updateProfile } from './profile-api';

let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(api);
});
afterEach(() => {
  mock.restore();
});

const PROFILE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  displayName: 'Ada Lovelace',
  initials: 'AL',
  email: 'ada@example.com',
  phoneNumber: null,
  city: null,
  bio: null,
  avatarUrl: null,
  updatedAt: '2026-04-30T00:00:00.000Z',
};

describe('profile-api — getProfile', () => {
  it('GETs /v1/me/profile and unwraps the envelope', async () => {
    mock.onGet('/v1/me/profile').reply(200, { profile: PROFILE });
    const out = await getProfile();
    expect(out.profile.email).toBe('ada@example.com');
  });

  it('rejects on 5xx so React Query can surface an error state', async () => {
    mock.onGet('/v1/me/profile').reply(503, {});
    await expect(getProfile()).rejects.toBeDefined();
  });

  it('rejects on 401 (transparently refreshed by the interceptor in real flow)', async () => {
    mock.onGet('/v1/me/profile').reply(401, { error: { code: 'AUTH_INVALID_CREDENTIALS' } });
    await expect(getProfile()).rejects.toMatchObject({ response: { status: 401 } });
  });
});

describe('profile-api — updateProfile', () => {
  it('PATCHes /v1/me/profile with only the supplied fields', async () => {
    let postedBody: Record<string, unknown> = {};
    mock.onPatch('/v1/me/profile').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { profile: { ...PROFILE, firstName: 'Grace', lastName: 'Hopper' } }];
    });
    const out = await updateProfile({
      firstName: 'Grace',
      lastName: 'Hopper',
      city: 'Palo Alto',
    });
    expect(postedBody).toEqual({
      firstName: 'Grace',
      lastName: 'Hopper',
      city: 'Palo Alto',
    });
    // Critical: forbidden fields must not appear on the wire even if
    // the typed wrapper accepts them — callers should not pass them
    // and the contract type-system blocks it. Defensive assertions:
    expect(postedBody).not.toHaveProperty('email');
    expect(postedBody).not.toHaveProperty('userId');
    expect(postedBody).not.toHaveProperty('role');
    expect(postedBody).not.toHaveProperty('status');
    expect(postedBody).not.toHaveProperty('password');
    expect(out.profile.firstName).toBe('Grace');
  });

  it('propagates a 400 (validation) so the UI can surface a safe message', async () => {
    mock.onPatch('/v1/me/profile').reply(400, {
      error: { code: 'VALIDATION_ERROR' },
    });
    await expect(updateProfile({ bio: 'x'.repeat(501) })).rejects.toMatchObject({
      response: { status: 400 },
    });
  });

  it('sends null when caller wants to clear a field', async () => {
    let postedBody: Record<string, unknown> = {};
    mock.onPatch('/v1/me/profile').reply((config) => {
      postedBody = JSON.parse(config.data as string) as Record<string, unknown>;
      return [200, { profile: { ...PROFILE, phoneNumber: null, city: null } }];
    });
    await updateProfile({ phoneNumber: null, city: null, bio: null });
    expect(postedBody).toEqual({ phoneNumber: null, city: null, bio: null });
  });
});
