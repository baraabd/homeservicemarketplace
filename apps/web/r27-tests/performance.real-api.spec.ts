import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { api, loginViaUi, REAL_API, type Account } from '../e2e/real-api';
import { registerSeeker, withDb, type Seeker } from '../e2e/booking-fixtures';

const WEB = 'http://127.0.0.1:5327';
const MODE = process.env.R27_BROWSER_MODE;
const OUT = resolve('../../r27-evidence/browser', MODE ?? 'missing');
let seeker: Seeker, admin: Seeker;
type State = Awaited<ReturnType<BrowserContext['storageState']>>;
let seekerState: State, adminState: State;

function isolatedTarget() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(REAL_API, 'http://127.0.0.1:4327');
  assert.equal(process.env.E2E_MAILPIT, 'http://127.0.0.1:18027');
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf',
  );
  assert.ok(MODE === 'production' || MODE === 'development');
}

async function login(browser: Browser, account: Account): Promise<State> {
  const context = await browser.newContext();
  try {
    await context.addInitScript(() => localStorage.setItem('hsm.lang', 'en'));
    const page = await context.newPage();
    await page.goto(WEB + '/login');
    const [verified] = await Promise.all([
      page.waitForResponse(
        (r) => r.url() === REAL_API + '/v1/auth/verify-otp' && r.request().method() === 'POST',
      ),
      loginViaUi(page, account),
    ]);
    expect(verified.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    // Retained in memory only; never upload cookies or storage state.
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function contextFor(browser: Browser, info: TestInfo, state: State) {
  const context = await browser.newContext({
    storageState: state,
    viewport: info.project.use.viewport,
  });
  await context.addInitScript(
    (lang) => localStorage.setItem('hsm.lang', lang),
    info.project.metadata.lang as string,
  );
  return context;
}

async function keyboard(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

function expectNoStore(value: string | null | undefined) {
  const directives = (value ?? '')
    .toLowerCase()
    .split(',')
    .map((part) => part.trim());
  // Existing private controllers may set no-store without repeating private.
  expect(directives).toContain('no-store');
  expect(directives).not.toContain('public');
}

async function privateRead(page: Page, path: string, headers: Record<string, string> = {}) {
  return page.evaluate(
    async ({ origin, path, headers }) => {
      // Use the browser's normal cache behavior: a test-side no-store override
      // would hide the very HTTP cache defect this acceptance check exercises.
      const response = await fetch(origin + path, { credentials: 'include', headers });
      return { status: response.status, cacheControl: response.headers.get('Cache-Control') };
    },
    { origin: REAL_API, path, headers },
  );
}

async function recordAuthorityEvidence(info: TestInfo, name: string, result: unknown) {
  await writeFile(
    resolve(OUT, `${info.project.name}-${name}.json`),
    JSON.stringify(
      {
        kind: 'r27-real-browser-authority',
        mode: MODE,
        project: info.project.name,
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
        harness: process.env.R27_HARNESS_SHA,
        result,
      },
      null,
      2,
    ),
  );
}

test.beforeAll(async ({ browser }) => {
  isolatedTarget();
  // Each project and replacement worker gets an isolated fixture budget.
  // The helper verifies the disposable Redis identity and resets only its
  // throttle counters, before registrations and outside measured intervals.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { resetBrowserThrottleBuckets } from './scripts/perf/post-r18/lib/lane-env.mjs'; resetBrowserThrottleBuckets();",
    ],
    { cwd: resolve('../..'), stdio: 'pipe' },
  );
  seeker = await registerSeeker('r27-browser');
  admin = await registerSeeker('r27-browser-admin');
  // Disposable fixture only, matching the existing real-startup suite. This
  // is not acceptance of admin approval or a grant on a user/production DB.
  await withDb(async (db) => {
    const grant = await db.query(
      'INSERT INTO "UserRole" ("userId","roleId","assignedAt") SELECT $1,id,NOW() FROM "Role" WHERE name=\'admin\' AND "deletedAt" IS NULL',
      [admin.userId],
    );
    expect(grant.rowCount).toBe(1);
  });
  seekerState = await login(browser, seeker);
  adminState = await login(browser, admin);
  await mkdir(OUT, { recursive: true });
});

test('cold/warm useful UI, compile events and authenticated keyboard transitions', async ({
  browser,
}, info) => {
  const lang = info.project.metadata.lang as string;
  const results: unknown[] = [];
  for (const role of ['seeker', 'admin'] as const) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const context = await contextFor(browser, info, role === 'admin' ? adminState : seekerState);
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.name));
        const cdp = await context.newCDPSession(page);
        await cdp.send('Performance.enable');
        for (const cache of ['cold-browser', 'warm-browser'] as const) {
          const compilation: Record<string, number> = {};
          const collect = ({ value }: { value: Record<string, unknown>[] }) => {
            for (const event of value)
              if (
                event.ph === 'X' &&
                typeof event.name === 'string' &&
                /compile/i.test(event.name) &&
                typeof event.dur === 'number'
              ) {
                compilation[event.name] = (compilation[event.name] ?? 0) + event.dur / 1000;
              }
          };
          cdp.on('Tracing.dataCollected', collect);
          await cdp.send('Tracing.start', { categories: 'v8,devtools.timeline' });
          const path = role === 'admin' ? '/admin/users' : '/home';
          const expectedApi = role === 'admin' ? '/v1/admin/users' : '/v1/services';
          const start = performance.now();
          const [data] = await Promise.all([
            page.waitForResponse(
              (r) => new URL(r.url()).pathname === expectedApi && r.request().method() === 'GET',
            ),
            page.goto(WEB + path),
          ]);
          expect(data.status()).toBe(200);
          const ready =
            role === 'admin'
              ? page.getByTestId('badge-account-status').first()
              : page.locator('[data-testid="service-categories-grid"] > button').first();
          await expect(ready).toBeVisible();
          const usefulUiMs = performance.now() - start;
          await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
          const complete = new Promise<void>((done) =>
            cdp.once('Tracing.tracingComplete', () => done()),
          );
          await cdp.send('Tracing.end');
          await complete;
          cdp.off('Tracing.dataCollected', collect);
          const metrics = await page.evaluate(() => {
            const nav = performance.getEntriesByType(
              'navigation',
            )[0] as PerformanceNavigationTiming;
            const scripts = (
              performance.getEntriesByType('resource') as PerformanceResourceTiming[]
            ).filter((r) => r.initiatorType === 'script');
            return {
              documentTtfbMs: nav.responseStart - nav.requestStart,
              domContentLoadedMs: nav.domContentLoadedEventEnd,
              scriptTransferBytes: scripts.reduce((sum, r) => sum + r.transferSize, 0),
              scriptEncodedBytes: scripts.reduce((sum, r) => sum + r.encodedBodySize, 0),
            };
          });
          const timing = await cdp.send('Performance.getMetrics');
          const scriptDurationMs =
            (timing.metrics.find((m: { name: string }) => m.name === 'ScriptDuration')?.value ??
              0) * 1000;
          results.push({
            role,
            cache,
            repetition,
            usefulUiMs,
            ...metrics,
            scriptDurationMs,
            compilationEventsMs: compilation,
          });
          if (repetition === 0 && cache === 'warm-browser') {
            await page.screenshot({
              path: resolve(OUT, info.project.name + '-' + role + '.png'),
              fullPage: false,
            });
          }
        }
        if (role === 'admin' && (info.project.use.viewport?.width ?? 1440) < 1024) {
          await keyboard(page, lang === 'ar' ? 'فتح القائمة' : 'Open navigation');
        }
        const transition = performance.now();
        await keyboard(
          page,
          role === 'admin'
            ? lang === 'ar'
              ? 'لوحة التحكم'
              : 'Dashboard'
            : lang === 'ar'
              ? 'ملفي'
              : 'Profile',
        );
        await expect(
          role === 'admin'
            ? page.getByTestId('admin-approval-center')
            : page.getByRole('button', {
                name: lang === 'ar' ? 'عناويني المحفوظة' : 'Saved Addresses',
                exact: true,
              }),
        ).toBeVisible();
        results.push({ role, repetition, keyboardTransitionMs: performance.now() - transition });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  }
  await writeFile(
    resolve(OUT, info.project.name + '.json'),
    JSON.stringify(
      {
        kind: 'r27-real-browser',
        mode: MODE,
        project: info.project.name,
        source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
        harness: process.env.R27_HARNESS_SHA,
        browser: browser.version(),
        viewport: info.project.use.viewport,
        host: {
          platform: os.platform(),
          cpu: os.cpus()[0]?.model,
          logicalCpus: os.cpus().length,
          memoryGiB: os.totalmem() / 2 ** 30,
        },
        fixtureThrottleIsolation: {
          phase: 'Before project setup and registrations, outside measured intervals',
          redis: 'Identity-verified disposable R27 lane on a GitHub-hosted runner',
          keyPattern: 'rl:throttler:default:*',
          policy: 'Application login limits unchanged; sessions and application caches retained',
        },
        limits:
          'Three observations per role/cache/project: no p95/p99. Real UI login/OTP before measurement; dependency installation/build excluded. Cold means fresh browser HTTP cache; OS/server/DB caches are warm. CDP tracing adds overhead. Compile event categories may overlap; do not sum them. Shared CI VM, no network shaping, no hosted capacity claim.',
        results,
      },
      null,
      2,
    ),
  );
});

