import { validateEnv } from './env.validation';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  MONGODB_URI: 'mongodb://localhost:27017',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  // IAM baseline: the env schema enforces JWT_ACCESS_SECRET >= 32 chars.
  JWT_ACCESS_SECRET: 'test_test_test_test_test_test_test_1234',
};

describe('validateEnv', () => {
  it('accepts a complete minimal env', () => {
    const env = validateEnv({ ...baseEnv });
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(4000);
    expect(env.REDIS_PORT).toBe(6379);
  });

  it('applies default values for optional vars', () => {
    const env = validateEnv({ ...baseEnv });
    expect(env.APP_ENV).toBe('dev');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.STARTUP_MAX_RETRIES).toBe(5);
    expect(env.STARTUP_RETRY_BASE_MS).toBe(200);
    expect(env.STARTUP_RETRY_CAP_MS).toBe(5000);
    expect(env.DATABASE_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS).toBe(5_000);
    expect(env.MONGODB_MAX_POOL_SIZE).toBe(20);
    expect(env.AUTH_ANTI_ENUM_DELAY_MS).toBe(200);
    expect(env.AUTH_REQUIRE_EMAIL_VERIFICATION).toBe(true);
  });

  describe('required vars', () => {
    it('throws when DATABASE_URL is missing', () => {
      const { DATABASE_URL: _unused, ...rest } = baseEnv;
      expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
    });

    it('throws when DATABASE_URL is an empty string', () => {
      expect(() => validateEnv({ ...baseEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    });

    // Sprint 4 — MONGODB_URI is no longer unconditionally required. It is
    // required exactly when MONGODB_ENABLED is true; see
    // docs/adr/0002-mongodb.md. The four cases below pin both halves of that
    // contract so neither can regress into the other.
    it('boots WITHOUT MONGODB_URI when Mongo is disabled (the default)', () => {
      const { MONGODB_URI: _unused, ...rest } = baseEnv;
      const env = validateEnv(rest);
      expect(env.MONGODB_ENABLED).toBe(false);
      expect(env.MONGODB_URI).toBeUndefined();
    });

    it('throws when MONGODB_ENABLED=true and MONGODB_URI is missing', () => {
      const { MONGODB_URI: _unused, ...rest } = baseEnv;
      expect(() => validateEnv({ ...rest, MONGODB_ENABLED: 'true' })).toThrow(/MONGODB_URI/);
    });

    it('throws when MONGODB_ENABLED=true and MONGODB_URI is an empty string', () => {
      expect(() => validateEnv({ ...baseEnv, MONGODB_ENABLED: 'true', MONGODB_URI: '' })).toThrow(
        /MONGODB_URI/,
      );
    });

    it('accepts MONGODB_ENABLED=true with a URI', () => {
      const env = validateEnv({ ...baseEnv, MONGODB_ENABLED: 'true' });
      expect(env.MONGODB_ENABLED).toBe(true);
      expect(env.MONGODB_URI).toBe('mongodb://localhost:27017');
    });

    it('aggregates multiple issues in a single error message', () => {
      try {
        validateEnv({ NODE_ENV: 'bogus' });
        fail('validateEnv should have thrown');
      } catch (err) {
        expect((err as Error).message).toMatch(/NODE_ENV/);
        expect((err as Error).message).toMatch(/DATABASE_URL/);
        // MONGODB_URI is deliberately NOT expected here any more: with Mongo
        // disabled by default, its absence is not an error.
        expect((err as Error).message).toMatch(/JWT_ACCESS_SECRET/);
      }
    });
  });

  describe('invalid values', () => {
    it('rejects an invalid NODE_ENV', () => {
      expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'bogus' })).toThrow(/NODE_ENV/);
    });

    it('rejects an invalid APP_ENV', () => {
      expect(() => validateEnv({ ...baseEnv, APP_ENV: 'bogus' })).toThrow(/APP_ENV/);
    });

    it('rejects a non-numeric PORT', () => {
      expect(() => validateEnv({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
    });

    it('rejects an out-of-range PORT (too high)', () => {
      expect(() => validateEnv({ ...baseEnv, PORT: '99999' })).toThrow(/PORT/);
    });

    it('rejects an out-of-range PORT (zero)', () => {
      expect(() => validateEnv({ ...baseEnv, PORT: '0' })).toThrow(/PORT/);
    });

    it('rejects an out-of-range REDIS_PORT', () => {
      expect(() => validateEnv({ ...baseEnv, REDIS_PORT: '99999' })).toThrow(/REDIS_PORT/);
    });

    it('rejects a zero STARTUP_MAX_RETRIES', () => {
      expect(() => validateEnv({ ...baseEnv, STARTUP_MAX_RETRIES: '0' })).toThrow(
        /STARTUP_MAX_RETRIES/,
      );
    });

    it('rejects an invalid LOG_LEVEL', () => {
      expect(() => validateEnv({ ...baseEnv, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
    });

    it('rejects an invalid FRONTEND_URL when present', () => {
      expect(() => validateEnv({ ...baseEnv, FRONTEND_URL: 'not-a-url' })).toThrow(/FRONTEND_URL/);
    });
  });

  describe('production-mode safety', () => {
    it('still requires DATABASE_URL in production', () => {
      expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    });

    it('refuses empty DATABASE_URL in production', () => {
      expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(
        /DATABASE_URL/,
      );
    });

    it('refuses empty MONGODB_URI in production', () => {
      expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production', MONGODB_URI: '' })).toThrow(
        /MONGODB_URI/,
      );
    });
  });

  describe('coercion helpers', () => {
    it('parses CORS_ORIGINS into an array', () => {
      const env = validateEnv({ ...baseEnv, CORS_ORIGINS: 'https://a.com, https://b.com' });
      expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    });

    it('CORS_ORIGINS defaults to empty array when absent', () => {
      const env = validateEnv({ ...baseEnv });
      expect(env.CORS_ORIGINS).toEqual([]);
    });

    it('coerces REDIS_TLS booleans from strings', () => {
      expect(validateEnv({ ...baseEnv, REDIS_TLS: 'true' }).REDIS_TLS).toBe(true);
      expect(validateEnv({ ...baseEnv, REDIS_TLS: 'off' }).REDIS_TLS).toBe(false);
      expect(validateEnv({ ...baseEnv, REDIS_TLS: '1' }).REDIS_TLS).toBe(true);
    });
  });

  it('strips genuinely unknown env vars', () => {
    const env = validateEnv({ ...baseEnv, NOT_A_REAL_VAR: 'x' });
    expect((env as Record<string, unknown>).NOT_A_REAL_VAR).toBeUndefined();
  });

  it('rejects JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...baseEnv, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  describe('mongo-specific validation', () => {
    it('rejects an empty MONGODB_DB_NAME', () => {
      expect(() => validateEnv({ ...baseEnv, MONGODB_DB_NAME: '' })).toThrow(/MONGODB_DB_NAME/);
    });

    it('rejects MONGODB_MAX_POOL_SIZE = 0', () => {
      expect(() => validateEnv({ ...baseEnv, MONGODB_MAX_POOL_SIZE: '0' })).toThrow(
        /MONGODB_MAX_POOL_SIZE/,
      );
    });

    it('rejects MONGODB_SERVER_SELECTION_TIMEOUT_MS = 0', () => {
      expect(() => validateEnv({ ...baseEnv, MONGODB_SERVER_SELECTION_TIMEOUT_MS: '0' })).toThrow(
        /MONGODB_SERVER_SELECTION_TIMEOUT_MS/,
      );
    });

    it('rejects non-numeric MONGODB_CONNECT_TIMEOUT_MS', () => {
      expect(() => validateEnv({ ...baseEnv, MONGODB_CONNECT_TIMEOUT_MS: 'soon' })).toThrow(
        /MONGODB_CONNECT_TIMEOUT_MS/,
      );
    });
  });

  describe('URL-shape behavior (current implementation — documents the gap)', () => {
    // The current zod schema enforces `.min(1)` on DATABASE_URL and MONGODB_URI,
    // not URL shape. These tests PIN that current behavior; tightening the
    // schema to enforce scheme or URL format is a deliberate deferred decision
    // (intended to ship alongside the auth-phase email normalization work).
    it('accepts a non-empty DATABASE_URL even if malformed', () => {
      const env = validateEnv({ ...baseEnv, DATABASE_URL: 'not-really-a-url' });
      expect(env.DATABASE_URL).toBe('not-really-a-url');
    });

    it('accepts a non-empty MONGODB_URI even if malformed', () => {
      const env = validateEnv({ ...baseEnv, MONGODB_URI: 'nope' });
      expect(env.MONGODB_URI).toBe('nope');
    });
  });

  // D-1 — the registration abuse budget is a security control, so a
  // permissive value must be unreachable in production/staging no matter what
  // an operator puts in the environment.
  describe('registration throttle hardening', () => {
    const prodEnv = { ...baseEnv, NODE_ENV: 'production' };

    it('defaults to 5 submissions per rolling hour', () => {
      const env = validateEnv({ ...baseEnv });
      expect(env.AUTH_REGISTER_THROTTLE_LIMIT).toBe(5);
      expect(env.AUTH_REGISTER_THROTTLE_TTL_SECONDS).toBe(3600);
    });

    it('accepts the maximum allowed limit in production', () => {
      const env = validateEnv({ ...prodEnv, AUTH_REGISTER_THROTTLE_LIMIT: '5' });
      expect(env.AUTH_REGISTER_THROTTLE_LIMIT).toBe(5);
    });

    it('accepts a TIGHTER limit in production', () => {
      const env = validateEnv({ ...prodEnv, AUTH_REGISTER_THROTTLE_LIMIT: '3' });
      expect(env.AUTH_REGISTER_THROTTLE_LIMIT).toBe(3);
    });

    it.each(['6', '50', '500'])(
      'REFUSES to boot production with AUTH_REGISTER_THROTTLE_LIMIT=%s',
      (limit) => {
        expect(() => validateEnv({ ...prodEnv, AUTH_REGISTER_THROTTLE_LIMIT: limit })).toThrow(
          /AUTH_REGISTER_THROTTLE_LIMIT/,
        );
      },
    );

    it('REFUSES to boot staging with a widened limit', () => {
      expect(() =>
        validateEnv({ ...baseEnv, NODE_ENV: 'staging', AUTH_REGISTER_THROTTLE_LIMIT: '500' }),
      ).toThrow(/AUTH_REGISTER_THROTTLE_LIMIT/);
    });

    it('allows a widened limit in development and test so suites are not throttled', () => {
      for (const nodeEnv of ['development', 'test']) {
        const env = validateEnv({
          ...baseEnv,
          NODE_ENV: nodeEnv,
          AUTH_REGISTER_THROTTLE_LIMIT: '500',
        });
        expect(env.AUTH_REGISTER_THROTTLE_LIMIT).toBe(500);
      }
    });

    it('REFUSES a production window shorter than an hour (an effectively disabled limit)', () => {
      expect(() => validateEnv({ ...prodEnv, AUTH_REGISTER_THROTTLE_TTL_SECONDS: '1' })).toThrow(
        /AUTH_REGISTER_THROTTLE_TTL_SECONDS/,
      );
    });

    it('REFUSES production with a per-instance (non-shared) throttle store', () => {
      expect(() => validateEnv({ ...prodEnv, THROTTLE_REDIS_REQUIRED: 'false' })).toThrow(
        /THROTTLE_REDIS_REQUIRED/,
      );
    });

    it('defaults the throttle store to the shared Redis one', () => {
      expect(validateEnv({ ...baseEnv }).THROTTLE_REDIS_REQUIRED).toBe(true);
    });
  });

  // D-1 — X-Forwarded-For must never be trusted blindly: each trusted hop
  // lets a client prepend one forged address and escape its rate-limit bucket.
  describe('trusted proxy depth', () => {
    it('defaults to 0 hops (X-Forwarded-For ignored)', () => {
      expect(validateEnv({ ...baseEnv }).TRUST_PROXY_HOPS).toBe(0);
    });

    it('accepts an explicit hop count', () => {
      expect(validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    });

    it('rejects a negative hop count', () => {
      expect(() => validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
    });

    it('rejects an implausibly deep proxy chain', () => {
      expect(() => validateEnv({ ...baseEnv, TRUST_PROXY_HOPS: '99' })).toThrow(/TRUST_PROXY_HOPS/);
    });
  });
});
