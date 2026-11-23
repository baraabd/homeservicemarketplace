#!/usr/bin/env node
'use strict';

// R31 real browser proof. Fixture accounts, OTPs, raw reports and command logs
// stay in a private temporary directory. Only fixed-schema evidence and the
// twenty explicitly captured plan screenshots may enter the output directory.
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const BASE = '72b4aaeb0a71d806b7fca7363dd9ca59bbcee644';
const API_URL = 'http://127.0.0.1:4331';
const WEB_URL = 'http://127.0.0.1:4431';
const WIDTHS = [320, 390, 430, 768, 1024, 1440];
const EXPECTED_TESTS = [
  'renders the active plan across bilingual viewport, keyboard and accessibility checks',
  'refetches authoritative plan details after refresh, reload and reconnect and rejects another owner',
  'renders genuine pending, failed, expired, cancelled and action-required payments and denies ungranted access',
  'restores the same purchased version and usage after a fresh browser login',
];
const SCREENSHOTS = [
  ...['en', 'ar'].flatMap((language) => WIDTHS.map((width) => `my-plan-${language}-${width}.png`)),
  ...['en', 'ar'].map((language) => `my-plan-${language}-dark-390.png`),
  ...['pending', 'failed', 'actionRequired', 'cancelled', 'expired', 'ungranted'].map(
    (state) => `my-plan-state-${state}-390.png`,
  ),
];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function bounded(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function sourceIdentity() {
  const head = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');
  git('merge-base', '--is-ancestor', BASE, head);
  const status = git('status', '--porcelain=v1', '--untracked-files=all');
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard')
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const relative of new Set(files)) {
    hash.update(relative).update('\0');
    const file = path.join(ROOT, relative);
    let handle;
    try {
      // Nonblocking open also lets the descriptor check reject a replaced FIFO.
      handle = await fsp.open(
        file,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      );
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('R31 source identity requires regular files.');
      hash.update(await handle.readFile());
      hash.update(String(stat.mode & 0o777));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('DELETED');
    } finally {
      await handle?.close();
    }
    hash.update('\0');
  }
  return {
    head,
    tree,
    workingSourceSha256: hash.digest('hex'),
    dirty: Boolean(status),
    changedPaths: status ? status.split('\n').length : 0,
  };
}

function environment(overrides = {}) {
  const allowed = [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'LANG',
    'LC_ALL',
    'TZ',
    'CI',
    'PLAYWRIGHT_BROWSERS_PATH',
  ];
  return {
    ...Object.fromEntries(
      allowed.filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
    ),
    NODE_ENV: 'test',
    APP_ENV: 'test',
    RUN_DB_INTEGRATION: '1',
    TZ: 'UTC',
    ...overrides,
  };
}