test('same browser logout/account switch cannot reuse the prior admin authorization', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    storageState: adminState,
    viewport: info.project.use.viewport,
  });
  try {
    await context.addInitScript(() => localStorage.setItem('hsm.lang', 'en'));
    const page = await context.newPage();
    await page.goto(WEB + '/admin/users');
    await expect(page.getByTestId('badge-account-status').first()).toBeVisible();
    if ((info.project.use.viewport?.width ?? 1440) < 1024) await keyboard(page, 'Open navigation');
    const [loggedOut] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() === REAL_API + '/v1/auth/logout' && response.request().method() === 'POST',
      ),
      keyboard(page, 'Sign out'),
    ]);
    expect(loggedOut.status()).toBe(204);
    await loggedOut.finished();
    // GuestOnly can expose /login before AdminDashboard's awaited logout
    // completes. Starting a login there races the later navigation and loses
    // the OTP screen. Await the actual sign-out destination, keeping this SPA
    // and its caches intact for the cross-account authorization assertion.
    await expect(page).toHaveURL(
      (url) => url.pathname === '/login' && url.searchParams.get('app') === 'admin',
    );
    const [confirmed] = await Promise.all([
      page.waitForResponse(
        (r) => r.url() === REAL_API + '/v1/auth/verify-otp' && r.request().method() === 'POST',
      ),
      loginViaUi(page, seeker),
    ]);
    expect(confirmed.status()).toBe(200);
    await expect(page).not.toHaveURL(/\/login/);
    const status = await page.evaluate(
      async (origin) =>
        (await fetch(origin + '/v1/admin/users', { credentials: 'include' })).status,
      REAL_API,
    );
    expect(status).toBe(403);
    await page.goto(WEB + '/admin/users');
    await expect(page.getByRole('heading', { name: 'User directory' })).not.toBeVisible();
  } finally {
    await context.close();
  }
  // Logout revokes the shared fixture session; subsequent tests use a fresh
  // real browser login, never replay a revoked storage snapshot.
  adminState = await login(browser, admin);
});

