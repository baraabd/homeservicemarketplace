import { redactSensitive } from './admin-audit-redaction';

describe('redactSensitive', () => {
  it('redacts password / token / secret / jwt / apikey / cookie / database_url keys', () => {
    const out = redactSensitive({
      passwordHash: 'h',
      refreshToken: 'r',
      accessToken: 'a',
      JWT_SECRET: 's',
      DATABASE_URL: 'u',
      stripeSecretKey: 'k',
      apiKey: 'k',
      cookie: 'c',
      safeField: 'visible',
    });
    expect(out).toEqual({
      passwordHash: '<redacted>',
      refreshToken: '<redacted>',
      accessToken: '<redacted>',
      JWT_SECRET: '<redacted>',
      DATABASE_URL: '<redacted>',
      stripeSecretKey: '<redacted>',
      apiKey: '<redacted>',
      cookie: '<redacted>',
      safeField: 'visible',
    });
  });

  it('redacts case-insensitively', () => {
    expect(redactSensitive({ Password: 'x', JwT: 'y' })).toEqual({
      Password: '<redacted>',
      JwT: '<redacted>',
    });
  });

  it('walks nested objects', () => {
    const out = redactSensitive({
      level1: {
        level2: {
          previousValue: { password: 'h' },
          newValue: { password: 'h2' },
        },
      },
      ok: { value: 'visible' },
    });
    expect(out).toEqual({
      level1: {
        level2: { previousValue: { password: '<redacted>' }, newValue: { password: '<redacted>' } },
      },
      ok: { value: 'visible' },
    });
  });

  it('walks arrays', () => {
    const out = redactSensitive([{ token: 't' }, { ok: 'v' }]);
    expect(out).toEqual([{ token: '<redacted>' }, { ok: 'v' }]);
  });

  it('passes through primitives unchanged', () => {
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(undefined)).toBeUndefined();
  });

  it('redacts long strings whose value contains a sensitive marker', () => {
    const out = redactSensitive({
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.foo.bar',
      shortSafe: 'Bearer',
    });
    // The bearer-prefixed long string must be redacted (the key
    // doesn't match the sensitive regex on its own, but the value
    // does — long form). The short "Bearer" string passes through
    // because it's < 32 chars (doesn't look like an actual token).
    expect((out as Record<string, string>).authorization).toBe('<redacted>');
    expect((out as Record<string, string>).shortSafe).toBe('Bearer');
  });
});
