// Safety tests for the admin password-reset DEV helper. Exercises the
// pure lib so no argon2 / Prisma / DB is needed. Pins the three rules the
// Sprint 01 hardening introduced:
//   - refuses to run in production
//   - the password is required (no baked-in default)
//   - the success output never carries the password

import { createRequire } from 'node:module';
import { join } from 'node:path';

// The helper is a repo-root .cjs outside the api tsconfig rootDir, so we
// load it through a runtime require rather than a typed import.
const requireCjs = createRequire(__filename);
const libPath = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'runtime',
  'reset-admin-password.lib.cjs',
);
const { assertNotProduction, resolveConfig, formatResult } = requireCjs(libPath) as {
  assertNotProduction: (env: Record<string, string | undefined>) => void;
  resolveConfig: (
    argv: string[],
    env: Record<string, string | undefined>,
  ) => { email: string; password: string };
  formatResult: (user: unknown) => { ok: true; user: unknown };
};

const argv = (...args: string[]) => ['node', 'reset-admin-password.cjs', ...args];

describe('reset-admin-password.lib', () => {
  describe('assertNotProduction', () => {
    it('throws when NODE_ENV=production (case-insensitive)', () => {
      expect(() => assertNotProduction({ NODE_ENV: 'production' })).toThrow(/production/i);
      expect(() => assertNotProduction({ NODE_ENV: 'Production' })).toThrow(/production/i);
    });

    it('allows non-production environments', () => {
      expect(() => assertNotProduction({ NODE_ENV: 'development' })).not.toThrow();
      expect(() => assertNotProduction({})).not.toThrow();
    });
  });

  describe('resolveConfig', () => {
    it('refuses to run in production before doing anything else', () => {
      expect(() => resolveConfig(argv('a@b.com', 'pw'), { NODE_ENV: 'production' })).toThrow(
        /production/i,
      );
    });

    it('requires a password argument — there is NO default password', () => {
      expect(() => resolveConfig(argv('a@b.com'), { NODE_ENV: 'development' })).toThrow(
        /password argument is required/i,
      );
      expect(() => resolveConfig(argv('a@b.com', ''), { NODE_ENV: 'development' })).toThrow(
        /password argument is required/i,
      );
    });

    it('returns the caller-supplied email + password', () => {
      const cfg = resolveConfig(argv('ops@example.com', 's3cret-value'), {
        NODE_ENV: 'development',
      });
      expect(cfg).toEqual({ email: 'ops@example.com', password: 's3cret-value' });
    });

    it('defaults only the email (never a secret), not the password', () => {
      const cfg = resolveConfig(argv(undefined as unknown as string, 'chosen-pw'), {
        NODE_ENV: 'test',
      });
      expect(cfg.email).toBe('admin@admin.com');
      expect(cfg.password).toBe('chosen-pw');
    });
  });

  describe('formatResult', () => {
    it('never includes the password in the output', () => {
      const out = formatResult({ id: 'u-1', email: 'a@b.com', status: 'ACTIVE' });
      const serialized = JSON.stringify(out);
      expect(serialized).not.toMatch(/password/i);
      expect(serialized).not.toContain('s3cret-value');
      expect(out).toEqual({ ok: true, user: { id: 'u-1', email: 'a@b.com', status: 'ACTIVE' } });
    });
  });
});
