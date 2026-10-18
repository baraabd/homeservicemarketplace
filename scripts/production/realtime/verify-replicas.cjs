'use strict';

// R25 acceptance runner. This does not provision, reset, or flush services.
// It accepts only an explicitly named, disposable loopback R25 environment.
// Raw test output is private; only fixed-schema summaries are publishable.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const net = require('node:net');

const ROOT = path.resolve(__dirname, '../../..');
const FROZEN_BASE = '40cdac5c9ce6acaa8dedc0385984a807ae9a84d0';
const BRANCH = 'feat/r25-realtime-multi-instance';
const API = '@homeservicemarketplace/api';
const WEB = '@homeservicemarketplace/web';
const DATABASE = '@homeservicemarketplace/database';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const HARDENED = new Set(['production', 'prod', 'staging']);

function port(value, name, fallback) {
  const text = value === undefined ? String(fallback) : String(value);
  if (!/^\d{4,5}$/.test(text)) throw new Error(`${name} must be an explicit high port`);
  const number = Number(text);
  if (number < 1024 || number > 65535) throw new Error(`${name} is outside the test port range`);
  return number;
}

function configuration(env) {
  const session = env.R25_SESSION;
  if (!session || !/^[a-z0-9_]{6,40}$/.test(session)) {
    throw new Error('R25_SESSION must identify this disposable run');
  }
  let database;
  try {
    database = new URL(env.DATABASE_URL || '');
  } catch {
    throw new Error('DATABASE_URL must name the isolated R25 database');
  }
  if (
    !new Set(['postgres:', 'postgresql:']).has(database.protocol) ||
    !LOOPBACK.has(database.hostname) ||
    database.pathname !== `/hsm_r25_${session}` ||
    !database.username ||
    !database.password ||
    database.hash ||
    database.search
  ) {
    throw new Error('Refusing a non-isolated R25 database destination');
  }
  const ports = {
    database: port(database.port, 'database port'),
    redis: port(env.REDIS_PORT, 'REDIS_PORT', 56325),
    smtp: port(env.SMTP_PORT, 'SMTP_PORT', 51025),
    mailpit: port(env.R25_MAILPIT_PORT, 'R25_MAILPIT_PORT', 58025),
    apiA: port(env.R25_API_A_PORT, 'R25_API_A_PORT', 4325),
    apiB: port(env.R25_API_B_PORT, 'R25_API_B_PORT', 4425),
    webA: port(env.R25_WEB_A_PORT, 'R25_WEB_A_PORT', 5325),
    webB: port(env.R25_WEB_B_PORT, 'R25_WEB_B_PORT', 5425),
  };
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length) {
    throw new Error('Every R25 service and replica needs a distinct port');
  }
  if (ports.database === 5432 || ports.redis === 6379) {
    throw new Error('Refusing common shared PostgreSQL or Redis ports');
  }
  if (!LOOPBACK.has(env.REDIS_HOST || '127.0.0.1') || !env.REDIS_PASSWORD) {
    throw new Error('R25 requires a separate authenticated loopback Redis instance');
  }
  if ([env.NODE_ENV, env.APP_ENV].some((value) => HARDENED.has(value?.trim().toLowerCase()))) {
    throw new Error('This harness cannot target a hardened or hosted environment');
  }
  return {
    session,
    ports,
    databaseUrl: database.toString(),
    redisPassword: env.REDIS_PASSWORD,
    evidenceRoot: path.join(ROOT, 'apps/web/test-results', `r25-${session}`),
  };
}

