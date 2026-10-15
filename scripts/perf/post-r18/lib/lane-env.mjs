// R27 — the one environment the measurement harnesses may target.
//
// Every value points at the disposable services in compose.r27.yml. The
// guard refuses anything else, so a harness can never seed, profile or reset
// the developer's database or a peer lane's stack by inheriting a stray
// DATABASE_URL. Workers are off so per-request statement counts measure the
// request alone; the report records that choice.

import { randomBytes } from 'node:crypto';

export const LANE = Object.freeze({
  databaseUrl: 'postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf',
  redisHost: '127.0.0.1',
  redisPort: 63797,
  smtpPort: 11027,
  mailpit: 'http://127.0.0.1:18027',
  apiPort: 4027,
  api: 'http://127.0.0.1:4027',
  webPorts: [4277, 4278],
});

/** Throws unless `url` names this lane's loopback database. */
export function assertLaneDatabase(url) {
  const parsed = new URL(url);
  if (
    !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
    parsed.port !== '54397' ||
    parsed.pathname !== '/hsm_r27_perf'
  ) {
    throw new Error('refusing to measure a database that is not the R27 lane database');
  }
  return url;
}

/**
 * Two profiles. `production` passes the API's production policy unchanged
 * (secure cookies, default throttles) and is used for boot timing, which needs
 * no session. `fixture` is the CI real-API profile (development mode,
 * loopback cookies, fixture-only throttle budgets) and is used where the
 * harness must sign in over plain-HTTP loopback.
 *
 * API process environment. `JWT_ACCESS_SECRET` is random per run and never
 * written anywhere. Only the listed keys are passed: the parent environment
 * (which may hold real credentials) is not inherited beyond PATH and the
 * Windows system variables Node needs to start.
 */
export function apiEnv({ profile = 'fixture', overrides = {} } = {}) {
  if (!['fixture', 'production'].includes(profile)) throw new Error(`unknown profile ${profile}`);
  const production = profile === 'production';
  const inherited = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  const origins = LANE.webPorts.map((port) => `http://127.0.0.1:${port}`).join(',');
  return {
    ...inherited,
    NODE_ENV: production ? 'production' : 'development',
    APP_ENV: 'test',
    PORT: String(LANE.apiPort),
    LOG_LEVEL: 'info',
    DATABASE_URL: assertLaneDatabase(LANE.databaseUrl),
    REDIS_HOST: LANE.redisHost,
    REDIS_PORT: String(LANE.redisPort),
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(LANE.smtpPort),
    SMTP_FROM: 'noreply@example.test',
    FRONTEND_URL: `http://127.0.0.1:${LANE.webPorts[0]}`,
    // The production policy requires HTTPS origins; boot timing serves no browser.
    CORS_ORIGINS: production ? 'https://app.r27.example.test' : origins,
    COOKIE_SECURE: production ? 'true' : 'false',
    COOKIE_SAMESITE: 'lax',
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
    JWT_ACCESS_TTL_SECONDS: '1800',
    AUTH_REQUIRE_EMAIL_VERIFICATION: 'true',
    // Fixture-only budgets for one shared loopback IP; account and auth
    // guards stay enabled. Production keeps the policy defaults.
    ...(production
      ? {}
      : {
          AUTH_REGISTER_THROTTLE_LIMIT: '1000',
          AUTH_OTP_VERIFY_THROTTLE_LIMIT: '1000',
          GLOBAL_THROTTLE_LIMIT: '100000',
        }),
    // Production policy requires ClamAV and the scan worker when verification is
    // enforced; the lane has no ClamAV, so the production boot profile runs with
    // verification enforcement off and says so in its report.
    VERIFICATION_ENFORCED: production ? 'false' : 'true',
    WORK_ACCESS_ENFORCED: 'true',
    OUTBOX_WORKER_ENABLED: 'false',
    DISPUTE_WORKER_ENABLED: 'false',
    VERIFICATION_EXPIRY_WORKER_ENABLED: 'false',
    EVIDENCE_SCAN_WORKER_ENABLED: 'false',
    PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED: 'false',
    ...overrides,
  };
}