// These assert the coordinator's candidate repair. The immutable G1 baseline
// remains measured under its original expectations and is never relabeled.
if (process.env.R27_CANDIDATE === 'true') {
  test('private responses and early parser failures prohibit storage in the real API', async ({
    browser,
  }, info) => {
    const context = await contextFor(browser, info, seekerState);
    const anonymous = await browser.newContext();
    const statuses: Array<{ path: string; status: number }> = [];
    try {
      const page = await context.newPage();
      await page.goto(WEB + '/home');
      for (const [path, status] of [
        ['/v1/auth/me', 200],
        ['/v1/me/requests?limit=1', 200],
        ['/v1/me/bookings?limit=1', 200],
        ['/v1/me/addresses', 200],
        ['/v1/admin/users', 403],
        ['/v1/r27-synthetic-missing-route', 404],
      ] as const) {
        const response = await privateRead(page, path);
        expect(response.status).toBe(status);
        expectNoStore(response.cacheControl);
        statuses.push({ path, status: response.status });
      }
      const denied = await anonymous.request.get(REAL_API + '/v1/auth/me');
      expect(denied.status()).toBe(401);
      expectNoStore(denied.headers()['cache-control']);

      // Browser-context HTTP reaches the real early parser without requiring
      // a CORS header on a response emitted before the CORS middleware runs.
      for (const [data, headers, status] of [
        ['{', { 'Content-Type': 'application/json' }, 400],
        [
          JSON.stringify({ synthetic: 'x'.repeat(1024 * 1024) }),
          { 'Content-Type': 'application/json' },
          413,
        ],
        ['{}', { 'Content-Type': 'application/json', 'Content-Encoding': 'r27-unsupported' }, 415],
      ] as const) {
        const response = await anonymous.request.post(REAL_API + '/v1/auth/login', {
          data,
          headers,
        });
        expect(response.status()).toBe(status);
        expectNoStore(response.headers()['cache-control']);
      }
      await recordAuthorityEvidence(info, 'private-cache', {
        privateReads: statuses,
        anonymousStatus: denied.status(),
        earlyParserStatuses: [400, 413, 415],
        noStore: true,
        contradictoryPublicDirective: false,
      });
    } finally {
      await context.close();
      await anonymous.close();
    }
  });

  test('real peer-tab logout removes private UI before another account can reuse the browser', async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      storageState: adminState,
      viewport: info.project.use.viewport,
    });
    try {
      await context.addInitScript(() => localStorage.setItem('hsm.lang', 'en'));
      const active = await context.newPage();
      const peer = await context.newPage();
      for (const page of [active, peer]) {
        await page.goto(WEB + '/admin/users');
        await expect(page.getByTestId('badge-account-status').first()).toBeVisible();
      }
      if ((info.project.use.viewport?.width ?? 1440) < 1024) {
        await keyboard(active, 'Open navigation');
      }
      const [loggedOut] = await Promise.all([
        active.waitForResponse(
          (response) =>
            response.url() === REAL_API + '/v1/auth/logout' &&
            response.request().method() === 'POST',
        ),
        keyboard(active, 'Sign out'),
      ]);
      expect(loggedOut.status()).toBe(204);
      expectNoStore(loggedOut.headers()['cache-control']);
      await expect(active).toHaveURL(/\/login/);
      // No reload, synthetic storage event, injected cache reset or transport
      // interception: the second document must observe the real logout event.
      await expect(peer).toHaveURL(/\/login/);
      await expect(peer.getByTestId('badge-account-status')).toHaveCount(0);
      await expect(peer.getByRole('heading', { name: 'User directory' })).toHaveCount(0);
      const ended = await privateRead(peer, '/v1/auth/me');
      expect(ended.status).toBe(401);
      expectNoStore(ended.cacheControl);

      const [signedIn] = await Promise.all([
        active.waitForResponse(
          (response) =>
            response.url() === REAL_API + '/v1/auth/verify-otp' &&
            response.request().method() === 'POST',
        ),
        loginViaUi(active, seeker),
      ]);
      expect(signedIn.status()).toBe(200);
      await expect(active).not.toHaveURL(/\/login/);
      const switched = await privateRead(peer, '/v1/admin/users');
      expect(switched.status).toBe(403);
      expectNoStore(switched.cacheControl);
      await expect(peer.getByTestId('badge-account-status')).toHaveCount(0);
      await recordAuthorityEvidence(info, 'cross-tab-logout', {
        simultaneousDocuments: 2,
        logoutStatus: loggedOut.status(),
        peerSessionStatus: ended.status,
        switchedAdminReadStatus: switched.status,
        peerPrivateRowsRemovedWithoutReload: true,
      });
    } finally {
      await context.close();
    }
    // Logout revoked the fixture session, so later cases need a fresh login.
    adminState = await login(browser, admin);
  });

  test('warm browser reads see a revoked permission immediately and recover after its exact restoration', async ({
    browser,
  }, info) => {
    const context = await contextFor(browser, info, adminState);
    try {
      const page = await context.newPage();
      const [warm] = await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/v1/admin/users' &&
            response.request().method() === 'GET',
        ),
        page.goto(WEB + '/admin/users'),
      ]);
      expect(warm.status()).toBe(200);
      expectNoStore(warm.headers()['cache-control']);
      await expect(page.getByTestId('badge-account-status').first()).toBeVisible();
      const warmedPath = new URL(warm.url()).pathname + new URL(warm.url()).search;
      const etag = warm.headers().etag;
      assert.ok(etag, 'The warmed real API response must supply an ETag for the conditional check');
      const authority = await withDb(async (db) => {
        const result = await db.query<{ roleId: string; permissionId: string }>(
          `SELECT rp."roleId", rp."permissionId" FROM "RolePermission" rp
           JOIN "Role" r ON r.id = rp."roleId"
           JOIN "Permission" p ON p.id = rp."permissionId"
           JOIN "UserRole" ur ON ur."roleId" = r.id
           WHERE r.name = 'admin' AND r."deletedAt" IS NULL
             AND p.key = 'user:read:any' AND ur."userId" = $1`,
          [admin.userId],
        );
        expect(result.rows).toHaveLength(1);
        return result.rows[0]!;
      });
      let removed: typeof authority | undefined;
      try {
        // This original fixture row exists only in isolatedTarget's disposable
        // database. The harness is serial; restore exactly that row in finally.
        removed = await withDb(async (db) => {
          const result = await db.query<typeof authority>(
            'DELETE FROM "RolePermission" WHERE "roleId" = $1 AND "permissionId" = $2 RETURNING "roleId", "permissionId"',
            [authority.roleId, authority.permissionId],
          );
          return result.rows[0];
        });
        expect(removed).toEqual(authority);
        // Keep the existing JWT, cookies and caches. A conditional request with
        // the earlier real ETag must be forbidden, never a cached 200 or 304.
        const denied = await privateRead(page, warmedPath, { 'If-None-Match': etag });
        expect(denied.status).toBe(403);
        expectNoStore(denied.cacheControl);
        await page.getByRole('searchbox').fill(admin.email);
        const [uiDenied] = await Promise.all([
          page.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.pathname === '/v1/admin/users' && url.searchParams.get('query') === admin.email
            );
          }),
          keyboard(page, info.project.metadata.lang === 'ar' ? 'بحث' : 'Search'),
        ]);
        expect(uiDenied.status()).toBe(403);
        await expect(page.getByRole('alert')).toContainText(
          info.project.metadata.lang === 'ar'
            ? 'ليس لديك صلاحية عرض هذه البيانات.'
            : 'You do not have permission to view this information.',
        );
        await expect(page.getByTestId('badge-account-status')).toHaveCount(0);
      } finally {
        const originalRow = removed;
        if (originalRow) {
          await withDb(async (db) => {
            const restored = await db.query(
              'INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES ($1, $2)',
              [originalRow.roleId, originalRow.permissionId],
            );
            expect(restored.rowCount).toBe(1);
          });
        }
      }
      const restored = await privateRead(page, warmedPath);
      expect(restored.status).toBe(200);
      expectNoStore(restored.cacheControl);
      await recordAuthorityEvidence(info, 'permission-revocation', {
        beforeStatus: warm.status(),
        revokedConditionalReadStatus: 403,
        revokedUiReadStatus: 403,
        restoredStatus: restored.status,
        originalPermissionRowRestored: true,
        sessionReplaced: false,
        permissionCacheFlushed: false,
      });
    } finally {
      await context.close();
    }
  });
}