function publicConfiguration(config) {
  return {
    session: config.session,
    ports: config.ports,
    database: `hsm_r25_${config.session}`,
    bind: 'loopback',
    node: '24.21.0',
    pnpm: '10.32.1',
    flags: {
      REALTIME_SOCKET_IO: true,
      REALTIME_ALLOW_SINGLE_INSTANCE: false,
      VITE_REALTIME_SOCKET_IO: true,
      VITE_REALTIME_TRANSPORTS: 'websocket',
      THROTTLE_REDIS_REQUIRED: true,
      MONGODB_ENABLED: false,
    },
    ownership: 'R25 disposable services; no reset, shared flush or deployment',
  };
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function summarizeJest(report) {
  const result = {
    suites: report.numPassedTestSuites,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests,
    success: report.success,
  };
  if (
    !Number.isInteger(result.passed) ||
    result.passed < 1 ||
    !Number.isInteger(result.suites) ||
    result.suites < 1 ||
    result.failed !== 0 ||
    result.skipped !== 0 ||
    result.success !== true
  ) {
    throw new Error('R25 real-service report is missing, failing or skipped');
  }
  return result;
}

function summarizeBrowser(report) {
  const stats = report.stats || {};
  const result = {
    passed: stats.expected,
    failed: stats.unexpected,
    skipped: stats.skipped,
    flaky: stats.flaky,
  };
  if (
    !Number.isInteger(result.passed) ||
    result.passed < 1 ||
    result.failed !== 0 ||
    result.skipped !== 0 ||
    result.flaky !== 0 ||
    (report.errors || []).length !== 0
  ) {
    throw new Error('R25 browser report is missing, failing, flaky or skipped');
  }
  return result;
}

function sourceIdentity(root = ROOT) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const branch = git('branch', '--show-current');
  if (branch !== BRANCH && process.env.CI !== 'true') {
    throw new Error('Use the assigned isolated R25 branch');
  }
  git('merge-base', '--is-ancestor', FROZEN_BASE, 'HEAD');
  const status = git('status', '--porcelain', '--untracked-files=normal');
  if (status) throw new Error('Commit the reviewed candidate before source-bound acceptance');
  return {
    frozenBaseSha: FROZEN_BASE,
    headSha: git('rev-parse', 'HEAD'),
    treeSha: git('rev-parse', 'HEAD^{tree}'),
    branch,
  };
}

function requireSameSource(before, after) {
  if (
    before.headSha !== after.headSha ||
    before.treeSha !== after.treeSha ||
    before.branch !== after.branch
  ) {
    throw new Error('The source candidate changed during acceptance');
  }
}

async function requireNoEnvironmentFiles(root = ROOT) {
  // Nest, dotenv-cli and Vite read these even when inherited env is filtered.
  // Inspect names only; never read, print, move or overwrite local secrets.
  for (const directory of ['', 'apps/api', 'apps/web', 'packages/database']) {
    for (const suffix of [
      '',
      '.local',
      '.production',
      '.production.local',
      '.development',
      '.development.local',
      '.test',
      '.test.local',
    ]) {
      try {
        await fs.lstat(path.join(root, directory, `.env${suffix}`));
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw new Error(
          'Cannot verify that the acceptance checkout has no loadable environment files',
          { cause: error },
        );
      }
      throw new Error('Use an isolated checkout without loadable environment files');
    }
  }
}

async function directoryDigest(directory) {
  const files = [];
  async function visit(relative) {
    const entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile())
        files.push({
          path: name.split(path.sep).join('/'),
          sha256: createHash('sha256')
            .update(await fs.readFile(path.join(directory, name)))
            .digest('hex'),
        });
      else throw new Error('Acceptance build contains an unexpected nonregular file');
    }
  }
  await visit('');
  if (files.length === 0) throw new Error('Acceptance build is empty');
  return { files: files.length, sha256: fingerprint(files) };
}

