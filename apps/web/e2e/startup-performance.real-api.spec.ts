import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Browser, type BrowserContext } from '@playwright/test';

import { api, loginViaUi, REAL_API, type Account } from './real-api';
import { leafCategoryId, registerSeeker, withDb, workingProvider } from './booking-fixtures';
import { submittedProvider } from './admin-review-real-api';

// This opt-in test owns a disposable CI database, not a developer/live target.
// Accounts register and verify via the real API/SMTP. Measured cookie states
// are issued by real browser login + OTP. Provider approval and the admin-role
// grant are explicit database fixtures, not acceptance of those workflows.
// No route is intercepted. No cookies, traces, screenshots, raw exceptions,
// response bodies, account identifiers or session files enter the artifacts.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

const WEB = 'http://127.0.0.1:4173';
const API = 'http://127.0.0.1:4010';
const MAIL = 'http://127.0.0.1:8025';
const OUT = resolve('test-results/startup-performance');
const runFile = promisify(execFile);
const routeNames = ['public-selector', 'login', 'seeker-home', 'provider-jobs', 'admin-dashboard'];

type Interaction = {
  type: 'click' | 'fill';
  selector: string;
  value?: string;
  acknowledge?: { selector: string; state: 'visible' | 'hidden' };
};
type Scenario = {
  name: string;
  path: string;
  readySelectors: string[];
  storageState?: string;
  interactions: Interaction[];
  expectedHttpErrors?: { url: string; method: 'GET'; status: 401; maxCount: 1 }[];
};
type Measurement = {
  schemaVersion: number;
  status: string;
  revision: string;
  apiMode: string;
  environment: { browser: string };
  results: {
    route: string;
    mode: string;
    repetition: number;
    status: string;
    metrics: { contentReadyMs: number } | null;
    interactions: { acknowledged: boolean }[];
    networkIncludingInteractions: {
      counts: { pageErrors: number; failedRequests: number; unexpectedConsoleErrors: number };
      unexpectedHttpErrorsByStatus: Record<string, number>;
    };
  }[];
};

function verifyIsolatedTarget(): string {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This fixture runs only in GitHub Actions');
  assert.equal(
    process.env.RUNNER_ENVIRONMENT,
    'github-hosted',
    'A disposable hosted runner is required',
  );
  assert.equal(process.env.HSM_STARTUP_PERFORMANCE, 'isolated-ci');
  assert.equal(REAL_API, API);
  assert.equal(process.env.E2E_BASE_URL, WEB);
  assert.equal(process.env.E2E_MAILPIT, MAIL);
  const database = new URL(process.env.DATABASE_URL ?? 'postgresql://missing/missing');
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
  assert.equal(database.pathname, '/hsm_startup_ci');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.match(revision, /^[a-f0-9]{40}$/u);
  assert.equal(
    revision,
    process.env.HSM_MEASUREMENT_SHA,
    'Measurements must name the checked-out source',
  );
  return revision;
}

async function grantFixtureAdmin(userId: string): Promise<void> {
  await withDb(async (db) => {
    const result = await db.query(
      `INSERT INTO "UserRole" ("userId", "roleId", "assignedAt")
       SELECT $1, id, NOW() FROM "Role" WHERE name = 'admin' AND "deletedAt" IS NULL
       ON CONFLICT DO NOTHING`,
      [userId],
    );
    assert.equal(result.rowCount, 1, 'The synthetic admin receives one seeded role');
  });
}

