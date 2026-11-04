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
  options: { env?: Record<string, string>; awaitDependencyOptimizer?: boolean } = {},
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
    page.on('pageerror', (error) => errors.push(error.message));
    await seedLanguage(page, 'en');
    await page.route('https://api.example.test/**', async (route) => {
      failedApiRequests += 1;
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
      const email = page.locator('input[type="email"]');
      await expect(email).toBeVisible();
      await email.fill('startup-check@example.test');
      await expect(email).toHaveValue('startup-check@example.test');
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
            end: 'navigation and editable input acknowledged',
            api: 'controlled browser transport failure; no backend success claimed',
            failedApiRequests,
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
