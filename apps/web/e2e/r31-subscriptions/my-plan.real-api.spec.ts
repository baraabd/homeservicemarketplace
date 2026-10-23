import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { MoneyMyPlanWireV1 } from '@homeservicemarketplace/contracts';
import { SUBSCRIPTION_COPY } from '../../src/app/features/subscriptions/subscriptions.copy';
import { assertFontsReady, serveVendoredAssets } from '../prototype-assets';

// The dedicated launcher supplies isolated real PostgreSQL/Redis/API services
// and synthetic providers. Passwords and delivered OTPs remain in mode-0600
// files outside the report. No API responses, auth cookies or money state are
// manufactured in the browser. Only pinned static font assets are intercepted.
type Actor =
  | 'active'
  | 'pending'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'actionRequired'
  | 'ungranted';
interface Account {
  email: string;
  password: string;
  userId: string;
  providerProfileId: string;
  subscriptionId: string | null;
  otpFile: string;
}
interface Delivery {
  id: string;
  code: string;
  createdAt: string | null;
}
interface Session {
  context: BrowserContext;
  page: Page;
  missingAssets: string[];
  moneyMutations: string[];
}

const WIDTHS = [320, 390, 430, 768, 1024, 1440] as const;
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const EN = SUBSCRIPTION_COPY.en;
const ACTORS: Actor[] = [
  'active',
  'pending',
  'failed',
  'expired',
  'cancelled',
  'actionRequired',
  'ungranted',
];
let baseUrl: string;
let apiUrl: string;
let reportDir: string;
let accounts: Record<Actor, Account>;
let active: Session;
let initialProjection: MoneyMyPlanWireV1;

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`The real R31 browser fixture must provide ${name}.`);
  return value;
}

function privateJson<T>(path: string): T {
  if (!isAbsolute(path) || (statSync(path).mode & 0o777) !== 0o600) {
    throw new Error('R31 credentials and delivered OTPs must use private mode-0600 files.');
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function deliveredCode(account: Account, previousId: string): Promise<string> {
  let delivery: Delivery | undefined;
  await expect
    .poll(
      () => {
        delivery = privateJson<Delivery>(account.otpFile);
        return (
          delivery.id !== previousId && /^\d{6}$/.test(delivery.code) && Boolean(delivery.createdAt)
        );
      },
      {
        message: 'A fresh OTP must be delivered through the genuine mail adapter.',
        timeout: 30_000,
      },
    )
    .toBe(true);
  return delivery!.code;
}

function isApiResponse(response: Response, path: string, method = 'GET'): boolean {
  const url = new URL(response.url());
  return (
    url.origin === new URL(apiUrl).origin &&
    url.pathname === path &&
    response.request().method() === method
  );
}

function planResponse(page: Page): Promise<Response> {
  return page.waitForResponse((response) => isApiResponse(response, '/v1/money/my-plan'));
}

async function session(browser: Browser): Promise<Session> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const { missing } = await serveVendoredAssets(page);
  const moneyMutations: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.origin === new URL(apiUrl).origin &&
      url.pathname.startsWith('/v1/money/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      moneyMutations.push(request.method());
    }
  });
  return { context, page, missingAssets: missing, moneyMutations };
}

function planPath(subscriptionId: string | null): string {
  return `/provider/my-plan${subscriptionId ? `?subscriptionId=${encodeURIComponent(subscriptionId)}` : ''}`;
}

async function login(current: Session, account: Account): Promise<Response> {
  const { page } = current;
  const previous = privateJson<Delivery>(account.otpFile).id;
  // Enter the protected route so the real returnTo and auth-boundary logic run.
  await page.goto(`${baseUrl}${planPath(account.subscriptionId)}`);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.locator('input[type="email"]').fill(account.email);
  await page.locator('input[type="password"]').fill(account.password);
  const passwordResponse = page.waitForResponse((response) =>
    isApiResponse(response, '/v1/auth/login', 'POST'),
  );
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  expect((await passwordResponse).status(), 'The real password login must succeed.').toBe(200);
  await expect(page.getByTestId('otp-input')).toBeVisible();
  await page.getByTestId('otp-input').fill(await deliveredCode(account, previous));
  const verification = page.waitForResponse((response) =>
    isApiResponse(response, '/v1/auth/verify-otp', 'POST'),
  );
  const projection = planResponse(page);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(
    (await verification).status(),
    'The genuine delivered OTP must establish the session.',
  ).toBe(200);
  await expect(page).toHaveURL(new RegExp('/provider/my-plan'));
  return projection;
}