async function browserSession(
  browser: Browser,
  account: Account,
  scenario: Scenario,
  role: string,
  privateDirectory: string,
): Promise<string> {
  const context: BrowserContext = await browser.newContext({ locale: 'en-US' });
  try {
    await context.addInitScript(() => localStorage.setItem('hsm.lang', 'en'));
    const page = await context.newPage();
    await page.goto(`${WEB}${scenario.path}`);
    await expect(page).toHaveURL(/\/login(?:\?|$)/u);
    const verified = page.waitForResponse(
      (response) =>
        response.url() === `${API}/v1/auth/verify-otp` && response.request().method() === 'POST',
    );
    await loginViaUi(page, account);
    expect((await verified).status(), 'The browser must complete real OTP verification').toBe(200);
    await expect(page).toHaveURL(`${WEB}${scenario.path}`);
    for (const selector of scenario.readySelectors) {
      await expect(page.locator(selector)).toBeVisible({ timeout: 30_000 });
    }
    const identity = await page.evaluate(async (origin) => {
      const response = await fetch(`${origin}/v1/auth/me`, { credentials: 'include' });
      const body = (await response.json()) as { roles?: string[] };
      return { status: response.status, roles: body.roles ?? [] };
    }, API);
    expect(identity.status).toBe(200);
    expect(identity.roles).toContain(role);
    // Preserve exactly the browser-established state. There is no fabricated
    // bearer token, test-only auth endpoint, or browser role override.
    const statePath = join(privateDirectory, `${scenario.name}.json`);
    await writeFile(statePath, JSON.stringify(await context.storageState()), { mode: 0o600 });
    return statePath;
  } finally {
    await context.close();
  }
}

function assertMeasurement(report: Measurement, revision: string): void {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.status, 'completed');
  assert.equal(report.revision, revision);
  assert.equal(report.apiMode, 'real');
  assert.ok(report.environment.browser, 'The actual browser version is recorded');
  assert.equal(report.results.length, 50, 'Five routes × five cold/warm pairs must all execute');
  const seen = new Set();
  for (const result of report.results) {
    assert.ok(routeNames.includes(result.route));
    assert.ok(['cold', 'warm'].includes(result.mode));
    assert.ok(
      Number.isInteger(result.repetition) && result.repetition >= 1 && result.repetition <= 5,
    );
    const key = `${result.route}:${result.mode}:${result.repetition}`;
    assert.ok(!seen.has(key), 'Duplicate samples cannot replace missing samples');
    seen.add(key);
    assert.equal(result.status, 'passed');
    assert.ok(Number.isFinite(result.metrics?.contentReadyMs));
    assert.ok(
      result.interactions.length > 0 && result.interactions.every((action) => action.acknowledged),
    );
    assert.equal(result.networkIncludingInteractions.counts.pageErrors, 0);
    assert.equal(result.networkIncludingInteractions.counts.failedRequests, 0);
    assert.equal(result.networkIncludingInteractions.counts.unexpectedConsoleErrors, 0);
    assert.deepEqual(result.networkIncludingInteractions.unexpectedHttpErrorsByStatus, {});
  }
}