if (process.env.R27_CANDIDATE === 'true' && MODE === 'production') {
  test('chart chunk failure preserves the real approval queue and recovery control', async ({
    browser,
  }, info) => {
    const context = await contextFor(browser, info, adminState);
    try {
      const page = await context.newPage();
      let blocked = 0;
      await page.route('**/assets/DashboardOverview-*.js', (route) => {
        blocked++;
        return route.abort('failed');
      });
      await page.goto(WEB + '/admin');
      await expect(page.getByTestId('admin-approval-center')).toBeVisible();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(blocked).toBeGreaterThan(0);
      const reload = page.getByRole('button', {
        name: info.project.metadata.lang === 'ar' ? 'إعادة تحميل الصفحة' : 'Reload page',
        exact: true,
      });
      await reload.focus();
      await expect(reload).toBeFocused();
      const refresh = page.getByTestId('approval-refresh');
      await expect(refresh).toBeEnabled();
      await refresh.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('admin-approval-center')).toBeVisible();
      await page.screenshot({ path: resolve(OUT, info.project.name + '-chart-fallback.png') });
    } finally {
      await context.close();
    }
  });

  test('map chunk failure still saves an address and preserves persisted coordinates', async ({
    browser,
  }, info) => {
    const updated = await api(seeker.jar, '/v1/me/addresses/' + seeker.addressId, {
      method: 'PATCH',
      body: { lat: 36.1999, lng: 37.162 },
    });
    expect(updated.status).toBe(200);
    const lang = info.project.metadata.lang;
    const context = await contextFor(browser, info, seekerState);
    try {
      const page = await context.newPage();
      let blocked = 0;
      await page.route('**/assets/LocationMap-*.js', (route) => {
        blocked++;
        return route.abort('failed');
      });
      await page.goto(WEB + '/home/profile');
      await keyboard(page, lang === 'ar' ? 'عناويني المحفوظة' : 'Saved Addresses');
      expect(blocked).toBe(0);
      await keyboard(page, lang === 'ar' ? 'تعديل' : 'Edit');
      await expect(
        page.getByRole('img', {
          name: lang === 'ar' ? 'استخدم موقعي الحالي' : 'Use my current location',
        }),
      ).toBeVisible();
      expect(blocked).toBeGreaterThan(0);
      const label = lang === 'ar' ? 'اسم العنوان (مثل: منزل)' : 'Label (e.g. Home)';
      await page.getByPlaceholder(label).fill('R27 map fallback');
      const [saved] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url() === REAL_API + '/v1/me/addresses/' + seeker.addressId &&
            r.request().method() === 'PATCH',
        ),
        keyboard(page, lang === 'ar' ? 'حفظ العنوان' : 'Save Address'),
      ]);
      expect(saved.status()).toBe(200);
      const actual = await api<{
        items: { id: string; label: string; lat: number; lng: number }[];
      }>(seeker.jar, '/v1/me/addresses');
      expect(actual.body.items.find((a) => a.id === seeker.addressId)).toMatchObject({
        label: 'R27 map fallback',
        lat: 36.1999,
        lng: 37.162,
      });
      await page.screenshot({ path: resolve(OUT, info.project.name + '-map-fallback.png') });
    } finally {
      await context.close();
    }
  });
}
