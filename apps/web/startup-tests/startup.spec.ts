import { expect, test, type TestInfo } from '@playwright/test';
import { isLegacyContractModuleError } from './legacy-contract-error';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  seedLanguage,
  signedInAdmin,
  stubApi,
} from '../e2e/fixtures';

const loadCommonJs = createRequire(import.meta.url);
const webRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = path.resolve(webRoot, '../..');
const viteCli = path.join(path.dirname(loadCommonJs.resolve('vite/package.json')), 'bin/vite.js');
const tscCli = loadCommonJs.resolve('typescript/lib/tsc.js');
const children = new Set<ChildProcess>();
let scratch: string;
let web: string;

// Model a generated config from before the contracts browser boundary existed.
// This is deliberately broken TEST input, never an application fallback.
const legacyConfig = `import { defineConfig } from 'vite';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  assetsInclude: ['**/*.svg', '**/*.csv'],
});
`;

const omitted = new Set([
  'node_modules',
  'dist',
  '.turbo',
  '.git',
  'test-results',
  'playwright-report',
  'coverage',
  'vite.config.js',
  'vite.config.d.ts',
]);

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// Keep caches/build-info LOCAL to the scratch directory. Linking the entire
// node_modules directory would let a regression run disturb a developer's Vite.
async function linkDependencies(source: string, destination: string): Promise<void> {
  if (!(await exists(source))) return;
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source)) {
    if (['.vite', '.vite-temp', '.tmp', '.cache'].includes(entry)) continue;
    const from = path.join(source, entry);
    const to = path.join(destination, entry);
    if ((await stat(from)).isDirectory()) {
      await symlink(await realpath(from), to, 'junction');
    } else {
      await copyFile(from, to);
    }
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Only the process tree THIS test created, never other Node processes.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already exited. */
    }
    for (let i = 0; i < 50 && child.exitCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }
  }
  children.delete(child);
}

// Vite answers index.html before a forced dependency optimization commits, and
// HOLDS every pre-bundled module request until it does. Measured on Windows
// (2026-11-03): index.html answered after 17 s while
// /node_modules/.vite/deps/react.js was held for 160.6 s, then served with 200
// the moment Vite logged "dependencies optimized". A route asserted inside that
// window sits on its Suspense fallback ("Loading the page") with no page error.
// A dev server is therefore ready only when a pre-bundled module is served.
// This is the server cold-start budget; route assertions keep their own 30 s.
const DEV_DEPENDENCY_PROBE = '/node_modules/.vite/deps/react.js';
const DEV_DEPENDENCY_OPTIMIZER_BUDGET_MS = 240_000;
const DEV_TEST_TIMEOUT_MS = 180_000 + DEV_DEPENDENCY_OPTIMIZER_BUDGET_MS;