test('real Seeker, Provider and Admin startup: five cold/warm pairs on desktop and mobile', async ({
  browser,
}) => {
  test.setTimeout(18 * 60_000);
  let stage = 'isolated-target';
  let privateDirectory: string | undefined;
  const acceptance = {
    schemaVersion: 1,
    status: 'RUNNING',
    sourceSha: '',
    startedAt: new Date().toISOString(),
    finishedAt: '',
    failureStage: null as string | null,
    profiles: [] as { name: string; observations: number; status: string }[],
    expectedObservations: 100,
    fixtureAuthority: {
      accounts:
        'Public registration and email OTP; real browser login and OTP issue every measured session',
      provider:
        'Existing workingProvider database approval fixture plus explicit stored Aleppo coordinates',
      admin:
        'One admin role is granted to a newly registered synthetic account in the disposable database',
      queue: 'A second provider completes and submits onboarding through real public API endpoints',
      requests: 'A seeker creates one request through the real authenticated public API',
    },
    conditions: {
      browserBuild:
        'Vite production build, served by vite preview; not the Vite development server',
      apiRuntime:
        'Compiled real API with development configuration on disposable PostgreSQL/Redis/SMTP',
      language: 'English LTR',
      flags: { providerOnboardingV2: true, verificationEnforced: true, workAccessEnforced: true },
      sessionTtlSeconds: 1800,
      anonymousException:
        'At most one GET /v1/auth/me 401 per public-page navigation; exact URL and native console resource message only',
      limitations:
        'Small synthetic data on one GitHub-hosted runner. Mobile means a 390px viewport plus CPU/network simulation, not a physical mobile device. No production capacity or field Core Web Vitals claim. Actual public map tiles remain external network requests.',
    },
  };
  try {
    acceptance.sourceSha = verifyIsolatedTarget();
    await mkdir(OUT, { recursive: true });
    privateDirectory = await mkdtemp(join(tmpdir(), 'hsm-startup-sessions-'));
    stage = 'register-seeker';
    const seeker = await registerSeeker('startup');
    stage = 'load-category';
    const categoryId = await leafCategoryId();
    stage = 'seed-working-provider';
    const provider = await workingProvider(categoryId, 'startup');
    stage = 'store-provider-coordinates';
    await withDb(async (db) => {
      await db.query(
        `UPDATE "ProviderProfile" SET "serviceAreaLat" = 36.2021, "serviceAreaLng" = 37.1343
         WHERE id = $1`,
        [provider.profileId],
      );
    });
    stage = 'submit-pending-provider';
    const pending = await submittedProvider();
    stage = 'register-admin';
    const admin = await registerSeeker('startup-admin');
    stage = 'grant-admin-role';
    await grantFixtureAdmin(admin.userId);
    stage = 'create-request';
    const request = await api<{ id: string }>(seeker.jar, '/v1/me/requests', {
      method: 'POST',
      body: {
        categoryId,
        customServiceText: null,
        description: 'Startup acceptance synthetic request',
        mediaAssetIds: [],
        scheduleType: 'ASAP',
        scheduledAt: null,
        addressId: seeker.addressId,
        manualAddress: null,
      },
    });
    expect(request.status, 'The readiness lead must be durably created').toBe(201);
    stage = 'verify-provider-feed';
    const available = await api<{ items: { id: string }[] }>(
      provider.jar,
      '/v1/provider/available-requests',
    );
    expect(available.status).toBe(200);
    expect(available.body.items.map((item) => item.id)).toEqual([request.body.id]);

    const roles: { account: Account; role: string; scenario: Scenario }[] = [
      {
        account: seeker,
        role: 'customer',
        scenario: {
          name: 'seeker-home',
          path: '/home',
          readySelectors: [
            '[data-testid="home-header-name"]',
            '[data-testid="service-categories-grid"] > button:first-child',
            '[data-testid="active-leads-carousel"] [data-testid="lead-card"][data-status="pending"]',
          ],
          interactions: [
            {
              type: 'click',
              selector: '[data-testid="service-categories-grid"] > button:first-child',
              acknowledge: {
                selector: 'button:text-is("Next Step · Location & Time")',
                state: 'visible',
              },
            },
          ],
        },
      },
      {
        account: provider,
        role: 'provider',
        scenario: {
          name: 'provider-jobs',
          path: '/provider/jobs',
          readySelectors: [
            '[data-testid="provider-bottom-nav"]',
            '[data-testid="job-count-badge"]:text-is("1")',
          ],
          interactions: [
            {
              type: 'click',
              selector: '[data-testid="pull-up-control"]',
              acknowledge: {
                selector: `[data-testid="job-card-${request.body.id}"]`,
                state: 'visible',
              },
            },
            {
              type: 'click',
              selector: `[data-testid="job-card-${request.body.id}"]`,
              acknowledge: { selector: '[data-testid="job-detail-overlay"]', state: 'visible' },
            },
          ],
        },
      },
      {
        account: admin,
        role: 'admin',
        scenario: {
          name: 'admin-dashboard',
          path: '/admin',
          readySelectors: [
            '[data-testid="admin-approval-center"]',
            `[data-testid="approval-preview-${pending.profileId}"]`,
          ],
          interactions: [
            {
              type: 'click',
              selector: `[data-testid="approval-preview-${pending.profileId}"] a`,
              acknowledge: { selector: '[data-testid="review-task-tabs"]', state: 'visible' },
            },
          ],
        },
      },
    ];
    for (const item of roles) {
      stage = `browser-login-${item.scenario.name}`;
      item.scenario.storageState = await browserSession(
        browser,
        item.account,
        item.scenario,
        item.role,
        privateDirectory,
      );
    }
    const expectedHttpErrors: NonNullable<Scenario['expectedHttpErrors']> = [
      { url: `${API}/v1/auth/me`, method: 'GET', status: 401, maxCount: 1 },
    ];
    const routes: Scenario[] = [
      {
        name: 'public-selector',
        path: '/select',
        readySelectors: ['[data-testid="app-card-seeker"]'],
        expectedHttpErrors,
        interactions: [
          {
            type: 'click',
            selector: '[data-testid="app-card-seeker"]',
            acknowledge: { selector: 'input[type="email"]', state: 'visible' },
          },
        ],
      },
      {
        name: 'login',
        path: '/login',
        readySelectors: ['input[type="email"]', 'input[type="password"]'],
        expectedHttpErrors,
        interactions: [
          {
            type: 'fill',
            selector: 'input[type="email"]',
            value: 'startup-measurement@example.test',
          },
        ],
      },
      ...roles.map((item) => item.scenario),
    ];
    const profiles = [
      { name: 'desktop', viewport: { width: 1440, height: 900 }, cpuSlowdown: 1 },
      {
        name: 'mobile',
        viewport: { width: 390, height: 844 },
        cpuSlowdown: 4,
        network: { latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 },
      },
    ];
    for (const profile of profiles) {
      stage = `measure-${profile.name}`;
      const configPath = join(privateDirectory, `${profile.name}-scenarios.json`);
      const output = join(OUT, `${profile.name}.json`);
      await writeFile(
        configPath,
        JSON.stringify({
          ...profile,
          routes,
          language: 'en',
          locale: 'en-US',
          timezoneId: 'UTC',
          timeoutMs: 20_000,
          observationMs: 750,
        }),
        { mode: 0o600 },
      );
      console.log(`Measuring ${profile.name}: five cold/warm pairs for each of five real routes`);
      await runFile(
        process.execPath,
        [
          resolve('scripts/measure-startup.mjs'),
          '--base-url',
          WEB,
          '--api-mode',
          'real',
          '--revision',
          acceptance.sourceSha,
          '--config',
          configPath,
          '--output',
          output,
          '--repetitions',
          '5',
        ],
        { timeout: 7 * 60_000, maxBuffer: 1024 * 1024 },
      );
      stage = `assert-${profile.name}-measurements`;
      const report = JSON.parse(await readFile(output, 'utf8')) as Measurement;
      assertMeasurement(report, acceptance.sourceSha);
      acceptance.profiles.push({
        name: profile.name,
        observations: report.results.length,
        status: 'PASS',
      });
    }
    assert.equal(
      acceptance.profiles.reduce((sum, profile) => sum + profile.observations, 0),
      100,
    );
    acceptance.status = 'PASS';
  } catch {
    acceptance.status = 'FAIL';
    acceptance.failureStage = stage;
    // Raw fixture/child/browser errors can contain credentials or HTTP bodies.
    // Public diagnostics retain only internally selected stages and counters.
    throw new Error(
      `Real startup performance acceptance failed at ${stage}; inspect sanitized measurement JSON.`,
    );
  } finally {
    if (privateDirectory) await rm(privateDirectory, { recursive: true, force: true });
    if (acceptance.sourceSha) {
      acceptance.finishedAt = new Date().toISOString();
      await writeFile(join(OUT, 'acceptance.json'), `${JSON.stringify(acceptance, null, 2)}\n`, {
        mode: 0o600,
      });
    }
  }
});
