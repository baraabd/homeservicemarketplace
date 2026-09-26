import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeAuthReturnTo } from './auth-return-to';
import { getExperienceForReturnTo, resolvePostAuthDestination } from './auth-experience';
import { clearIntendedApp } from './intended-app';

beforeEach(() => clearIntendedApp());

const rejected = [
  undefined, null, 1, {}, '', 'https://other.example/home', '//other.example/home',
  '/\\other.example/home', '/%5cother.example/home', '/%2fother.example/home',
  '/\n/other.example', '/%09/other.example', '/broken%zz',
  '/login', '/login?returnTo=/home#otp', '/login/', '/signup', '/forgot-password',
  '/check-email', '/verify-email?token=synthetic', '/reset-password?token=synthetic',
  '/provider/../login', '/%6cogin', '/home/%2e%2e/login',
];

describe('S04 shared post-auth return boundary', () => {
  it.each(rejected)('refuses an unsafe, malformed or looping target %p', (raw) => {
    expect(sanitizeAuthReturnTo(raw)).toBeNull();
    expect(resolvePostAuthDestination({ returnTo: raw as string, intentApp: 'seeker' })).toBe('/home');
  });

  it.each(['/home/bookings?tab=upcoming#top', '/provider?tab=jobs#new', '/admin/users?page=2', '/disputes/example?view=history', '/select', '/'])('preserves the complete valid deep link %s', (raw) => {
    expect(sanitizeAuthReturnTo(raw)).toBe(raw);
    expect(resolvePostAuthDestination({ returnTo: raw, userRoles: ['customer'] })).toBe(raw);
  });

  it('falls through to the intended app rather than trusting a hostile target', () => {
    expect(resolvePostAuthDestination({ returnTo: '//other.example', intentApp: 'provider' })).toBe('/provider');
  });

  it('uses the pathname when resolving query-bearing Provider/Admin themes', () => {
    expect(getExperienceForReturnTo('/provider?tab=jobs#new')).toBe('provider');
    expect(getExperienceForReturnTo('/admin?page=2')).toBe('admin');
    expect(getExperienceForReturnTo('/home?tab=bookings')).toBe('seeker');
  });

  it('does not reject a harmless encoded URL in a query value', () => {
    const raw = '/home?reference=https%3A%2F%2Fexample.test%2Finfo';
    expect(sanitizeAuthReturnTo(raw)).toBe(raw);
  });

  it('does not confuse route prefixes with app identities', () => {
    expect(getExperienceForReturnTo('/administrator')).toBeNull();
    expect(getExperienceForReturnTo('/provider-other')).toBeNull();
  });
});