function guardEnvironment() {
  if (process.platform === 'win32') throw new Error('R31 requires POSIX owned process groups.');
  if (process.versions.node !== '24.21.0') throw new Error('R31 requires pinned Node 24.21.0.');
  if (
    execFileSync('pnpm', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim() !== '10.32.1'
  ) {
    throw new Error('R31 requires pinned pnpm 10.32.1.');
  }
  if (
    process.env.RUN_DB_INTEGRATION !== '1' ||
    process.env.NODE_ENV !== 'test' ||
    process.env.APP_ENV !== 'test'
  ) {
    throw new Error('R31 requires RUN_DB_INTEGRATION=1 NODE_ENV=test APP_ENV=test.');
  }
  // Nest and Vite both load local environment files. A real-service proof must
  // not silently inherit an operator's production connection or feature flags.
  for (const directory of [
    ROOT,
    path.join(ROOT, 'apps/api'),
    path.join(ROOT, 'apps/web'),
    path.join(ROOT, 'packages/database'),
  ]) {
    if (
      fs
        .readdirSync(directory)
        .some((name) =>
          /^\.env(?:\.(?:local|development|production|test)(?:\.local)?)?$/u.test(name),
        )
    ) {
      throw new Error(
        'R31 requires an environment-file-free checkout with explicit service variables.',
      );
    }
  }
  let database;
  try {
    database = new URL(process.env.DATABASE_URL);
  } catch {
    throw new Error('R31 requires an explicit loopback PostgreSQL URL.');
  }
  if (
    database.protocol !== 'postgresql:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
  ) {
    throw new Error('R31 refuses a non-loopback PostgreSQL target.');
  }
  if (
    !process.env.REDIS_URL &&
    (!['127.0.0.1', 'localhost', '::1'].includes(process.env.REDIS_HOST) || !process.env.REDIS_PORT)
  ) {
    throw new Error('R31 requires an explicit disposable loopback Redis target.');
  }
  if (process.env.REDIS_URL) {
    let redis;
    try {
      redis = new URL(process.env.REDIS_URL);
    } catch {
      throw new Error('R31 requires an explicit disposable loopback Redis target.');
    }
    if (
      redis.protocol !== 'redis:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(redis.hostname)
    ) {
      throw new Error('R31 refuses a non-loopback Redis URL.');
    }
  }
}

async function freePort(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`R31 owned port ${port} is already in use.`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function ownedProcess(label, args, env, privateDir) {
  const log = fs.createWriteStream(path.join(privateDir, `${label}.log`), {
    flags: 'wx',
    mode: 0o600,
  });
  const child = spawn('pnpm', args, {
    cwd: ROOT,
    env,
    shell: false,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-16000);
    });
  const done = new Promise((resolve) => {
    child.once('error', () => resolve({ code: null, signal: null, spawnFailed: true }));
    child.once('close', (code, signal) => {
      log.end();
      resolve({ code, signal });
    });
  });
  const signal = (value) => {
    if (!Number.isInteger(child.pid)) return false;
    try {
      process.kill(-child.pid, value);
      return true;
    } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw new Error('R31 could not stop its owned process group.', { cause: error });
    }
  };
  let stopping;
  return {
    child,
    done,
    diagnostics: () => tail,
    stop() {
      if (!stopping)
        stopping = (async () => {
          if (signal('SIGTERM')) {
            const deadline = Date.now() + 8000;
            while (signal(0) && Date.now() < deadline) await pause(50);
            if (signal(0)) signal('SIGKILL');
          }
          await bounded(done, 5000, 'R31 owned process cleanup timed out.');
        })();
      return stopping;
    },
  };
}

async function ready(url, processHandle, signal) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (signal.aborted || processHandle.child.exitCode !== null)
      throw new Error('R31 preview stopped before readiness.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      /* Bounded startup polling; no remote targets. */
    }
    await pause(200);
  }
  throw new Error('R31 preview readiness timed out.');
}

function installTestTypeScriptLoader() {
  // Runtime transpilation is only for the test fixture and source AppModule.
  // The independently executed full API typecheck must already have passed.
  const ts = require(path.join(ROOT, 'node_modules/typescript'));
  const original = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => {
    if (!filename.startsWith(path.join(ROOT, 'apps/api') + path.sep)) {
      if (original) return original(module, filename);
      throw new Error('R31 test loader refuses TypeScript outside the API source boundary.');
    }
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
      },
    });
    module._compile(compiled.outputText, filename);
  };
  require(require.resolve('reflect-metadata', { paths: [path.join(ROOT, 'apps/api')] }));
  return () => {
    if (original) require.extensions['.ts'] = original;
    else delete require.extensions['.ts'];
  };
}

function browserEvidence(report) {
  const titles = [];
  const results = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      titles.push(spec.title);
      for (const test of spec.tests ?? []) results.push(test);
    }
    for (const nested of suite.suites ?? []) visit(nested);
  };
  for (const suite of report.suites ?? []) visit(suite);
  const stats = report.stats ?? {};
  if (
    JSON.stringify([...titles].sort()) !== JSON.stringify([...EXPECTED_TESTS].sort()) ||
    results.length !== 4 ||
    stats.expected !== 4 ||
    stats.unexpected !== 0 ||
    stats.skipped !== 0 ||
    stats.flaky !== 0 ||
    (report.errors ?? []).length ||
    results.some(
      (test) =>
        test.status !== 'expected' ||
        test.results?.length !== 1 ||
        test.results[0].status !== 'passed',
    )
  ) {
    throw new Error(
      'R31 requires exactly the four named journeys, each passed once, with zero skips or retries.',
    );
  }
  return {
    expected: 4,
    passed: stats.expected,
    failed: stats.unexpected,
    skipped: stats.skipped,
    flaky: stats.flaky,
    retries: 0,
    tests: EXPECTED_TESTS,
  };
}

