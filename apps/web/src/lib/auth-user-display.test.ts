import { describe, expect, it } from 'vitest';
import { authDisplayEmail, authDisplayInitials, authDisplayName } from './auth-user-display';

describe('auth-user-display', () => {
  it('prefers the authenticated user payload when names are present', () => {
    const user = {
      firstName: 'Mido',
      lastName: 'Midomido',
      email: 'mido.mido@gmail.com',
    };

    expect(authDisplayName(user, 'en')).toBe('Mido Midomido');
    expect(authDisplayEmail(user)).toBe('mido.mido@gmail.com');
    expect(authDisplayInitials(user)).toBe('MM');
  });

  it('falls back to email-derived initials when profile names are missing', () => {
    const user = {
      firstName: '',
      lastName: ' ',
      email: 'fix.now@example.com',
    };

    expect(authDisplayName(user, 'en')).toBe('Ahmed Al-Khalid');
    expect(authDisplayInitials(user)).toBe('FI');
  });

  it('returns the original static defaults when auth data is unavailable', () => {
    expect(authDisplayName(null, 'ar')).toBe('أحمد الخالد');
    expect(authDisplayEmail(null)).toBe('ahmed@fixnow.app');
    expect(authDisplayInitials(null)).toBe('AK');
  });
});