async function serve(
  args: string[],
  port: number,
  info: TestInfo,
  name: string,
  options: { env?: NodeJS.ProcessEnv; awaitDependencyOptimizer?: boolean } = {},
) {
  let output = '';
  let failure: Error | undefined;
  const spawnedAt = performance.now();
  const child = spawn(process.execPath, args, {
    cwd: web,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      VITE_API_URL: 'https://api.example.test',
      BROWSER: 'none',
      ...options.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout?.on('data', (data) => {
    output += data.toString();
  });
  child.stderr?.on('data', (data) => {
    output += data.toString();
  });
  child.on('error', (error) => {
    failure = error;
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const close = async () => {
    await stop(child);
    const log = info.outputPath(`${name}.log`);
    await writeFile(log, output);
    await info.attach(name, { path: log, contentType: 'text/plain' });
  };
  try {
    await expect
      .poll(
        async () => {
          if (failure) throw failure;
          if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
          try {
            return (await fetch(baseURL, { signal: AbortSignal.timeout(1000) })).ok;
          } catch {
            return false;
          }
        },
        { timeout: 90_000, message: `Waiting for ${name}` },
      )
      .toBe(true);
    const readiness: Record<string, number | string> = {
      htmlReadyMs: Math.round(performance.now() - spawnedAt),
    };
    if (options.awaitDependencyOptimizer) {
      await expect
        .poll(
          async () => {
            if (failure) throw failure;
            if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
            try {
              // The request is held while optimization runs; abort and retry
              // so a server exit is still noticed promptly.
              const response = await fetch(`${baseURL}${DEV_DEPENDENCY_PROBE}`, {
                signal: AbortSignal.timeout(15_000),
              });
              return response.status;
            } catch {
              return 0;
            }
          },
          {
            timeout: DEV_DEPENDENCY_OPTIMIZER_BUDGET_MS,
            message: `Waiting for ${name} to serve pre-bundled dependencies`,
          },
        )
        .toBe(200);
      readiness.dependencyProbe = DEV_DEPENDENCY_PROBE;
      readiness.dependenciesReadyMs = Math.round(performance.now() - spawnedAt);
    }
    await info.attach(`${name}-readiness`, {
      body: JSON.stringify({ platform: process.platform, ...readiness }, null, 2),
      contentType: 'application/json',
    });
    console.log('SERVER_READINESS', name, JSON.stringify(readiness));
    return { baseURL, close, spawnedAt };
  } catch (error) {
    await close();
    throw error;
  }
}

const cliFlags = (port: number) => [
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
  '--strictPort',
  '--force',
];

test.beforeAll(async () => {
  // Windows TEMP can contain an 8.3 alias such as RUNNER~1. Canonicalize
  // the scratch root so Vite's realpath security checks see the same path.
  // Keep the filesystem allow-list strict; do not disable it for this test.
  scratch = await realpath(await mkdtemp(path.join(tmpdir(), 'hsm-startup-')));
  web = path.join(scratch, 'apps/web');
  const contracts = path.join(scratch, 'packages/contracts');
  const filter = (source: string) => {
    const name = path.basename(source);
    return !omitted.has(name) && !name.startsWith('.env') && !name.endsWith('.tsbuildinfo');
  };
  await cp(webRoot, web, { recursive: true, filter });
  await cp(path.join(repoRoot, 'packages/contracts'), contracts, { recursive: true, filter });
  // The copied Vite source imports the shared build policy. Carry its exact
  // dependency into this isolated workspace, as with contracts above.
  const cspDirectory = path.join('scripts', 'production', 'security-app');
  await mkdir(path.join(scratch, cspDirectory), { recursive: true });
  await copyFile(
    path.join(repoRoot, cspDirectory, 'web-csp.cjs'),
    path.join(scratch, cspDirectory, 'web-csp.cjs'),
  );
  const devDirectory = path.join('scripts', 'dev');
  await mkdir(path.join(scratch, devDirectory), { recursive: true });
  await copyFile(
    path.join(repoRoot, devDirectory, 'api-endpoint.cjs'),
    path.join(scratch, devDirectory, 'api-endpoint.cjs'),
  );
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    await copyFile(path.join(repoRoot, file), path.join(scratch, file));
  }
  for (const [from, to] of [
    [repoRoot, scratch],
    [webRoot, web],
    [path.join(repoRoot, 'packages/contracts'), contracts],
  ]) {
    await linkDependencies(path.join(from, 'node_modules'), path.join(to, 'node_modules'));
  }
});

test.afterAll(async () => {
  for (const child of children) await stop(child);
  if (scratch) await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
});

test('commands pin the source config and typechecking emits no shadow config', async () => {
  const pkg = JSON.parse(await readFile(path.join(web, 'package.json'), 'utf8'));
  for (const script of ['dev', 'build', 'preview']) {
    expect(pkg.scripts[script]).toContain('--config vite.config.ts');
  }
  const config = JSON.parse(await readFile(path.join(web, 'tsconfig.node.json'), 'utf8'));
  expect(config.compilerOptions.noEmit).toBe(true);
  const check = spawnSync(process.execPath, [tscCli, '-b', 'tsconfig.node.json', '--force'], {
    cwd: web,
    encoding: 'utf8',
    timeout: 90_000,
  });
  expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
  expect(await exists(path.join(web, 'vite.config.js'))).toBe(false);
  expect(await exists(path.join(web, 'vite.config.d.ts'))).toBe(false);
  // A freshly rebuilt CommonJS entry DOES contain this value in Node. Merely
  // rebuilding it cannot make raw CommonJS into browser ESM.
  expect(loadCommonJs('@homeservicemarketplace/contracts').LEGACY_PUBLICATION_ACK_TEXT).toBe(
    'PROVIDER_CONFIRMED_RIGHT_TO_PUBLISH',
  );
  expect(loadCommonJs('@homeservicemarketplace/contracts').DISPUTE_WORKSPACE_STATES).toEqual([
    'GATHERING',
    'PROPOSED',
    'DECIDED',
    'APPEALED',
    'CLOSED',
  ]);
});

test('isolates the selector and recovers the affected admin route when an old config is auto-discovered', async ({
  page,
}, info) => {
  await writeFile(path.join(web, 'vite.config.js'), legacyConfig);
  test.setTimeout(DEV_TEST_TIMEOUT_MS);
  const server = await serve([viteCli, ...cliFlags(5197)], 5197, info, 'legacy-dev', {
    awaitDependencyOptimizer: true,
  });
  const errors: string[] = [];
  const contractRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Both bootstrap and route boundaries handle module failures. Inspect the
  // handled console error as well as unexpected unhandled exceptions.
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (/packages\/contracts\/dist\//.test(decodeURIComponent(request.url()))) {
      contractRequests.push(request.url());
    }
  });
  try {
    await seedLanguage(page, 'en');
    await stubApi(page, { me: signedInAdmin() });
    await page.goto(server.baseURL);
    // ReviewDossier and AdminDisputeInbox import runtime values from this CJS
    // barrel. Either can fail linking first; public entry must remain isolated.
    await expect(page.getByTestId('app-card-seeker')).toBeVisible();
    expect(contractRequests).toEqual([]);
    await page.getByTestId('app-card-admin').click();
    await expect.poll(() => errors.some(isLegacyContractModuleError)).toBe(true);
    expect(contractRequests.length).toBeGreaterThan(0);
    await expect(page.getByRole('alert')).toContainText('The page could not load');
    await expect(page.getByRole('button', { name: 'Reload page', exact: true })).toBeVisible();
    await expect(page.getByTestId('app-card-seeker')).toHaveCount(0);
    const screenshot = info.outputPath('before-legacy-recovery.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('before-legacy-recovery', { path: screenshot, contentType: 'image/png' });
  } catch (error) {
    const screenshot = info.outputPath('legacy-failure.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('legacy-failure', { path: screenshot, contentType: 'image/png' });
    throw error;
  } finally {
    // Preserve the actual module error even when the negative-control assertion
    // fails. A timeout without this evidence cannot distinguish a broken
    // failure fixture from a regression in the real application's recovery.
    await info.attach('legacy-errors', {
      body: JSON.stringify({ errors, contractRequests }, null, 2),
      contentType: 'application/json',
    });
    console.log('LEGACY_MODULE_DIAGNOSTICS', JSON.stringify({ errors, contractRequests }));
    await server.close();
  }
});

test('real pnpm dev renders public and Admin routes with the stale config still present', async ({
  browser,
}, info) => {
  // Write it here too: this positive test is independently executable.
  await writeFile(path.join(web, 'vite.config.js'), legacyConfig);
  const pnpm = process.env.npm_execpath;
  expect(pnpm, 'Run through pnpm test:startup so the pinned package manager is used').toBeTruthy();
  // vite:deps records runtime dependency discovery and optimizer commits, so a
  // stalled route can be correlated with the optimizer instead of guessed at.
  test.setTimeout(DEV_TEST_TIMEOUT_MS);
  const server = await serve([pnpm!, 'run', 'dev', ...cliFlags(5198)], 5198, info, 'fixed-dev', {
    env: { DEBUG: 'vite:deps' },
    awaitDependencyOptimizer: true,
  });
  const evidence: Array<Record<string, unknown>> = [];
  try {
    for (const lang of ['en', 'ar'] as const) {
      for (const [size, viewport] of Object.entries({
        desktop: { width: 1440, height: 900 },
        mobile: { width: 390, height: 844 },
      })) {
        for (const admin of [false, true]) {
          const context = await browser.newContext({ viewport });
          const page = await context.newPage();
          const errors: string[] = [];
          const distRequests: string[] = [];
          let sourceContractRequests = 0;
          // A dynamic import that neither resolves nor rejects leaves a module
          // request open. Record those so a stalled "Loading the page" names
          // its cause instead of ending as a bare locator timeout.
          const unfinished = new Map<object, string>();
          const failedRequests: string[] = [];
          const consoleProblems: string[] = [];
          page.on('request', (request) => unfinished.set(request, request.url()));
          page.on('requestfinished', (request) => unfinished.delete(request));
          page.on('requestfailed', (request) => {
            unfinished.delete(request);
            failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`);
          });
          page.on('response', (response) => {
            if (response.status() >= 400) {
              failedRequests.push(`${response.status()} ${response.url()}`);
            }
          });
          page.on('console', (message) => {
            if (['error', 'warning'].includes(message.type())) {
              consoleProblems.push(`${message.type()}: ${message.text()}`);
            }
          });
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('request', (request) => {
            const url = decodeURIComponent(request.url());
            if (/packages\/contracts\/dist\//.test(url)) distRequests.push(url);
            if (/packages\/contracts\/src\//.test(url)) sourceContractRequests++;
          });
          const label = `${admin ? 'admin' : 'public'}-${lang}-${size}`;
          const capture = async (name: string) => {
            await page.evaluate(() => document.fonts.ready);
            const screenshot = info.outputPath(`${name}.png`);
            await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
            await info.attach(name, { path: screenshot, contentType: 'image/png' });
          };
          try {
            await seedLanguage(page, lang);
            await stubApi(page, { me: admin ? signedInAdmin() : null });
            const started = Date.now();
            await page.goto(`${server.baseURL}${admin ? '/admin' : '/'}`);
            if (admin) {
              await expect(page.getByTestId('admin-approval-center')).toBeVisible();
            } else {
              for (const app of ['seeker', 'provider', 'admin']) {
                await expect(page.getByTestId(`app-card-${app}`)).toBeVisible();
              }
            }
            await expectNoHorizontalPageOverflow(page);
            await capture(`after-${label}`);
            if (admin) {
              await page
                .getByTestId('admin-approval-center')
                .getByRole('link', {
                  name: lang === 'ar' ? 'مراجعة طلبات التسجيل' : 'Review applications',
                  exact: true,
                })
                .click();
              await expect(page.getByTestId('admin-review-directory')).toBeVisible();
              await capture(`after-reviews-${lang}-${size}`);
            }
            await page.reload();
            if (admin) await expect(page.getByTestId('admin-review-directory')).toBeVisible();
            else await expect(page.getByTestId('app-card-seeker')).toBeVisible();
            await expect(page.locator('#startup-error')).toHaveCount(0);
            await expect(page.locator('vite-error-overlay')).toHaveCount(0);
            expect(errors, label).toEqual([]);
            expect(distRequests, label).toEqual([]);
            // Only the selected private experience imports runtime contracts.
            // The public route must not silently regain that eager graph.
            if (admin) expect(sourceContractRequests, label).toBeGreaterThan(0);
            else expect(sourceContractRequests, label).toBe(0);
            evidence.push({
              label,
              errors,
              distRequests,
              sourceContractRequests,
              elapsedMs: Date.now() - started,
            });
          } catch (error) {
            await capture(`failure-${label}`);
            const diagnostics = {
              label,
              url: page.url(),
              unfinishedRequests: [...unfinished.values()],
              failedRequests,
              consoleProblems,
              errors,
            };
            await info.attach(`failure-${label}-network`, {
              body: JSON.stringify(diagnostics, null, 2),
              contentType: 'application/json',
            });
            console.log('STARTUP_FAILURE_DIAGNOSTICS', JSON.stringify(diagnostics));
            throw new Error(`${label}: ${String(error)}; page errors: ${JSON.stringify(errors)}`, {
              cause: error,
            });
          } finally {
            await context.close();
          }
        }
      }
    }
    expect(await readFile(path.join(web, 'vite.config.js'), 'utf8')).toBe(legacyConfig);
    await info.attach('fixed-startup-evidence', {
      body: JSON.stringify(
        { api: 'deterministic HTTP fixtures, not a real backend', evidence },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    console.log('FIXED_STARTUP', JSON.stringify(evidence));
  } finally {
    await server.close();
  }
});

test('real pnpm dev derives the API origin and recovers fresh sign-in policy for every app', async ({
  browser,
}, info) => {
  test.setTimeout(DEV_TEST_TIMEOUT_MS);
  const pnpm = process.env.npm_execpath;
  expect(pnpm, 'Use pnpm test:startup').toBeTruthy();
  const webPort = 5201;
  const webOrigin = `http://127.0.0.1:${webPort}`;
  type Policy = { otpChannel: 'email' | 'whatsapp'; whatsappAvailable: boolean };
  let policy: Policy | undefined;
  let holdPolicy = false;
  let releasePolicy: (() => void) | undefined;
  const apiRequests: Array<{ method: string; pathname: string; origin?: string }> = [];
  // Real browser HTTP and CORS against an owned listener; policy responses are
  // deterministic fixtures, not evidence of a real backend or OTP delivery.
  const api = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const method = request.method ?? 'GET';
    apiRequests.push({ method, pathname, origin: request.headers.origin });
    response.setHeader('Access-Control-Allow-Origin', webOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'X-Client-Kind');
    response.setHeader('Cache-Control', 'no-store');
    if (method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (method === 'GET' && pathname === '/v1/auth/config') {
      const currentPolicy = policy;
      if (!currentPolicy) {
        send(503, { error: { code: 'DEPENDENCY_UNAVAILABLE' } });
      } else if (holdPolicy) {
        const release = () => send(200, currentPolicy);
        releasePolicy = release;
        response.once('close', () => {
          if (releasePolicy === release) releasePolicy = undefined;
        });
      } else send(200, currentPolicy);
      return;
    }
    send(pathname === '/v1/auth/me' ? 401 : 404, { error: { code: 'UNAUTHORIZED' } });
  });
  await new Promise<void>((resolve, reject) => {
    api.once('error', reject);
    api.listen(0, 'localhost', () => {
      api.off('error', reject);
      resolve();
    });
  });
  const address = api.address();
  if (!address || typeof address === 'string') throw new Error('Expected an owned API listener');
  const apiOrigin = `http://localhost:${address.port}`;
  const scenarios = [
    { app: 'seeker', otpChannel: 'email', whatsappAvailable: false },
    { app: 'provider', otpChannel: 'whatsapp', whatsappAvailable: false },
    { app: 'admin', otpChannel: 'whatsapp', whatsappAvailable: true },
  ] as const;
  const evidence: Array<Record<string, unknown>> = [];
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    server = await serve(
      [pnpm!, 'run', 'dev', ...cliFlags(webPort)],
      webPort,
      info,
      'derived-api-dev',
      {
        // undefined removes the inherited CI value from the spawned process.
        // The isolated checkout contains no copied private .env files.
        env: { VITE_API_URL: undefined, PORT: String(address.port) },
        awaitDependencyOptimizer: true,
      },
    );
    for (const lang of ['en', 'ar'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'en-US',
      });
      const page = await context.newPage();
      const errors: string[] = [];
      const policyRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/v1/auth/config')
          policyRequests.push(request.url());
      });
      const capture = async (name: string) => {
        await page.evaluate(() => document.fonts.ready);
        const screenshot = info.outputPath(`${name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
        await info.attach(name, { path: screenshot, contentType: 'image/png' });
      };
      try {
        await seedLanguage(page, lang);
        await page.goto(`${server.baseURL}/select`);
        for (const [index, scenario] of scenarios.entries()) {
          policy = undefined;
          const requestsBeforeEntry = policyRequests.length;
          await page.getByTestId(`app-card-${scenario.app}`).click();
          await expect(page).toHaveURL(/\/login(?:[?#]|$)/);
          await expect(page.getByTestId(`auth-hero-${scenario.app}`)).toBeVisible();
          await expect(page.getByTestId('auth-channel-whatsapp')).toBeVisible();
          await expect(page.getByRole('alert')).toHaveText(
            lang === 'ar'
              ? 'خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.'
              : 'The sign-in service is temporarily unavailable. Please try again shortly.',
          );
          await expect(page.locator('html')).toHaveAttribute('lang', lang);
          await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          const phone = page.locator('input[type="tel"]');
          await expect(phone).toBeVisible();
          await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
          const sendCode = page.getByRole('button', {
            name: lang === 'ar' ? 'إرسال رمز التحقق' : 'Send verification code',
            exact: true,
          });
          await expect(sendCode).toBeDisabled();
          await phone.fill('2025550123');
          await phone.press('Enter');
          await expect(phone).toHaveValue('2025550123');
          const retry = page.getByRole('button', {
            name: lang === 'ar' ? 'إعادة المحاولة' : 'Try again',
            exact: true,
          });
          await expect(retry).toHaveAttribute('data-tone', scenario.app);
          const label = `policy-unavailable-${scenario.app}-${lang}`;
          for (const width of [320, 390, 430, 768, 1024, 1440]) {
            await page.setViewportSize({ width, height: 844 });
            await expectNoHorizontalPageOverflow(page);
            await expect(retry).toBeVisible();
            if (width === 1440 || (width === 320 && index === 0))
              await capture(`${label}-${width}`);
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByTestId('lang-toggle').focus();
          // The branded form now stays mounted. Reach its inline retry using
          // the real tab order, which includes the existing Apps control.
          for (let tabs = 0; tabs < 8; tabs += 1) {
            await page.keyboard.press('Tab');
            if (await retry.evaluate((element) => element === document.activeElement)) break;
          }
          await expect(retry).toBeFocused();
          await expectVisibleFocusIndicator(retry, 'Policy retry');
          expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
          await capture(`${label}-keyboard-390`);
          // Explicit CSS 200% reflow evidence, not a claim of browser chrome zoom.
          await page.setViewportSize({ width: 768, height: 844 });
          await page.locator('html').evaluate((element) => {
            element.style.zoom = '2';
          });
          await expectNoHorizontalPageOverflow(page);
          await expect(retry).toBeFocused();
          await capture(`${label}-css-zoom-200`);
          await page.locator('html').evaluate((element) => {
            element.style.zoom = '';
          });
          await page.setViewportSize({ width: 390, height: 844 });
          expect(policyRequests.slice(requestsBeforeEntry)).toEqual([
            `${apiOrigin}/v1/auth/config`,
          ]);

          policy = {
            otpChannel: scenario.otpChannel,
            whatsappAvailable: scenario.whatsappAvailable,
          };
          holdPolicy = true;
          await page.keyboard.press('Enter');
          await expect.poll(() => typeof releasePolicy).toBe('function');
          // A warm cache never authorizes a request. Keep the default phone
          // draft mounted and editable while fresh administrator policy loads.
          await expect(
            page.getByRole('status').filter({
              hasText: lang === 'ar' ? 'جارٍ تجهيز تسجيل الدخول…' : 'Preparing secure sign in…',
            }),
          ).toBeVisible();
          await expect(phone).toHaveValue('2025550123');
          await expect(sendCode).toBeDisabled();
          await phone.focus();
          const pendingPhone = await phone.elementHandle();
          holdPolicy = false;
          releasePolicy!();
          await expect(page.getByTestId(`auth-hero-${scenario.app}`)).toBeVisible();
          await expect(page.getByTestId(`auth-channel-${scenario.otpChannel}`)).toBeVisible();
          const whatsapp = scenario.otpChannel === 'whatsapp';
          await expect(page.locator(`input[type="${whatsapp ? 'tel' : 'email'}"]`)).toBeVisible();
          await expect(page.locator(`input[type="${whatsapp ? 'email' : 'tel'}"]`)).toHaveCount(0);
          if (whatsapp) {
            await expect(phone).toHaveValue('2025550123');
            await expect(phone).toBeFocused();
            expect(
              await pendingPhone!.evaluate(
                (element) => element === document.querySelector('input[type="tel"]'),
              ),
            ).toBe(true);
          }
          const password = page.getByLabel(lang === 'ar' ? 'كلمة المرور' : 'Password', {
            exact: true,
          });
          const forgotPassword = page.getByRole('button', {
            name: lang === 'ar' ? 'نسيت كلمة المرور؟' : 'Forgot Password?',
            exact: true,
          });
          if (whatsapp) {
            await expect(password).toHaveCount(0);
            await expect(forgotPassword).toHaveCount(0);
          } else {
            await expect(password).toBeVisible();
            await expect(forgotPassword).toBeVisible();
          }
          await expect(
            page.getByRole('button', {
              name: whatsapp
                ? lang === 'ar'
                  ? /البريد الإلكتروني/u
                  : /email/i
                : lang === 'ar'
                  ? /واتساب/u
                  : /whatsapp/i,
            }),
          ).toHaveCount(0);
          const loginLabel = whatsapp
            ? lang === 'ar'
              ? 'إرسال رمز التحقق'
              : 'Send verification code'
            : lang === 'ar'
              ? 'دخول'
              : 'Log In';
          const login = page.getByRole('button', {
            name: loginLabel,
            exact: true,
          });
          await expect(login).toHaveAttribute('data-tone', scenario.app);
          if (whatsapp && !scenario.whatsappAvailable) await expect(login).toBeDisabled();
          else await expect(login).toBeEnabled();
          expect(policyRequests.slice(requestsBeforeEntry)).toEqual([
            `${apiOrigin}/v1/auth/config`,
            `${apiOrigin}/v1/auth/config`,
          ]);
          evidence.push({
            app: scenario.app,
            lang,
            loginLabel,
            restoredPolicy: policy,
            cachedPriorPolicy: index > 0,
            unconfirmedPresentation: 'whatsapp form; new requests disabled',
            sameChannelDraftAndFocusPreserved: whatsapp,
            policyRequests: policyRequests.slice(requestsBeforeEntry),
            widths: [320, 390, 430, 768, 1024, 1440],
            keyboardRetry: true,
            cssZoomPercent: 200,
          });
          await page.getByRole('button', { name: 'Apps', exact: true }).click();
          await expect(page.getByTestId('app-card-seeker')).toBeVisible();
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
    const receivedPolicyRequests = apiRequests.filter(
      (request) => request.method === 'GET' && request.pathname === '/v1/auth/config',
    );
    expect(receivedPolicyRequests).toHaveLength(scenarios.length * 2 * 2);
    expect(receivedPolicyRequests.every((request) => request.origin === webOrigin)).toBe(true);
    expect(apiRequests.filter((request) => request.method === 'POST')).toEqual([]);
    await info.attach('derived-api-policy-evidence', {
      body: JSON.stringify(
        {
          api: 'owned HTTP/CORS fixture; not real backend, account or delivery acceptance',
          configuredApiPort: address.port,
          explicitViteApiUrl: false,
          apiOrigin,
          evidence,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await server?.close();
    await new Promise<void>((resolve, reject) => {
      api.close((error) => (error ? reject(error) : resolve()));
      api.closeAllConnections();
    });
  }
});

for (const mode of ['dev', 'production-preview'] as const) {
  test(`${mode} stays interactive when API transport is unavailable`, async ({ page }, info) => {
    const pnpm = process.env.npm_execpath;
    expect(pnpm, 'Use pnpm test:startup').toBeTruthy();
    if (mode === 'production-preview') {
      // Build the isolated current source, never reuse a developer's old dist.
      const build = spawnSync(process.execPath, [viteCli, 'build', '--config', 'vite.config.ts'], {
        cwd: web,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, VITE_API_URL: 'https://api.example.test' },
      });
      await info.attach('r02-production-build', {
        body: `${build.stdout}\n${build.stderr}`,
        contentType: 'text/plain',
      });
      expect(build.status, 'Production source must build before preview').toBe(0);
    }
    const port = mode === 'dev' ? 5199 : 5200;
    const args =
      mode === 'dev'
        ? [pnpm!, 'run', 'dev', ...cliFlags(port)]
        : [
            viteCli,
            'preview',
            '--config',
            'vite.config.ts',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--strictPort',
          ];
    const errors: string[] = [];
    let failedApiRequests = 0;
    let failedPolicyRequests = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    await seedLanguage(page, 'en');
    await page.route('https://api.example.test/**', async (route) => {
      failedApiRequests += 1;
      if (new URL(route.request().url()).pathname === '/v1/auth/config') failedPolicyRequests += 1;
      await route.abort('connectionrefused');
    });
    if (mode === 'dev') test.setTimeout(DEV_TEST_TIMEOUT_MS);
    const server = await serve(args, port, info, `r02-${mode}`, {
      awaitDependencyOptimizer: mode === 'dev',
    });
    try {
      await page.goto(server.baseURL);
      await expect(page.getByTestId('app-card-seeker')).toBeVisible();
      await page.getByTestId('app-card-seeker').click();
      // The default phone form is useful presentation, not authorization to
      // send. It remains mounted when the transport fails or language changes.
      await expect(page.getByTestId('auth-hero-seeker')).toBeVisible();
      await expect(page.getByTestId('auth-channel-whatsapp')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveText(
        'The sign-in service is temporarily unavailable. Please try again shortly.',
      );
      const phone = page.locator('input[type="tel"]');
      await phone.fill('2025550123');
      await expect(
        page.getByRole('button', { name: 'Send verification code', exact: true }),
      ).toBeDisabled();
      await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
      const policyRequestsBeforeRetry = failedPolicyRequests;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect.poll(() => failedPolicyRequests).toBe(policyRequestsBeforeRetry + 1);
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
      await page.getByTestId('lang-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('alert')).toHaveText(
        'خدمة تسجيل الدخول غير متاحة مؤقتًا. يرجى إعادة المحاولة بعد قليل.',
      );
      await expect(page.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toBeEnabled();
      await expect(phone).toHaveValue('2025550123');
      await expect(
        page.getByRole('button', { name: 'إرسال رمز التحقق', exact: true }),
      ).toBeDisabled();
      await expect(page.getByTestId('auth-hero-seeker')).toBeVisible();
      const interactiveMs = performance.now() - server.spawnedAt;
      await expect(page.locator('#startup-error')).toHaveCount(0);
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(failedApiRequests).toBeGreaterThan(0);
      await info.attach('r02-interactive-readiness', {
        body: JSON.stringify(
          {
            mode,
            node: process.version,
            platform: process.platform,
            interactiveMs,
            start: 'owned server process spawn',
            end: 'navigation, policy retry and language change acknowledged',
            api: 'controlled browser transport failure; no backend success claimed',
            failedApiRequests,
            failedPolicyRequests,
            errors,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
      const screenshot = info.outputPath(`r02-${mode}-interactive.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      await info.attach(`r02-${mode}-interactive`, { path: screenshot, contentType: 'image/png' });
    } finally {
      await server.close();
    }
  });
}

test('occupied web port fails without killing or reusing its existing server', async ({
  page,
}, info) => {
  const occupied = createServer((_request, response) => response.end('unrelated-listener'));
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP test listener');
  let output = '';
  let failure: Error | undefined;
  const child = spawn(
    process.execPath,
    [viteCli, '--config', 'vite.config.ts', ...cliFlags(address.port)],
    {
      cwd: web,
      detached: process.platform !== 'win32',
      env: { ...process.env, VITE_API_URL: 'https://api.example.test', BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  children.add(child);
  child.stdout?.on('data', (data) => {
    output += data.toString();
  });
  child.stderr?.on('data', (data) => {
    output += data.toString();
  });
  child.on('error', (error) => {
    failure = error;
  });
  try {
    await expect
      .poll(
        () => {
          if (failure) throw failure;
          return child.exitCode;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
    expect(child.exitCode).not.toBe(0);
    expect(output).toMatch(/port .*already in use/i);
    expect(await (await page.request.get(`http://127.0.0.1:${address.port}`)).text()).toBe(
      'unrelated-listener',
    );
    await info.attach('r02-occupied-port', { body: output, contentType: 'text/plain' });
  } finally {
    await stop(child);
    await new Promise<void>((resolve, reject) =>
      occupied.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
