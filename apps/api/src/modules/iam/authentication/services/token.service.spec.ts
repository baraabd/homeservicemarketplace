import { JwtService } from '@nestjs/jwt';

import type { AppConfigService } from '../../../../config/app-config.service';
import { TokenService } from './token.service';

const SECRET = 'test_secret_at_least_32_characters_long_1234';

function mkConfig(overrides: Record<string, unknown> = {}): AppConfigService {
  const defaults: Record<string, unknown> = {
    JWT_ACCESS_SECRET: SECRET,
    JWT_ISSUER: 'hsm-api',
    JWT_AUDIENCE: 'hsm-clients',
    JWT_ACCESS_TTL_SECONDS: 600,
    JWT_REFRESH_TTL_DAYS: 30,
  };
  const values = { ...defaults, ...overrides };
  return { get: (k: string) => values[k] } as unknown as AppConfigService;
}

describe('TokenService', () => {
  const jwt = new JwtService({
    secret: SECRET,
    signOptions: { algorithm: 'HS256', issuer: 'hsm-api', audience: 'hsm-clients' },
    verifyOptions: { algorithms: ['HS256'], issuer: 'hsm-api', audience: 'hsm-clients' },
  });
  const svc = new TokenService(jwt, mkConfig());

  it('signs and verifies an access token with the expected claims', () => {
    const issued = svc.signAccessToken({
      userId: 'u1',
      sessionId: 's1',
      roles: ['customer'],
    });
    const claims = svc.verifyAccessToken(issued.token);
    expect(claims.sub).toBe('u1');
    expect(claims.sid).toBe('s1');
    expect(claims.roles).toEqual(['customer']);
    expect(claims.jti).toBe(issued.jti);
    expect(claims.iss).toBe('hsm-api');
    expect(claims.aud).toBe('hsm-clients');
  });

  it('rejects a tampered access token', () => {
    const { token } = svc.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    const tampered = token.slice(0, -4) + 'AAAA';
    expect(() => svc.verifyAccessToken(tampered)).toThrow();
  });

  it('mintRefreshToken returns distinct raw + sha256 hash', () => {
    const a = svc.mintRefreshToken();
    const b = svc.mintRefreshToken();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    // deterministic: the same raw hashes to the same hash
    expect(svc.hashRefreshToken(a.raw)).toBe(a.hash);
  });

  it('access-token claims contain ZERO PII — no email / firstName / lastName / phone', () => {
    // Regression guard: a refactor that puts the user object into the claims
    // (for "convenience") would silently leak PII to anyone holding a token.
    // Pin the closed claim set here.
    const issued = svc.signAccessToken({ userId: 'u-1', sessionId: 's-1', roles: ['customer'] });
    const claims = svc.verifyAccessToken(issued.token) as unknown as Record<string, unknown>;
    const allowed = new Set(['sub', 'sid', 'jti', 'roles', 'iat', 'exp', 'iss', 'aud', 'nbf']);
    for (const key of Object.keys(claims)) {
      expect(allowed.has(key)).toBe(true);
    }
    for (const forbidden of [
      'email',
      'firstName',
      'lastName',
      'phone',
      'passwordHash',
      'mfaSecret',
    ]) {
      expect(claims[forbidden]).toBeUndefined();
    }
  });

  it('refresh token expires in the configured window', () => {
    const issued = svc.mintRefreshToken();
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    const delta = issued.expiresAt.getTime() - Date.now();
    expect(delta).toBeGreaterThan(expectedMs - 5000);
    expect(delta).toBeLessThan(expectedMs + 5000);
  });
});
