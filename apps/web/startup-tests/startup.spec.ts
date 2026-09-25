import { expect, test, type TestInfo } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
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
  'node_modules', 'dist', '.turbo', '.git', 'test-results',
  'playwright-report', 'coverage', 'vite.config.js', 'vite.config.d.ts',
]);

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
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
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
    for (let i = 0; i < 50 && child.exitCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
  }
  children.delete(child);
}

async function serve(args: string[], port: number, info: TestInfo, name: string) {
  let output = '';
  let failure: Error | undefined;
  const child = spawn(process.execPath, args, {
    cwd: web,
    detached: process.platform !== 'win32',
    env: { ...process.env, VITE_API_URL: 'https://api.example.test', BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  child.stdout?.on('data', (data) => { output += data.toString(); });
  child.stderr?.on('data', (data) => { output += data.toString(); });
  child.on('error', (error) => { failure = error; });
  const baseURL = `http://127.0.0.1:${port}`;
  const close = async () => {
    await stop(child);
    const log = info.outputPath(`${name}.log`);
    await writeFile(log, output);
    await info.attach(name, { path: log, contentType: 'text/plain' });
  };
  try {
    await expect.poll(async () => {
      if (failure) throw failure;
      if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
      try {
        return (await fetch(baseURL, { signal: AbortSignal.timeout(1000) })).ok;
      } catch { return false; }
    }, { timeout: 90_000, message: `Waiting for ${name}` }).toBe(true);
    return { baseURL, close };
  } catch (error) {
    await close();
    throw error;
  }
}

const cliFlags = (port: number) => [
  '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--force',
];

test.beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'hsm-startup-'));
  web = path.join(scratch, 'apps/web');
  const contracts = path.join(scratch, 'packages/contracts');
  const filter = (source: string) => {
    const name = path.basename(source);
    return !omitted.has(name) && !name.startsWith('.env') && !name.endsWith('.tsbuildinfo');
  };
  await cp(webRoot, web, { recursive: true, filter });
  await cp(path.join(repoRoot, 'packages/contracts'), contracts, { recursive: true, filter });
  for (const file of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.base.json']) {
    await copyFile(path.join(repoRoot, file), path.join(scratch, file));
  }
  for (const [from, to] of [
    [repoRoot, scratch], [webRoot, web], [path.join(repoRoot, 'packages/contracts'), contracts],
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
    cwd: web, encoding: 'utf8', timeout: 90_000,
  });
  expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0);
  expect(await exists(path.join(web, 'vite.config.js'))).toBe(false);
  expect(await exists(path.join(web, 'vite.config.d.ts'))).toBe(false);
  // A freshly rebuilt CommonJS entry DOES contain this value in Node. Merely
  // rebuilding it cannot make raw CommonJS into browser ESM.
  expect(loadCommonJs('@homeservicemarketplace/contracts').LEGACY_PUBLICATION_ACK_TEXT)
    .toBe('PROVIDER_CONFIRMED_RIGHT_TO_PUBLISH');
});

test('reproduces the blank screen when Vite auto-discovers an old generated config', async ({ page }, info) => {
  await writeFile(path.join(web, 'vite.config.js'), legacyConfig);
  const server = await serve([viteCli, ...cliFlags(5197)], 5197, info, 'legacy-dev');
  const errors: string[] = [];
  const contractRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/packages\/contracts\/dist\//.test(decodeURIComponent(request.url()))) {
      contractRequests.push(request.url());
    }
  });
  try {
    await stubApi(page);
    await page.goto(server.baseURL);
    await expect.poll(() => errors.some((message) =>
      /does not provide an export named|exports is not defined/.test(message),
    )).toBe(true);
    expect(contractRequests.length).toBeGreaterThan(0);
    await expect(page.locator('#root')).toBeEmpty();
    const screenshot = info.outputPath('before-legacy-blank.png');
    await page.screenshot({ path: screenshot, fullPage: true });
    await info.attach('before-legacy-blank', { path: screenshot, contentType: 'image/png' });
    await info.attach('legacy-errors', {
      body: JSON.stringify({ errors, contractRequests }, null, 2), contentType: 'application/json',
    });
    console.log('REPRODUCED', JSON.stringify(errors));
  } finally {
    await server.close();
  }
});

test('real pnpm dev renders public and Admin routes with the stale config still present', async ({ browser }, info) => {
  // Write it here too: this positive test is independently executable.
  await writeFile(path.join(web, 'vite.config.js'), legacyConfig);
  const pnpm = process.env.npm_execpath;
  expect(pnpm, 'Run through pnpm test:startup so the pinned package manager is used').toBeTruthy();
  const server = await serve([pnpm!, 'run', 'dev', ...cliFlags(5198)], 5198, info, 'fixed-dev');
  const evidence: Array<Record<string, unknown>> = [];
  try {
    for (const lang of ['en', 'ar'] as const) {
      for (const [size, viewport] of Object.entries({
        desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 },
      })) {
        for (const admin of [false, true]) {
          const context = await browser.newContext({ viewport });
          const page = await context.newPage();
          const errors: string[] = [];
          const distRequests: string[] = [];
          let sourceContractRequests = 0;
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
              await expect(page.locator('#root')).not.toBeEmpty();
              await expect(page.locator('#root').locator('button, a, input').first()).toBeVisible();
            }
            await expectNoHorizontalPageOverflow(page);
            await capture(`after-${label}`);
            if (admin) {
              await page.getByTestId('admin-approval-center').getByRole('link', {
                name: lang === 'ar' ? 'مراجعة طلبات التسجيل' : 'Review applications', exact: true,
              }).click();
              await expect(page.getByTestId('admin-review-directory')).toBeVisible();
              await capture(`after-reviews-${lang}-${size}`);
            }
            await page.reload();
            if (admin) await expect(page.getByTestId('admin-review-directory')).toBeVisible();
            else await expect(page.locator('#root').locator('button, a, input').first()).toBeVisible();
            await expect(page.locator('vite-error-overlay')).toHaveCount(0);
            expect(errors, label).toEqual([]);
            expect(distRequests, label).toEqual([]);
            expect(sourceContractRequests, label).toBeGreaterThan(0);
            evidence.push({ label, errors, distRequests, sourceContractRequests, elapsedMs: Date.now() - started });
          } catch (error) {
            await capture(`failure-${label}`);
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
      body: JSON.stringify({ api: 'deterministic HTTP fixtures, not a real backend', evidence }, null, 2),
      contentType: 'application/json',
    });
    console.log('FIXED_STARTUP', JSON.stringify(evidence));
  } finally {
    await server.close();
  }
});
