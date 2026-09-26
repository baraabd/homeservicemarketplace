import type { AppEnv } from './env.schema';

const BOOLEAN_WORDS = new Set(['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off']);

/** A deployment label cannot opt a process out of production safeguards. */
export function isHardenedRuntime(env: Pick<AppEnv, 'NODE_ENV' | 'APP_ENV'>): boolean {
  return env.NODE_ENV === 'production' || env.NODE_ENV === 'staging' ||
    env.APP_ENV === 'prod' || env.APP_ENV === 'staging';
}

function isOrigin(value: string, secure: boolean): boolean {
  try {
    const url = new URL(value);
    return (secure ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) &&
      !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === '' || url.pathname === '/') && !url.hostname.includes('*') &&
      url.origin !== 'null';
  } catch {
    return false;
  }
}

/** Errors name keys, never raw values, credentials, query strings or secrets. */
export function runtimeSafetyProblems(env: AppEnv, raw: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'boolean' || raw[key] === undefined) continue;
    const input = raw[key];
    if (typeof input !== 'boolean' &&
        (typeof input !== 'string' || !BOOLEAN_WORDS.has(input.toLowerCase()))) {
      issues.push(`${key}: use an explicit supported boolean; unknown values cannot disable a control`);
    }
  }
  const hardened = isHardenedRuntime(env);
  if ((env.APP_ENV === 'prod' || env.APP_ENV === 'staging') &&
      (env.NODE_ENV === 'development' || env.NODE_ENV === 'test')) {
    issues.push('NODE_ENV: must be production or staging for a hardened APP_ENV');
  }
  if (env.APP_ENV === 'prod' && env.NODE_ENV !== 'production') {
    issues.push('APP_ENV: prod requires NODE_ENV=production');
  }
  if (hardened && !env.COOKIE_SECURE) {
    issues.push('COOKIE_SECURE: must be true in production and staging');
  }
  if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
    issues.push('COOKIE_SAMESITE: none requires secure cookies');
  }
  if (env.CORS_ORIGINS.some((origin) => !isOrigin(origin, hardened))) {
    issues.push('CORS_ORIGINS: use exact origins without wildcards, credentials, paths or query strings; hardened origins require HTTPS');
  }
  if (hardened && env.EVIDENCE_SCANNER_DRIVER === 'test') {
    issues.push('EVIDENCE_SCANNER_DRIVER: a deterministic test scanner is forbidden in production and staging');
  }
  if (hardened && (env.EVIDENCE_SCAN_WORKER_ENABLED || env.VERIFICATION_ENFORCED)) {
    if (env.EVIDENCE_SCANNER_DRIVER !== 'clamav' || !env.CLAMAV_HOST?.trim()) {
      issues.push('EVIDENCE_SCANNER_DRIVER: active verification/scanning requires configured ClamAV');
    }
    if (env.VERIFICATION_ENFORCED && !env.EVIDENCE_SCAN_WORKER_ENABLED) {
      issues.push('EVIDENCE_SCAN_WORKER_ENABLED: verification enforcement requires the scan worker');
    }
  }
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET?.trim()) issues.push('S3_BUCKET: required when STORAGE_DRIVER=s3');
    if (hardened) {
      const buckets = [env.S3_BUCKET, env.S3_RESTRICTED_BUCKET, env.S3_PORTFOLIO_BUCKET];
      if (buckets.some((bucket) => !bucket?.trim()) || new Set(buckets).size !== 3) {
        issues.push('S3_RESTRICTED_BUCKET: public, restricted and portfolio staging buckets must be explicit and distinct');
      }
    }
    if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
      issues.push('S3_ACCESS_KEY_ID: provide both explicit S3 credentials or neither for workload identity');
    }
  }
  return issues;
}

/** Strict operator preflight. Boot safety is not a production-readiness certificate. */
export function deploymentReadinessProblems(env: AppEnv): string[] {
  const issues = runtimeSafetyProblems(env, {});
  if (env.NODE_ENV !== 'production' || !['prod', 'staging'].includes(env.APP_ENV)) {
    issues.push('NODE_ENV: deployment requires production with APP_ENV=prod or staging');
  }
  if (!env.FRONTEND_URL || !isOrigin(env.FRONTEND_URL, true)) {
    issues.push('FRONTEND_URL: deployment requires an explicit HTTPS web origin');
  }
  if (!env.SMTP_HOST?.trim()) issues.push('SMTP_HOST: deployment requires an actual mail transport');
  if (env.SMTP_FROM.endsWith('.local')) issues.push('SMTP_FROM: configure a verified deployment sender');
  if (!env.OUTBOX_WORKER_ENABLED) issues.push('OUTBOX_WORKER_ENABLED: deployment requires event delivery');
  if (env.STORAGE_DRIVER !== 's3') issues.push('STORAGE_DRIVER: the production topology requires durable S3-compatible storage');
  if (/(change.?me|dummy|example|test_test)/iu.test(env.JWT_ACCESS_SECRET) ||
      new Set(env.JWT_ACCESS_SECRET).size < 10 || env.JWT_ACCESS_SECRET.trim().length < 32) {
    issues.push('JWT_ACCESS_SECRET: replace placeholder or low-diversity secrets with a secret-manager generated value');
  }
  return issues;
}
