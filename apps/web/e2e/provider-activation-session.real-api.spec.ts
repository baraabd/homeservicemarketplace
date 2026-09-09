import { expect, test, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { api, newJar, otpFor, REAL_API, type Jar } from './real-api';

// Sprint 09B.29, repair A — the activation journey, in a real browser.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// WHAT THIS PROVES THAT NOTHING ELSE CAN
//
// The API suite proves the SERVER answers correctly across the transition. The
// component suite proves the SCREEN renders each state. Neither can show that a
// real browser, holding real cookies, driving the real login and the real
// upgrade, ends up inside V2 rather than in a 403 loop — because both replace
// the transport that the defect lives in.
//
// `docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md` records this exact
// defect as "open, not fixed": *"a newly promoted provider gets 403 on every
// provider route until their session refreshes"*, and notes the existing
// harness reproduces it deliberately by refreshing behind the scenes. This
// spec does NOT refresh behind the scenes. The browser must do it, through the
// product, or these assertions fail.
//
// NO ROUTE INTERCEPTION. Every request travels:
//
//   Chromium -> the built SPA (vite preview, flag baked in)
//        -> the real API -> real Postgres, real Redis, real guards
//
// Requires that stack; `E2E_REAL_API` selects it, and playwright.config.ts
// excludes this file by `testIgnore` when it is unset rather than skipping —
// an integration-critical spec that silently does nothing is worse than one
// that is visibly absent.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';
const PASSWORD = 'a-reasonable-passphrase-1';

/** Statuses seen on any provider-scoped request, recorded per URL. */
type StatusLog = Array<{ url: string; status: number }>;

test.describe('provider activation → session sync → V2 (real browser, real API)', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the real stack to run these.');

  // Registration, a mailbox poll, an OTP round trip and a UI journey do not fit
  // the repo-wide 60s budget. Stated here rather than discovered as a flake.
  test.describe.configure({ timeout: 180_000 });

  /**
   * A verified SEEKER — registered, OTP-confirmed, and deliberately NOT
   * upgraded.
   *
   * `registerProvider` in real-api.ts upgrades and then refreshes, which is
   * exactly the step under test. Using it here would hand the browser a
   * session that already carries the provider role and assert nothing.
   */
  async function registerSeeker(): Promise<{ email: string; jar: Jar }> {
    const jar = newJar();
    const email = `activate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;

    const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
      method: 'POST',
      body: { email, password: PASSWORD, firstName: 'Sam', lastName: 'Seeker' },
    });
    expect(registered.status, 'register should be accepted').toBeLessThan(400);

    const verified = await api(jar, '/v1/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
    });
    expect(verified.status, 'OTP verification should succeed').toBe(200);

    return { email, jar };
  }

  /** Record every provider-scoped response so a 403 loop is measurable rather
   *  than merely "not observed". Captures status and URL only — never headers,
   *  never cookies, never bodies. */
  function recordProviderStatuses(page: Page): StatusLog {
    const log: StatusLog = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes('/v1/me/provider') || url.includes('/v1/auth/')) {
        log.push({ url: new URL(url).pathname, status: res.status() });
      }
    });
    return log;
  }

  async function signIn(page: Page, email: string): Promise<void> {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();

    const otpInput = page.getByTestId('otp-input');
    await otpInput.waitFor({ state: 'visible', timeout: 45_000 });
    await otpInput.fill(await otpFor(email));
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Wait for the session to actually exist before anyone navigates.
    //
    // Clicking Confirm starts the verification; it does not finish it. Without
    // this the next `goto` races the cookie, arrives unauthenticated, and is
    // bounced to /login — which then presents as "the activation screen is
    // missing" three assertions later, pointing at the wrong thing entirely.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  }

  test.beforeEach(async ({ context }) => {
    // The flag is baked into the build, but the override is what makes both
    // states provable against one bundle — and it is what a stale browser
    // profile could otherwise have pinned OFF.
    await context.addInitScript(([key]) => window.localStorage.setItem(key, 'true'), [FLAG_KEY]);
    await seedLanguage(context, 'en');
  });

  test('activates, synchronizes the session, and lands in V2 without a 403 loop', async ({
    page,
  }) => {
    const statuses = recordProviderStatuses(page);
    const { email, jar } = await registerSeeker();

    // ── 1-2. sign in, then open the activation surface ────────────────────
    await signIn(page, email);
    await page.goto('/provider/profile');

    // The flag routes a profile-less provider to the approved activation
    // screen (prototype screen 0).
    await expect(page).toHaveURL(/\/provider\/activate$/);
    await expect(page.getByTestId('activation-hero')).toBeVisible();
    const cta = page.getByTestId('activation-cta');
    await expect(cta).toBeVisible();

    // ── 3-5. activate; the real upgrade and the real rotation run ─────────
    //
    // The synchronization SCREEN is not asserted here. On a local stack the
    // rotation completes in well under a frame, so requiring it to be observed
    // would be a race dressed as a test. It gets its own test below, where the
    // refresh is deliberately slowed so the state is deterministically
    // visible.
    await cta.click();

    // ── 6-7. the browser ends up in V2, and only after the role is real ───
    await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });

    // ── 8. profile and hub answered 200 on the refreshed session ──────────
    const hubCalls = statuses.filter((s) => s.url.endsWith('/onboarding/hub'));
    expect(hubCalls.length, 'the hub was requested').toBeGreaterThan(0);
    expect(
      hubCalls.some((s) => s.status === 200),
      `the hub must succeed after synchronization; saw ${JSON.stringify(hubCalls)}`,
    ).toBe(true);
    // The LAST hub call is the one the provider is looking at.
    expect(hubCalls[hubCalls.length - 1].status).toBe(200);

    // ── 9. no 403 loop ────────────────────────────────────────────────────
    //
    // A 403 before the rotation is CORRECT and expected — it is the defect's
    // own signature and the reason the repair exists. What must not happen is
    // an unbounded run of them. The recovery budget is one attempt, so at most
    // a couple can legitimately appear per route.
    const forbidden = statuses.filter((s) => s.status === 403);
    expect(
      forbidden.length,
      `403s should be bounded by the single recovery attempt; saw ${JSON.stringify(forbidden)}`,
    ).toBeLessThanOrEqual(4);

    // Refresh must not have been called repeatedly either — that is the other
    // shape a loop takes.
    const refreshes = statuses.filter((s) => s.url.endsWith('/auth/refresh'));
    expect(
      refreshes.length,
      `the session should rotate a bounded number of times; saw ${refreshes.length}`,
    ).toBeLessThanOrEqual(3);

    // ── 10. never the wrong copy ──────────────────────────────────────────
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toContain('Please sign in again');
    expect(body).not.toContain('Your session has ended');

    // ── 11. a hard reload keeps V2 reachable ──────────────────────────────
    await page.reload();
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain('/provider/onboarding');

    // ── 12. a deep link into a task is reachable ──────────────────────────
    await page.goto('/provider/onboarding/BASICS_IDENTITY');
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible({
      timeout: 30_000,
    });

    // ── 13. the PRE-UPGRADE credential is independently still forbidden ───
    //
    // `jar` is the cookie set captured before the upgrade and never rotated.
    // It must not reach a provider endpoint — otherwise the fix would have
    // worked by weakening the guard rather than by refreshing the session.
    const staleHub = await api(jar, '/v1/me/provider/onboarding/hub');
    expect(staleHub.status, 'the pre-upgrade session must remain forbidden').toBe(403);
  });

  test('shows the synchronization screen, and never session-expired copy, while rotating', async ({
    page,
  }) => {
    const { email } = await registerSeeker();

    // The refresh is DELAYED, not faked. The request still travels to the real
    // API and the real response is returned — only its arrival is held back so
    // a state that normally lasts a few milliseconds can be observed. Nothing
    // about the outcome is altered, which is why this is not a stub.
    await page.route('**/v1/auth/refresh', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue();
    });

    await signIn(page, email);
    await page.goto('/provider/activate');
    await page.getByTestId('activation-cta').click();

    // Screen 1 — the visible half of repair A.
    const notice = page.getByTestId('activation-sync-notice');
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText('not an expired session');

    // The regression, asserted while the state is actually on screen.
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body).not.toContain('Please sign in again');
    expect(body).not.toContain('Your session has ended');

    // And it still completes once the delayed rotation lands.
    await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
  });

  test('completes the same journey in Arabic, right-to-left', async ({ page }) => {
    const { email } = await registerSeeker();

    // Sign in FIRST, in English.
    //
    // `signIn` addresses the login controls by their English accessible names,
    // and seeding Arabic before it renders a sign-in screen those names cannot
    // find — which presents as a three-minute click timeout pointing at the
    // wrong screen entirely. The language under test here is the one the
    // ACTIVATION journey runs in, so it is switched immediately after the
    // session exists and before the surface is opened.
    await signIn(page, email);

    // A PAGE-scoped init script, added after the context-scoped one in
    // `beforeEach`. Init scripts run in registration order on every navigation,
    // so this one runs last and wins — whereas a plain `evaluate` is overwritten
    // by the context script on the very next `goto`, which is what left the
    // document in `ltr` and made this look like an RTL defect.
    await page.addInitScript(() => window.localStorage.setItem('hsm.lang', 'ar'));

    await page.goto('/provider/profile');
    await expect(page).toHaveURL(/\/provider\/activate$/);

    // Direction is a property of the real layout engine, which is the reason
    // this assertion lives in a browser rather than in jsdom.
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('activation-cta')).toContainText('تفعيل حساب المهني');

    await page.getByTestId('activation-cta').click();
    await expect(page.getByTestId('activation-sync-notice')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });

    const body = (await page.locator('body').textContent()) ?? '';
    // The Arabic session-expired sentence, which must not appear for a
    // synchronization.
    expect(body).not.toContain('انتهت جلستك');
  });

  test('no horizontal overflow on the activation screen at 320px', async ({ page }) => {
    // The narrowest supported viewport, asserted where geometry is real.
    await page.setViewportSize({ width: 320, height: 844 });
    const { email } = await registerSeeker();

    await signIn(page, email);
    await page.goto('/provider/activate');
    await expect(page.getByTestId('activation-hero')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the document must not scroll sideways at 320px').toBeLessThanOrEqual(0);

    // The one primary action stays a 44px target at the narrowest width.
    const box = await page.getByTestId('activation-cta').boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