function childEnvironment(config, inherited, source) {
  const env = {};
  for (const key of [
    'PATH',
    'SystemRoot',
    'LANG',
    'LC_ALL',
    'TZ',
    'PLAYWRIGHT_BROWSERS_PATH',
    'CI',
  ]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  const origin = (value) => `http://127.0.0.1:${value}`;
  return {
    ...env,
    NODE_ENV: 'development',
    APP_ENV: 'test',
    DATABASE_URL: config.databaseUrl,
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: String(config.ports.redis),
    REDIS_DB: '0',
    REDIS_PASSWORD: config.redisPassword,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(config.ports.smtp),
    SMTP_FROM: 'noreply@example.test',
    SMTP_SECURE: 'false',
    JWT_ACCESS_SECRET: randomBytes(48).toString('base64'),
    MAIL_INTENT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    JWT_ISSUER: 'hsm-api',
    JWT_AUDIENCE: 'hsm-clients',
    COOKIE_SECURE: 'false',
    COOKIE_SAMESITE: 'lax',
    FRONTEND_URL: origin(config.ports.webA),
    CORS_ORIGINS: `${origin(config.ports.webA)},${origin(config.ports.webB)}`,
    REALTIME_SOCKET_IO: 'true',
    REALTIME_ALLOW_SINGLE_INSTANCE: 'false',
    THROTTLE_REDIS_REQUIRED: 'true',
    MONGODB_ENABLED: 'false',
    STORAGE_DRIVER: 'local',
    LOCAL_STORAGE_DIR: path.join(config.evidenceRoot, 'private', 'storage-public'),
    RESTRICTED_STORAGE_DIR: path.join(config.evidenceRoot, 'private', 'storage-restricted'),
    E2E_REAL_API: origin(config.ports.apiA),
    E2E_BASE_URL: origin(config.ports.webA),
    E2E_REPLICA_A_WEB: origin(config.ports.webA),
    E2E_REPLICA_B_WEB: origin(config.ports.webB),
    E2E_REPLICA_A_PORT: String(config.ports.apiA),
    E2E_REPLICA_B_PORT: String(config.ports.apiB),
    E2E_MAILPIT: origin(config.ports.mailpit),
    E2E_PREBUILT: '1',
    HSM_R25_REALTIME: 'isolated-ci',
    VITE_REALTIME_SOCKET_IO: 'true',
    VITE_REALTIME_TRANSPORTS: 'websocket',
    VITE_PROVIDER_ONBOARDING_V2: 'true',
    SOURCE_SHA: source.headSha,
    HSM_SOURCE_SHA: source.headSha,
  };
}

async function requireFreePort(number) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`R25 reserved port ${number} is already in use`)));
    server.listen(number, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function ownedProcess(command, args, options) {
  if (process.platform === 'win32')
    throw new Error('The isolated acceptance runner requires POSIX process groups');
  // The new group contains only this command and its own descendants. Never
  // discover or kill processes by port, executable name or a caller's PID.
  const child = spawn(command, args, {
    ...options,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderrTail = '';
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  const done = new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null, spawnFailed: true }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const groupSignal = (signal) => {
    if (!Number.isInteger(child.pid) || child.pid < 1) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw new Error('Cannot stop the acceptance command process group', { cause: error });
    }
  };
  let stopping;
  return {
    child,
    done,
    async stop() {
      if (!stopping)
        stopping = (async () => {
          if (!groupSignal('SIGTERM')) {
            await done;
            return;
          }
          const deadline = Date.now() + 10_000;
          while (groupSignal(0) && Date.now() < deadline)
            await new Promise((resolve) => setTimeout(resolve, 50));
          if (groupSignal(0)) groupSignal('SIGKILL');
          await done;
        })();
      return stopping;
    },
    // Private diagnostics are explicitly retrieved by the operator, never
    // copied into the public fixed-schema acceptance record.
    diagnostics: () => stderrTail,
  };
}

async function runCommand(label, args, env, output, records, scope) {
  scope.signal.throwIfAborted();
  const began = Date.now();
  const handle = await fs.open(output, 'wx', 0o600);
  let stderrHandle;
  try {
    stderrHandle = await fs.open(`${output}.stderr`, 'wx', 0o600);
  } catch (error) {
    await handle.close();
    throw error;
  }
  const running = ownedProcess('pnpm', args, { cwd: ROOT, env });
  scope.children.add(running);
  let writeError;
  let pending = Promise.resolve();
  const keep = (destination) => (chunk) => {
    pending = pending
      .then(() => destination.write(chunk))
      .catch((error) => {
        writeError = error;
      });
  };
  running.child.stdout.on('data', keep(handle));
  // Jest sends console/declared-load observations to stderr in JSON mode.
  // Preserve both streams privately; only the fixed-schema summary is public.
  running.child.stderr.on('data', keep(stderrHandle));
  let timeout = false;
  const stop = () => {
    void running.stop().catch(() => {});
  };
  scope.signal.addEventListener('abort', stop, { once: true });
  const timedOut = setTimeout(() => {
    timeout = true;
    stop();
  }, 15 * 60_000);
  let result;
  let cleanupError;
  try {
    result = await running.done;
    await pending;
  } finally {
    clearTimeout(timedOut);
    scope.signal.removeEventListener('abort', stop);
    try {
      await running.stop();
      scope.children.delete(running);
    } catch (error) {
      cleanupError = error;
    } finally {
      await Promise.all([handle.close(), stderrHandle.close()]);
    }
  }
  records.push({
    label,
    command: ['pnpm', ...args],
    exitCode: result.code,
    signal: result.signal,
    timedOut: timeout,
    cleanup: cleanupError ? 'failed' : 'stopped',
    durationMs: Date.now() - began,
  });
  if (cleanupError)
    throw new Error(`${label} owned process cleanup failed`, { cause: cleanupError });
  if (writeError || result.code !== 0 || timeout || scope.signal.aborted) {
    throw new Error(`${label} failed; inspect its private output (not publication evidence)`);
  }
}

async function waitHealthy(url, running, signal) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (running.child.exitCode !== null || running.child.signalCode !== null) break;
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* a starting listener is not ready */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('R25 preview did not become ready within its bounded startup window');
}

