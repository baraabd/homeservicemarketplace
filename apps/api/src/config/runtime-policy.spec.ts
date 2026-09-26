import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.validation';
import { deploymentReadinessProblems } from './runtime-policy';

const base = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
};
const deployed = {
  ...base,
  NODE_ENV: 'production', APP_ENV: 'prod',
  FRONTEND_URL: 'https://app.example.test',
  SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'noreply@example.test',
  STORAGE_DRIVER: 's3', S3_BUCKET: 'public',
  S3_RESTRICTED_BUCKET: 'restricted', S3_PORTFOLIO_BUCKET: 'portfolio-staging',
};

describe('S03 runtime safety', () => {
  it.each(['flase', 'tru', 'disabled', '', ' false ', ' true '])('rejects an unrecognised boolean %p instead of silently disabling a control', (value) => {
    expect(() => validateEnv({ ...base, WORK_ACCESS_ENFORCED: value })).toThrow(/WORK_ACCESS_ENFORCED/);
  });
  it.each(['true', 'TRUE', 'yes', '1', 'on', true])('preserves supported true spelling %p', (value) => {
    expect(validateEnv({ ...base, WORK_ACCESS_ENFORCED: value }).WORK_ACCESS_ENFORCED).toBe(true);
  });
  it.each(['false', 'FALSE', 'no', '0', 'off', false])('preserves supported false spelling %p', (value) => {
    expect(validateEnv({ ...base, WORK_ACCESS_ENFORCED: value }).WORK_ACCESS_ENFORCED).toBe(false);
  });
  it.each(['production', 'staging'])('refuses insecure cookies in %s', (NODE_ENV) => {
    expect(() => validateEnv({ ...base, NODE_ENV, COOKIE_SECURE: false })).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv({ ...base, NODE_ENV, EVIDENCE_SCANNER_DRIVER: 'test' })).toThrow(/EVIDENCE_SCANNER_DRIVER/);
  });
  it('does not permit APP_ENV to disguise a local runtime as production', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'prod' })).toThrow(/NODE_ENV/);
  });
  it('keeps plain HTTP cookies available locally, but not SameSite=None without Secure', () => {
    expect(validateEnv({ ...base, COOKIE_SECURE: false }).COOKIE_SECURE).toBe(false);
    expect(() => validateEnv({ ...base, COOKIE_SECURE: false, COOKIE_SAMESITE: 'none' })).toThrow(/COOKIE_SAMESITE/);
  });
  it.each(['*', 'https://*.example.test', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test?token=private', 'http://example.test', 'null'])('rejects unsafe production CORS origin %p', (origin) => {
    expect(() => validateEnv({ ...deployed, CORS_ORIGINS: origin })).toThrow(/CORS_ORIGINS/);
  });
  it('accepts exact HTTPS origins and the safe empty allowlist', () => {
    expect(validateEnv({ ...deployed, CORS_ORIGINS: 'https://app.example.test,https://admin.example.test' }).CORS_ORIGINS).toHaveLength(2);
    expect(validateEnv(deployed).CORS_ORIGINS).toEqual([]);
  });
  it('does not let active verification depend on an absent scanner or worker', () => {
    expect(() => validateEnv({ ...deployed, VERIFICATION_ENFORCED: true })).toThrow(/EVIDENCE_SCANNER_DRIVER/);
    expect(() => validateEnv({ ...deployed, VERIFICATION_ENFORCED: true, EVIDENCE_SCANNER_DRIVER: 'clamav', CLAMAV_HOST: 'scanner' })).toThrow(/EVIDENCE_SCAN_WORKER_ENABLED/);
    expect(() => validateEnv({ ...deployed, VERIFICATION_ENFORCED: true, EVIDENCE_SCANNER_DRIVER: 'clamav', CLAMAV_HOST: 'scanner', EVIDENCE_SCAN_WORKER_ENABLED: true })).not.toThrow();
  });
  it('requires explicit distinct S3 buckets and a complete credential pair', () => {
    expect(() => validateEnv({ ...deployed, S3_BUCKET: '' })).toThrow(/S3_BUCKET/);
    expect(() => validateEnv({ ...deployed, S3_RESTRICTED_BUCKET: 'public' })).toThrow(/S3_RESTRICTED_BUCKET/);
    expect(() => validateEnv({ ...deployed, S3_PORTFOLIO_BUCKET: undefined })).toThrow(/S3_RESTRICTED_BUCKET/);
    expect(() => validateEnv({ ...deployed, S3_ACCESS_KEY_ID: 'only-one-half' })).toThrow(/S3_ACCESS_KEY_ID/);
  });
  it('never echoes CORS credential or flag values in its error', () => {
    try {
      validateEnv({ ...deployed, CORS_ORIGINS: 'https://private-user:private-password@example.test' });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(String(error)).toContain('CORS_ORIGINS');
      expect(String(error)).not.toContain('private-user');
      expect(String(error)).not.toContain('private-password');
    }
  });
});

describe('S03 deployment preflight', () => {
  it('accepts a configured reference topology without enabling verification or money', () => {
    expect(deploymentReadinessProblems(validateEnv(deployed))).toEqual([]);
    expect(validateEnv(deployed).VERIFICATION_ENFORCED).toBe(false);
  });
  it.each([
    { STORAGE_DRIVER: 'local' },
    { SMTP_HOST: '' },
    { SMTP_FROM: 'noreply@deployment.local' },
    { FRONTEND_URL: 'http://example.test' },
    { OUTBOX_WORKER_ENABLED: false },
    { JWT_ACCESS_SECRET: 'ci_only_dummy_secret_at_least_32_chars_long' },
    { JWT_ACCESS_SECRET: 'x'.repeat(64) },
  ])('rejects a bootable but not deployable configuration %p', (override) => {
    expect(deploymentReadinessProblems(validateEnv({ ...deployed, ...override })).length).toBeGreaterThan(0);
  });
});