async function projection(response: Response): Promise<MoneyMyPlanWireV1> {
  expect(response.status(), 'My Plan must be served by the real API.').toBe(200);
  const body = (await response.json()) as MoneyMyPlanWireV1;
  expect(body.contractVersion).toBe('hsm.money.v1');
  expect(body.grantsIdentityVerification).toBe(false);
  expect(body.grantsWorkAccess).toBe(false);
  expect(body.policy).toMatchObject({
    state: 'POLICY_BLOCKED',
    canCancel: false,
    canRenew: false,
    canApplyCoupon: false,
  });
  return body;
}

function durableFields(body: MoneyMyPlanWireV1) {
  return {
    status: body.status,
    subscriptionId: body.subscription?.id,
    plan: body.subscription?.plan,
    currentPeriod: body.subscription?.currentPeriod,
    nextPeriod: body.subscription?.nextPeriod,
    entitlements: body.entitlements,
    history: body.history,
  };
}

async function settled(page: Page, lang: 'en' | 'ar' = 'en') {
  await expect(page.getByTestId('my-plan-refresh')).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: SUBSCRIPTION_COPY[lang].title, exact: true }),
  ).toBeVisible();
  await assertFontsReady(page);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'The page must reflow without horizontal scrolling.',
  ).toBe(true);
}

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    result.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
    'The whole My Plan page must pass the configured WCAG 2.2 AA checks.',
  ).toEqual([]);
}

async function capture(page: Page, name: string) {
  await page.screenshot({ path: join(reportDir, name), fullPage: true, animations: 'disabled' });
}