function requireCompletedCleanup(cleanup, signal) {
  if (cleanup !== 'owned process groups stopped' || signal.aborted) {
    throw new Error('Acceptance cleanup failed or was interrupted; no success is credited');
  }
}

async function verify(config, inherited) {
  const source = sourceIdentity();
  await requireNoEnvironmentFiles();
  if (process.versions.node !== '24.21.0') throw new Error('Use pinned Node 24.21.0');
  if (execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim() !== '10.32.1')
    throw new Error('Use pinned pnpm 10.32.1');
  const attempt = `${new Date().toISOString().replace(/[^0-9]/g, '')}-${randomBytes(4).toString('hex')}`;
  const destination = path.join(config.evidenceRoot, attempt);
  await fs.mkdir(config.evidenceRoot, { recursive: true, mode: 0o700 });
  // Never overwrite prior evidence or clean a directory supplied by a caller.
  await fs.mkdir(destination, { mode: 0o700 });
  await fs.mkdir(path.join(destination, 'private'), { mode: 0o700 });
  const env = childEnvironment({ ...config, evidenceRoot: destination }, inherited, source);
  const records = [];
  const report = {
    schemaVersion: 1,
    sprint: 'R25',
    attempt,
    ...source,
    config: publicConfiguration(config),
    configurationFingerprint: fingerprint(publicConfiguration(config)),
    commands: records,
    status: 'INTEGRATION_PENDING',
  };
  const controller = new AbortController();
  const scope = { signal: controller.signal, children: new Set() };
  const interrupt = () => {
    controller.abort(new Error('Acceptance was interrupted; no success is credited'));
    for (const child of scope.children) void child.stop().catch(() => {});
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, interrupt);
  const raw = (name) => path.join(destination, 'private', name);
  const command = (label, args, override = {}) =>
    runCommand(label, args, { ...env, ...override }, raw(`${label}.log`), records, scope);
  try {
    for (const name of ['apiA', 'apiB', 'webA', 'webB']) await requireFreePort(config.ports[name]);
    await command('migrations', ['--filter', DATABASE, 'migrate:deploy']);
    await command('database-build', ['--filter', DATABASE, 'build']);
    await command('seed', ['--filter', DATABASE, 'seed']);
    const jestReport = raw('api-results.json');
    await command(
      'api-integration',
      [
        '--filter',
        API,
        'test',
        '--runTestsByPath',
        'test/integration/r25-realtime-recovery.integration.spec.ts',
        '--json',
        `--outputFile=${jestReport}`,
      ],
      { RUN_DB_INTEGRATION: '1', RUN_REDIS_INTEGRATION: '1' },
    );
    report.api = summarizeJest(JSON.parse(await fs.readFile(jestReport, 'utf8')));
    await command('api-build', ['--filter', API, 'build']);
    report.apiBuild = await directoryDigest(path.join(ROOT, 'apps/api/dist'));
    await command('web-typecheck', ['--filter', WEB, 'typecheck']);
    report.webBuilds = {};
    for (const side of ['A', 'B']) {
      const output = path.join(destination, `web-${side}`);
      await command(
        `web-build-${side}`,
        ['--filter', WEB, 'exec', 'vite', 'build', '--outDir', output],
        {
          NODE_ENV: 'production',
          VITE_API_URL: `http://127.0.0.1:${config.ports[`api${side}`]}`,
        },
      );
      report.webBuilds[side] = await directoryDigest(output);
      const webRequire = createRequire(path.join(ROOT, 'apps/web/package.json'));
      const viteMain = path.join(
        path.dirname(webRequire.resolve('vite/package.json')),
        'bin/vite.js',
      );
      const preview = ownedProcess(
        process.execPath,
        [
          viteMain,
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          String(config.ports[`web${side}`]),
          '--strictPort',
          '--outDir',
          output,
        ],
        { cwd: path.join(ROOT, 'apps/web'), env },
      );
      preview.child.stdout.resume();
      scope.children.add(preview);
      await waitHealthy(`http://127.0.0.1:${config.ports[`web${side}`]}`, preview, scope.signal);
    }
    await command('browser', [
      '--filter',
      WEB,
      'exec',
      'playwright',
      'test',
      'e2e/r25-realtime-recovery.real-api.spec.ts',
      '--project=chromium-desktop',
      '--retries=0',
      '--reporter=json',
      `--output=${raw('browser-output')}`,
    ]);
    report.browser = summarizeBrowser(JSON.parse(await fs.readFile(raw('browser.log'), 'utf8')));
    requireSameSource(source, sourceIdentity());
    await requireNoEnvironmentFiles();
    scope.signal.throwIfAborted();
    report.status = 'SANDBOX_ACCEPTED';
  } finally {
    const results = await Promise.allSettled([...scope.children].map((child) => child.stop()));
    report.cleanup = results.every((result) => result.status === 'fulfilled')
      ? 'owned process groups stopped'
      : 'owned process cleanup failed';
    if (report.cleanup.endsWith('failed') || scope.signal.aborted)
      report.status = 'INTEGRATION_PENDING';
    const save = () =>
      fs.writeFile(path.join(destination, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
      });
    try {
      await save();
      if (scope.signal.aborted && report.status === 'SANDBOX_ACCEPTED') {
        report.status = 'INTEGRATION_PENDING';
        await save();
      }
    } finally {
      for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, interrupt);
    }
  }
  requireCompletedCleanup(report.cleanup, scope.signal);
  return report;
}

module.exports = {
  configuration,
  publicConfiguration,
  fingerprint,
  summarizeJest,
  summarizeBrowser,
  childEnvironment,
  requireFreePort,
  sourceIdentity,
  requireSameSource,
  requireNoEnvironmentFiles,
  directoryDigest,
  ownedProcess,
  requireCompletedCleanup,
  verify,
};

if (require.main === module) {
  const mode = process.argv[2];
  Promise.resolve()
    .then(async () => {
      if (!new Set(['--check', '--run']).has(mode) || process.argv.length !== 3)
        throw new Error(
          'Usage: node scripts/production/realtime/verify-replicas.cjs --check|--run',
        );
      const config = configuration(process.env);
      const result =
        mode === '--check' ? publicConfiguration(config) : await verify(config, process.env);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      // These are controlled harness errors, never raw driver exception bodies.
      process.stderr.write(
        `R25 verification failed: ${error instanceof Error ? error.message : 'unknown failure'}\n`,
      );
      process.exitCode = 1;
    });
}
