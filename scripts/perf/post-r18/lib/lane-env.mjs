// R27 — the one environment the measurement harnesses may target.
//
// Every value points at the disposable services in compose.r27.yml. The
// guard refuses anything else, so a harness can never seed, profile or reset
// the developer's database or a peer lane's stack by inheriting a stray
// DATABASE_URL. Workers are off so per-request statement counts measure the
// request alone; the report records that choice.

import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const LANE = Object.freeze({
  databaseUrl: 'postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf',
  redisHost: '127.0.0.1',
  redisPort: 63797,
  smtpPort: 11027,
  mailpit: 'http://127.0.0.1:18027',
  apiPort: 4327,
  api: 'http://127.0.0.1:4327',
  webPorts: [5327, 5427],
});

/** Throws unless `url` names this lane's loopback database. */
export function assertLaneDatabase(url) {
  // Query options and alternate credentials/protocols can redirect connections.
  if (url !== LANE.databaseUrl) {
    throw new Error('refusing to measure a database that is not the R27 lane database');
  }
  return url;
}

const SERVICES = {
  postgres: { containerPort: '5432/tcp', hostPort: '54397' },
  redis: { containerPort: '6379/tcp', hostPort: '63797' },
  mailpit: { containerPort: '1025/tcp', hostPort: '11027' },
};

/** Check identity before fixture writes, database reset or Redis flush. */
export function verifyLaneContainer(service, container) {
  const expected = SERVICES[service];
  const labels = container?.Config?.Labels ?? {};
  const ports = container?.HostConfig?.PortBindings?.[expected?.containerPort];
  if (
    !expected ||
    container.Name !== '/hsm-r27-perf-' + service ||
    labels['com.docker.compose.project'] !== 'hsm-r27-perf' ||
    labels['com.docker.compose.service'] !== service ||
    labels['hsm.r27.disposable'] !== 'true' ||
    container.State?.Running !== true ||
    ports?.length !== 1 ||
    ports[0].HostIp !== '127.0.0.1' ||
    ports[0].HostPort !== expected.hostPort ||
    container.Mounts?.some((mount) => mount.Type === 'bind')
  ) {
    throw new Error('refusing unverified R27 ' + service + ' container');
  }
  if (service === 'postgres') {
    const env = new Set(container.Config.Env ?? []);
    if (!env.has('POSTGRES_USER=r27') || !env.has('POSTGRES_DB=hsm_r27_perf')) {
      throw new Error('refusing a different database identity');
    }
  }
}

export function assertLaneService(service) {
  if (!Object.hasOwn(SERVICES, service)) throw new Error('unknown R27 service');
  const result = execFileSync('docker', ['inspect', 'hsm-r27-perf-' + service], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const containers = JSON.parse(result);
  if (containers.length !== 1) throw new Error('ambiguous R27 service identity');
  verifyLaneContainer(service, containers[0]);
}

/**
 * Isolate browser-project setup without altering the API's real login budget.
 * The previous project's loopback counters are fixture state, not measured
 * traffic. Never call this within a journey or overload/recovery experiment.
 * Sessions, registration buckets and application caches are left intact.
 */
export function resetBrowserThrottleBuckets() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('browser fixture reset requires a disposable GitHub-hosted runner');
  }
  assertLaneService('redis');
  const command = ['exec', 'hsm-r27-perf-redis', 'redis-cli', '-e', '--raw'];
  const run = (args) =>
    execFileSync('docker', [...command, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const keys = [
    ...new Set(run(['--scan', '--pattern', 'rl:throttler:default:*']).split('\n').filter(Boolean)),
  ];
  // Nest hashes the controller/handler/name/tracker identity. Validate ALL
  // returned keys before the first deletion; a different store fails closed.
  if (keys.some((key) => !/^rl:throttler:default:[a-f0-9]{64}(?::blocked)?$/.test(key))) {
    throw new Error('unexpected browser throttle key shape; no fixture keys deleted');
  }
  let removed = 0;
  for (let offset = 0; offset < keys.length; offset += 100) {
    const batch = keys.slice(offset, offset + 100);
    const count = Number(run(['DEL', ...batch]).trim());
    if (!Number.isInteger(count) || count < 0 || count > batch.length)
      throw new Error('invalid browser fixture reset result');
    removed += count;
  }
  return removed;
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
  // Keep destination and policy inputs fixed; only log verbosity is adjustable.
  for (const [key, value] of Object.entries(overrides)) {
    if (
      key !== 'LOG_LEVEL' ||
      !['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(value)
    ) {
      throw new Error('R27 environment override is not allowed: ' + key);
    }
  }
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