test.describe('R31 My Plan real API', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    baseUrl = requiredEnvironment('R31_BROWSER_BASE_URL').replace(/\/$/, '');
    apiUrl = requiredEnvironment('R31_BROWSER_API_URL').replace(/\/$/, '');
    reportDir = requiredEnvironment('R31_BROWSER_REPORT_DIR');
    accounts = privateJson<{ accounts: Record<Actor, Account> }>(
      requiredEnvironment('R31_BROWSER_CREDENTIALS_FILE'),
    ).accounts;
    for (const actor of ACTORS) {
      if (!accounts[actor]?.email || !accounts[actor].password || !accounts[actor].otpFile) {
        throw new Error(`The isolated R31 fixture is missing the ${actor} actor.`);
      }
    }
    mkdirSync(reportDir, { recursive: true });
    active = await session(browser);
    initialProjection = await projection(await login(active, accounts.active));
    expect(initialProjection.status).toBe('ACTIVE');
    expect(initialProjection.subscription?.id).toBe(accounts.active.subscriptionId);
    expect(initialProjection.subscription?.currentPeriod).not.toBeNull();
    expect(initialProjection.entitlements.some((item) => item.used > 0)).toBe(true);
  });

  test.afterAll(async () => {
    await active?.context.close();
  });

  test('renders the active plan across bilingual viewport, keyboard and accessibility checks', async () => {
    const { page } = active;
    for (const lang of ['en', 'ar'] as const) {
      if (lang === 'ar') await page.getByRole('button', { name: EN.language, exact: true }).click();
      const copy = SUBSCRIPTION_COPY[lang];
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await settled(page, lang);
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByTestId('my-plan-status')).toHaveText(copy.states.ACTIVE);
        await expect(page.getByText(copy.authority, { exact: true })).toBeVisible();
        await noOverflow(page);
        if (lang === 'ar' && width === 320) {
          const limited = initialProjection.entitlements.find(
            (item) => item.limit !== null && item.used > 0,
          );
          expect(limited, 'The real fixture must include consumed numeric usage.').toBeDefined();
          const numericUsage = await page.evaluate(({ used, limit }) => {
            const number = new Intl.NumberFormat('ar');
            return `${number.format(used)} / ${number.format(limit!)}`;
          }, limited!);
          const usage = page.getByText(numericUsage, { exact: true });
          await expect(usage).toHaveCSS('direction', 'ltr');
          expect(
            await usage.evaluate((element) => {
              const parts = Array.from(element.childNodes).filter(
                (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
              );
              const used = document.createRange();
              const limit = document.createRange();
              used.selectNodeContents(parts[0]);
              limit.selectNodeContents(parts[parts.length - 1]);
              return used.getBoundingClientRect().left < limit.getBoundingClientRect().left;
            }),
            'The used count must stay before the limit visually inside the RTL page.',
          ).toBe(true);
        }
        const controls = page.getByRole('navigation', { name: copy.title }).locator('button, a');
        for (const control of await controls.all()) {
          expect(
            (await control.boundingBox())?.height,
            'Navigation touch targets must be at least 44 CSS pixels.',
          ).toBeGreaterThanOrEqual(44);
        }
        if (width === 320 || width === 1440) await accessible(page);
        await capture(page, `my-plan-${lang}-${width}.png`);
      }

      await page.getByRole('link', { name: copy.back, exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: copy.language, exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: copy.dark, exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('my-plan-refresh')).toBeFocused();
      expect(
        await page.getByTestId('my-plan-refresh').evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            element.matches(':focus-visible') &&
            (style.boxShadow !== 'none' || Number.parseFloat(style.outlineWidth) >= 2)
          );
        }),
        'Keyboard focus must have a visible indicator.',
      ).toBe(true);
      const refreshResponse = planResponse(page);
      await page.keyboard.press('Enter');
      expect(durableFields(await projection(await refreshResponse))).toEqual(
        durableFields(initialProjection),
      );

      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: copy.dark, exact: true }).click();
      await expect(page.getByRole('button', { name: copy.light, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await noOverflow(page);
      await accessible(page);
      await capture(page, `my-plan-${lang}-dark-390.png`);
      await page.getByRole('button', { name: copy.light, exact: true }).click();

      // CSS zoom is an explicit reflow check, separate from the viewport matrix.
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      await noOverflow(page);
      await expect(page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible();
      await page.evaluate(() => {
        document.documentElement.style.zoom = '';
      });
    }
    await page.getByRole('button', { name: SUBSCRIPTION_COPY.ar.language, exact: true }).click();
    expect(active.missingAssets).toEqual([]);
    expect(active.moneyMutations).toEqual([]);
  });

  test('refetches authoritative plan details after refresh, reload and reconnect and rejects another owner', async () => {
    const { context, page } = active;
    await page.setViewportSize({ width: 390, height: 844 });
    await settled(page);
    const refreshed = planResponse(page);
    await page.getByTestId('my-plan-refresh').click();
    expect(durableFields(await projection(await refreshed))).toEqual(
      durableFields(initialProjection),
    );

    const reloaded = planResponse(page);
    await page.reload();
    expect(durableFields(await projection(await reloaded))).toEqual(
      durableFields(initialProjection),
    );
    await settled(page);
    await expect(page.getByRole('combobox', { name: EN.purchased, exact: true })).toHaveValue(
      accounts.active.subscriptionId!,
    );

    await context.setOffline(true);
    await expect(page.getByText(EN.offline, { exact: true })).toBeVisible();
    await expect(page.getByTestId('my-plan-refresh')).toBeDisabled();
    await expect(page.getByTestId('my-plan-status')).toHaveText(EN.states.ACTIVE);
    const reconnected = planResponse(page);
    await context.setOffline(false);
    expect(durableFields(await projection(await reconnected))).toEqual(
      durableFields(initialProjection),
    );
    await expect(page.getByText(EN.offline, { exact: true })).toHaveCount(0);

    expect(accounts.expired.subscriptionId).not.toBeNull();
    const refused = planResponse(page);
    await page.goto(`${baseUrl}${planPath(accounts.expired.subscriptionId)}`);
    expect((await refused).status(), 'Another owner’s subscription must be refused.').toBe(404);
    await expect(page.getByText(EN.denied, { exact: true })).toBeVisible();
    await expect(page.getByTestId('my-plan-status')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: EN.purchased, exact: true })).toHaveCount(0);
    const restored = planResponse(page);
    await page.goto(`${baseUrl}${planPath(accounts.active.subscriptionId)}`);
    expect(durableFields(await projection(await restored))).toEqual(
      durableFields(initialProjection),
    );
    expect(active.moneyMutations).toEqual([]);
  });

  test('renders genuine pending, failed, expired, cancelled and action-required payments and denies ungranted access', async ({
    browser,
  }) => {
    const states = [
      ['pending', 'PENDING_PAYMENT'],
      ['failed', 'FAILED'],
      ['expired', 'EXPIRED'],
      ['cancelled', 'CANCELLED'],
      ['actionRequired', 'ACTION_REQUIRED'],
    ] as const;
    for (const [actor, expected] of states) {
      const current = await session(browser);
      try {
        const body = await projection(await login(current, accounts[actor]));
        expect(body.status).toBe(expected);
        await settled(current.page);
        await expect(current.page.getByTestId('my-plan-status')).toHaveText(EN.states[expected]);
        await expect(
          current.page.getByRole('button', { name: /buy|renew|cancel|coupon/i }),
        ).toHaveCount(0);
        await noOverflow(current.page);
        if (actor === 'failed') {
          expect(body.payment?.latestAttemptStatus).toBe('FAILED');
          await expect(current.page.getByTestId('my-plan-payment-status')).toHaveText(
            EN.payments.PROCESSING,
          );
          await expect(current.page.getByTestId('my-plan-payment-attempt')).toHaveText(
            EN.attemptFailed,
          );
        }
        if (actor === 'pending') {
          const returned = planResponse(current.page);
          const path = planPath(accounts.pending.subscriptionId);
          await current.page.goto(
            `${baseUrl}${path}${path.includes('?') ? '&' : '?'}success=true&payment_status=paid`,
          );
          expect((await projection(await returned)).status).toBe('PENDING_PAYMENT');
          await expect(current.page.getByTestId('my-plan-status')).toHaveText(
            EN.states.PENDING_PAYMENT,
          );
          await expect(current.page.getByText(EN.paymentPending, { exact: true })).toBeVisible();
        }
        await accessible(current.page);
        await capture(current.page, `my-plan-state-${actor}-390.png`);
        expect(current.missingAssets).toEqual([]);
        expect(current.moneyMutations).toEqual([]);
      } finally {
        await current.context.close();
      }
    }

    const ungranted = await session(browser);
    try {
      expect((await login(ungranted, accounts.ungranted)).status()).toBe(403);
      await expect(ungranted.page.getByText(EN.denied, { exact: true })).toBeVisible();
      await expect(ungranted.page.getByTestId('my-plan-status')).toHaveCount(0);
      await expect(
        ungranted.page.getByRole('heading', { name: EN.catalog, exact: true }),
      ).toHaveCount(0);
      await assertFontsReady(ungranted.page);
      await noOverflow(ungranted.page);
      await accessible(ungranted.page);
      await capture(ungranted.page, 'my-plan-state-ungranted-390.png');
      expect(ungranted.moneyMutations).toEqual([]);
    } finally {
      await ungranted.context.close();
    }
  });

  test('restores the same purchased version and usage after a fresh browser login', async ({
    browser,
  }) => {
    const fresh = await session(browser);
    try {
      expect(await fresh.context.cookies()).toEqual([]);
      const body = await projection(await login(fresh, accounts.active));
      expect(durableFields(body)).toEqual(durableFields(initialProjection));
      await settled(fresh.page);
      await expect(
        fresh.page.getByRole('combobox', { name: EN.purchased, exact: true }),
      ).toHaveValue(accounts.active.subscriptionId!);
      await expect(fresh.page.getByTestId('my-plan-status')).toHaveText(EN.states.ACTIVE);

      await fresh.page.getByRole('link', { name: EN.back, exact: true }).click();
      await expect(fresh.page).toHaveURL(`${baseUrl}/provider/profile`);
      await expect(fresh.page.getByTestId('provider-menu-my-plan')).toBeVisible();
      const fromProfile = planResponse(fresh.page);
      await fresh.page.getByTestId('provider-menu-my-plan').click();
      await expect(fresh.page).toHaveURL(`${baseUrl}/provider/my-plan`);
      expect(durableFields(await projection(await fromProfile))).toEqual(
        durableFields(initialProjection),
      );
      await settled(fresh.page);
      expect(fresh.missingAssets).toEqual([]);
      expect(fresh.moneyMutations).toEqual([]);
    } finally {
      await fresh.context.close();
    }
  });
});