async function screenshotEvidence(destination) {
  const names = (await fsp.readdir(destination)).filter((name) => name !== 'summary.json').sort();
  if (JSON.stringify(names) !== JSON.stringify([...SCREENSHOTS].sort())) {
    throw new Error('R31 requires exactly twenty sanitized viewport, theme and state screenshots.');
  }
  return Promise.all(
    SCREENSHOTS.map(async (file) => {
      const bytes = await fsp.readFile(path.join(destination, file));
      const width = Number(file.match(/-(\d+)\.png$/u)[1]);
      if (
        bytes.length < 32 ||
        bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
        bytes.readUInt32BE(16) !== width
      ) {
        throw new Error('R31 screenshot dimensions do not match the required viewport.');
      }
      return { file, width, height: bytes.readUInt32BE(20), sha256: digest(bytes) };
    }),
  );
}

async function safeDiagnostic(value, privateDir) {
  let text = String(value ?? '');
  try {
    const credentials = JSON.parse(
      await fsp.readFile(path.join(privateDir, 'credentials.json'), 'utf8'),
    );
    for (const account of Object.values(credentials.accounts))
      for (const key of ['email', 'password']) {
        text = text.replaceAll(account[key], '[PRIVATE]');
      }
  } catch {
    /* Setup may fail before fixture credentials exist. */
  }
  const lines = text
    .replace(/\b\d{6}\b/gu, '[OTP_OR_NUMBER]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/gu, '[TOKEN]')
    .replace(/(?:postgres(?:ql)?|redis|https?):\/\/[^\s"']+/giu, '[URL]')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, '[EMAIL]')
    .split('\n')
    .filter(
      (line) =>
        !/(?:password|cookie|authorization|set-cookie|secret|challengeId|credentials)/iu.test(line),
    );
  return (
    lines.length > 90 ? [...lines.slice(0, 70), '[bounded diagnostic]', ...lines.slice(-20)] : lines
  ).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const development = args.includes('--development');
  const outputIndex = args.indexOf('--output');
  if (
    outputIndex < 0 ||
    !args[outputIndex + 1] ||
    args.some(
      (arg, index) => arg !== '--development' && arg !== '--output' && index !== outputIndex + 1,
    )
  ) {
    throw new Error(
      'Usage: verify-my-plan.cjs --output <empty-evidence-directory> [--development]',
    );
  }
  if (development && process.env.CI)
    throw new Error('CI cannot use development-only source evidence.');
  guardEnvironment();
  const source = await sourceIdentity();
  if (source.dirty && !development)
    throw new Error(
      'R31 acceptance requires a clean source commit; local diagnostics use --development.',
    );
  const destination = path.resolve(args[outputIndex + 1]);
  if (fs.existsSync(destination) && (await fsp.readdir(destination)).length)
    throw new Error('R31 output must be empty to exclude stale evidence.');
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  const privateDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hsm-r31-private-'));
  await fsp.chmod(privateDir, 0o700);
  const scope = new AbortController();
  const interrupted = () => scope.abort();
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const processes = [];
  const report = {
    schemaVersion: 1,
    sprint: 'R31',
    startedAt: new Date().toISOString(),
    status: 'INCOMPLETE',
    source,
    sourceStable: false,
    node: process.versions.node,
    pnpm: '10.32.1',
    acceptanceScope: 'R31_REAL_API_BROWSER_WITH_SYNTHETIC_PREVIOUS_WAVE_COLLECTION_COMPONENTS',
    railAcceptance: false,
    productionAcceptance: false,
    commands: [],
    cleanup: 'PENDING',
  };
  let fixture;
  let restoreLoader;
  let failure;
  let diagnostics = '';
  let stage = 'prepare';
  const run = async (label, command, env = environment(), timeout = 300000) => {
    if (scope.signal.aborted) throw new Error('R31 verification interrupted.');
    stage = label;
    process.stdout.write(`[r31] ${label}\n`);
    const started = Date.now();
    const child = ownedProcess(label, command, env, privateDir);
    processes.push(child);
    let timer;
    const result = await Promise.race([
      child.done,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ code: null, timeout: true }), timeout);
      }),
      new Promise((resolve) =>
        scope.signal.addEventListener('abort', () => resolve({ code: null, interrupted: true }), {
          once: true,
        }),
      ),
    ]).finally(() => clearTimeout(timer));
    report.commands.push({
      label,
      command: [
        'pnpm',
        ...command.map((arg) => (arg.startsWith(privateDir) ? '[PRIVATE_BUILD_PATH]' : arg)),
      ],
      exitCode: result.code,
      signal: result.signal ?? null,
      durationMs: Date.now() - started,
      status: result.code === 0 ? 'PASSED' : 'FAILED',
    });
    if (result.code !== 0) {
      diagnostics = child.diagnostics();
      throw new Error(`R31 ${label} failed.`);
    }
    await child.stop();
  };

  try {
    await Promise.all([freePort(4331), freePort(4431)]);
    await run('contracts-build', ['--filter', '@homeservicemarketplace/contracts', 'build']);
    await run('database-build', ['--filter', '@homeservicemarketplace/database', 'build']);
    await run('api-typecheck', [
      '--filter',
      '@homeservicemarketplace/api',
      'exec',
      'tsc',
      '--noEmit',
    ]);
    await run('web-typecheck', ['--filter', '@homeservicemarketplace/web', 'exec', 'tsc', '-b']);
    await run('browser-typecheck', ['--filter', '@homeservicemarketplace/web', 'typecheck:e2e']);
    await run('browser-config-typecheck', [
      '--filter',
      '@homeservicemarketplace/web',
      'exec',
      'tsc',
      '--noEmit',
      '--skipLibCheck',
      '--moduleResolution',
      'Bundler',
      '--module',
      'ESNext',
      '--target',
      'ES2022',
      'playwright.r31.config.ts',
    ]);
    const bundle = path.join(privateDir, 'web-dist');
    await run(
      'web-build',
      [
        '--filter',
        '@homeservicemarketplace/web',
        'exec',
        'vite',
        'build',
        '--outDir',
        bundle,
        '--emptyOutDir',
      ],
      environment({ NODE_ENV: 'production', VITE_API_URL: API_URL }),
    );
    stage = 'real-fixture';
    process.stdout.write('[r31] real AppModule, isolated migrations and genuine activation\n');
    restoreLoader = installTestTypeScriptLoader();
    const originalDirectory = process.cwd();
    // Match the API package's normal environment-file resolution. Both it and
    // the repository root were explicitly checked before importing AppModule.
    process.chdir(path.join(ROOT, 'apps/api'));
    try {
      const { r31BrowserFixture } = require(
        path.join(ROOT, 'apps/api/test/support/r31-browser.fixture.ts'),
      );
      fixture = await r31BrowserFixture({ webOrigin: WEB_URL, apiPort: 4331, privateDir });
    } finally {
      process.chdir(originalDirectory);
    }
    report.fixture = fixture.evidence;
    if (fixture.url !== API_URL)
      throw new Error('R31 fixture API origin differs from the built browser origin.');
    const preview = ownedProcess(
      'web-preview',
      [
        '--filter',
        '@homeservicemarketplace/web',
        'exec',
        'vite',
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '4431',
        '--strictPort',
        '--outDir',
        bundle,
      ],
      environment({ VITE_API_URL: API_URL }),
      privateDir,
    );
    processes.push(preview);
    await ready(WEB_URL, preview, scope.signal);
    const browserEnv = environment({
      R31_BROWSER_BASE_URL: WEB_URL,
      R31_BROWSER_API_URL: API_URL,
      R31_BROWSER_PRIVATE_DIR: privateDir,
      R31_BROWSER_CREDENTIALS_FILE: fixture.credentialsFile,
      R31_BROWSER_REPORT_DIR: destination,
    });
    await run(
      'browser-journeys',
      [
        '--filter',
        '@homeservicemarketplace/web',
        'exec',
        'playwright',
        'test',
        '--config',
        'playwright.r31.config.ts',
      ],
      browserEnv,
      600000,
    );
    stage = 'evidence';
    report.browser = browserEvidence(
      JSON.parse(await fsp.readFile(path.join(privateDir, 'playwright-report.json'), 'utf8')),
    );
    report.screenshots = await screenshotEvidence(destination);
    report.finishedSource = await sourceIdentity();
    report.sourceStable = JSON.stringify(source) === JSON.stringify(report.finishedSource);
    if (!report.sourceStable && !development)
      throw new Error('R31 source changed during verification.');
    if (scope.signal.aborted) throw new Error('R31 verification interrupted.');
    report.status = development ? 'DEVELOPMENT_ONLY' : 'R31_BROWSER_ACCEPTED';
  } catch (error) {
    failure = error;
    report.failureStage = stage;
    report.status = 'FAILED';
    try {
      const browser = JSON.parse(
        await fsp.readFile(path.join(privateDir, 'playwright-report.json'), 'utf8'),
      );
      report.browser = {
        expected: 4,
        passed: browser.stats?.expected ?? 0,
        failed: browser.stats?.unexpected ?? 0,
        skipped: browser.stats?.skipped ?? 0,
        flaky: browser.stats?.flaky ?? 0,
        runnerErrors: browser.errors?.length ?? 0,
      };
      const messages = [];
      const collect = (suite) => {
        for (const spec of suite.specs ?? [])
          for (const test of spec.tests ?? [])
            for (const result of test.results ?? [])
              if (result.error?.message) messages.push(result.error.message);
        for (const nested of suite.suites ?? []) collect(nested);
      };
      for (const suite of browser.suites ?? []) collect(suite);
      if (messages.length) diagnostics = messages.slice(0, 2).join('\n');
    } catch {
      /* No browser report exists when an earlier gate failed. */
    }
    process.stderr.write(
      `[r31] ${await safeDiagnostic(diagnostics || error.message, privateDir)}\n`,
    );
  } finally {
    const cleanup = await Promise.allSettled(processes.map((child) => child.stop()));
    try {
      if (fixture) await bounded(fixture.dispose(), 30000, 'R31 fixture cleanup timed out.');
    } catch (error) {
      cleanup.push({ status: 'rejected', reason: error });
    }
    restoreLoader?.();
    try {
      await fsp.rm(privateDir, { recursive: true, force: true });
    } catch (error) {
      cleanup.push({ status: 'rejected', reason: error });
    }
    report.cleanup = cleanup.every((item) => item.status === 'fulfilled')
      ? 'OWNED_PROCESSES_DATABASE_AND_PRIVATE_FILES_REMOVED'
      : 'FAILED';
    if (report.cleanup === 'FAILED' || scope.signal.aborted) {
      report.status = 'FAILED';
      failure ??= new Error('R31 verification cleanup failed or was interrupted.');
    }
    report.finishedAt = new Date().toISOString();
    report.commandCount = report.commands.length;
    report.passedCommandCount = report.commands.filter(
      (command) => command.status === 'PASSED',
    ).length;
    report.screenshotCount = (await fsp.readdir(destination)).filter((name) =>
      SCREENSHOTS.includes(name),
    ).length;
    if (!report.finishedSource) {
      try {
        report.finishedSource = await sourceIdentity();
        report.sourceStable = JSON.stringify(source) === JSON.stringify(report.finishedSource);
      } catch {
        report.sourceStable = false;
      }
    }
    await fsp.writeFile(
      path.join(destination, 'summary.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      { mode: 0o600 },
    );
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
  if (failure)
    throw new Error(
      `R31 verification failed at ${report.failureStage ?? 'cleanup'}; inspect the sanitized evidence summary.`,
    );
  process.stdout.write(
    `[r31] ${report.status}: 4/4 journeys, ${SCREENSHOTS.length}/${SCREENSHOTS.length} screenshots, cleanup complete.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
