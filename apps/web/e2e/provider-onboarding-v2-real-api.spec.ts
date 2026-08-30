import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { htmlLangDir, seedLanguage } from './fixtures';
import {
  acceptTerms,
  api,
  approveCategoriesFor,
  completeDraft,
  CRITICAL_ENDPOINTS,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';

// Sprint 9B.27 — Provider Onboarding V2, browser to real API.
//
// THE GAP THIS CLOSES
//
// `provider-onboarding-v2*.spec.ts` prove the UI against `stubApi()`. They are
// good tests of rendering and useless as release evidence for integration,
// because the transport they exercise is a fixture. For six sprints they were
// green while `GET /onboarding/hub` returned 404 in every real deployment —
// the endpoint did not exist. Stubbing the thing under test cannot fail.
//
// This file has NO route interception. Every assertion below travels:
//
//   Chromium -> the built SPA (vite preview, flag baked in)
//        -> the real API (node dist/main.js)
//             -> real Postgres, real Redis, real migrations, real guards
//
// Requires that stack. `E2E_REAL_API` is the API base URL; unset, the file is
// excluded by `testIgnore` in playwright.config.ts rather than skipped, on the
// same reasoning as `auth-cookies.spec.ts` — a security- or integration-
// critical spec that quietly does nothing is worse than one that is visibly
// absent.
//
// See docs/sprint-09b26/PROVIDER_ONBOARDING_V2_RELEASE.md §10.1.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

test.describe('provider onboarding v2 — real browser, real API', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the real stack to run these.');

  // Each test registers an account, waits for an SMTP delivery, polls a mail
  // catcher, verifies an OTP and then drives a UI journey. That does not fit
  // the repo-wide 60s budget, and discovering it as a flake later would be
  // worse than stating it here.
  test.describe.configure({ timeout: 180_000 });

  /**
   * Hand the browser the session the API already issued.
   *
   * These are REAL cookies minted by the real login pipeline, not a
   * fabricated token: the jar comes from `registerProvider`, which registered
   * and verified over HTTP. Cookie domains ignore ports, so one entry serves
   * both the SPA origin and the API origin.
   *
   * The full form-and-OTP login is exercised separately, in "login returns the
   * provider to the V2 destination" — it is the subject of that test rather
   * than a tax on every other one.
   */
  async function applyRealSession(context: BrowserContext, account: Account): Promise<void> {
    const host = new URL(REAL_API).hostname;
    await context.addCookies(
      [...account.jar].map(([name, value]) => ({
        name,
        value,
        domain: host,
        // The refresh token is path-scoped in production and must stay that
        // way; anything else is site-wide.
        path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
      })),
    );
  }

  async function seedFlag(page: Page, on: boolean): Promise<void> {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      [FLAG_KEY, String(on)] as const,
    );
  }

  /** A signed-in provider on the hub, with the flag on and English copy. */
  async function openHub(page: Page, context: BrowserContext, account: Account): Promise<void> {
    await applyRealSession(context, account);
    await seedFlag(page, true);
    await seedLanguage(page, 'en');
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
  }

  /**
   * Watch what the browser actually fetched.
   *
   * Used to assert the critical endpoints were served over the wire by the API
   * origin. A `page.route` stub never reaches the network, so a stubbed run
   * fails this rather than passing quietly.
   */
  function recordApiTraffic(page: Page): Array<{ url: string; status: number }> {
    const seen: Array<{ url: string; status: number }> = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.startsWith(REAL_API)) seen.push({ url, status: response.status() });
    });
    return seen;
  }

  // ── the flag ────────────────────────────────────────────────────────────

  test('flag OFF serves the Sprint 8 legacy wizard, against the same real API', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    await applyRealSession(context, account);
    await seedFlag(page, false);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding');

    // Bounced out of the V2 route entirely.
    await expect(page).toHaveURL(/\/provider$/);
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);

    // And what the provider gets instead is the Sprint 8 wizard, identified by
    // a step name that exists only in its nine-step vocabulary.
    await page.getByRole('button', { name: 'Continue onboarding' }).click();
    await expect(page.getByText('Account type', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
  });

  test('flag ON routes the provider to /provider/onboarding', async ({ page, context }) => {
    const account = await registerProvider();
    await applyRealSession(context, account);
    await seedFlag(page, true);
    await seedLanguage(page, 'en');

    await page.goto('/provider');

    // `/provider` is a gate, not a redirect: an unfinished provider is offered
    // the way in rather than thrown at it. With the flag on, that door opens
    // the V2 route; with it off, the same control opens the legacy wizard in
    // place (asserted above). Same button, two surfaces — which is exactly
    // what makes the flag a UX rollback rather than a deploy.
    await page.getByRole('button', { name: 'Continue onboarding' }).click();

    await expect(page).toHaveURL(/\/provider\/onboarding$/);
    await expect(page.getByTestId('onboarding-v2-shell')).toBeVisible();
  });

  // ── the hub is served by the API, not by a fixture ──────────────────────

  test('the hub renders what the real API served, and follows it when the data changes', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    const traffic = recordApiTraffic(page);
    await openHub(page, context, account);

    // 1. The browser really fetched the hub from the API origin.
    const hubCalls = traffic.filter((r) => r.url.includes('/me/provider/onboarding/hub'));
    expect(hubCalls.length, 'the browser must fetch the hub over the network').toBeGreaterThan(0);
    expect(hubCalls.every((r) => r.status === 200)).toBe(true);

    // 2. What is on screen is the state the server computed.
    //
    // Compared on STATUS, not on title. The response's `title` is a fallback
    // for a client with no copy of its own; this client has one, keyed by task
    // id, because a single-language response cannot serve a bilingual UI. So
    // the row for SERVICES_EXPERIENCE reads "Services and experience" from the
    // bundle while the server offers "Your services", and asserting the two
    // are equal would be asserting the fallback had won — the opposite of the
    // intended behaviour. Status is the part the server actually decides.
    const served = await api<{ tasks: { id: string; status: string }[] }>(
      account.jar,
      '/v1/me/provider/onboarding/hub',
    );
    for (const task of served.body.tasks) {
      await expect(page.getByTestId(`task-row-${task.id}`)).toHaveAttribute(
        'data-status',
        task.status,
      );
    }

    // 3. The decisive one. Change the underlying data through the API, reload,
    //    and the hub must move. A fixture cannot follow a write it never saw,
    //    so this fails on any stubbed transport regardless of how faithful the
    //    fixture's shape is.
    await expect(page.getByTestId('onboarding-v2-progress')).toHaveText('0 of 6 complete');
    await completeDraft(account, { skip: ['PROFILE'] });
    await page.reload();
    await expect(page.getByTestId('onboarding-v2-progress')).not.toHaveText('0 of 6 complete');
    await expect(page.getByTestId('task-row-PORTFOLIO')).toHaveAttribute(
      'data-status',
      'AVAILABLE',
    );
  });

  test('the critical onboarding endpoints are served by the API, never intercepted', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    const traffic = recordApiTraffic(page);
    await openHub(page, context, account);
    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible();

    // The journey so far reads the hub and the draft; both must have come from
    // the API origin, and nothing may have answered with a synthetic status.
    //
    // Polled rather than asserted once: the task screen becomes visible from
    // data the hub already supplied, and its own draft fetch lands a moment
    // later. Reading the log at the instant of visibility is a race, and one
    // that fails in exactly the direction that looks like a stub.
    await expect
      .poll(
        () =>
          CRITICAL_ENDPOINTS.filter((endpoint) =>
            traffic.some((r) => r.url.includes(endpoint)),
          ).slice(),
        { timeout: 20_000, message: 'the browser should fetch hub and draft from the API' },
      )
      .toEqual(
        expect.arrayContaining(['/me/provider/onboarding/hub', '/me/provider/onboarding/draft']),
      );
    const failures = traffic.filter(
      (r) => CRITICAL_ENDPOINTS.some((e) => r.url.includes(e)) && r.status >= 400,
    );
    expect(failures, `critical endpoints returned errors: ${JSON.stringify(failures)}`).toEqual([]);
  });

  // ── the hub's shape ─────────────────────────────────────────────────────

  test('six tasks, not the nine legacy wizard chips', async ({ page, context }) => {
    const account = await registerProvider();
    await openHub(page, context, account);

    await expect(page.getByTestId(/^task-row-/)).toHaveCount(6);
    await expect(page.getByTestId('onboarding-v2-progress')).toContainText('of 6');
    // The legacy step vocabulary must not appear on the V2 surface.
    await expect(page.getByText('Account type', { exact: true })).toHaveCount(0);
  });

  test('renders no bottom application navigation', async ({ page, context }) => {
    const account = await registerProvider();
    await openHub(page, context, account);

    for (const label of ['Home', 'Bookings', 'Messages', 'Profile']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('the dynamic CTA opens the task the server nominated', async ({ page, context }) => {
    const account = await registerProvider();
    await openHub(page, context, account);

    const hub = await api<{ nextAction: { kind: string; taskId?: string } }>(
      account.jar,
      '/v1/me/provider/onboarding/hub',
    );
    expect(hub.body.nextAction.kind).toBe('COMPLETE_TASK');

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId(`task-screen-${hub.body.nextAction.taskId}`)).toBeVisible();
  });

  // ── writes reach the database ───────────────────────────────────────────

  test('a task edited in the browser is persisted, and survives a reload', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    await openHub(page, context, account);

    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(page.getByTestId('task-screen-BASICS_IDENTITY')).toBeVisible();

    const typed = `Layla ${Date.now()}`;
    await page.getByTestId('field-displayName').fill(typed);
    // Blur commits, rather than waiting out the autosave debounce.
    await page.getByTestId('field-phoneNumber').click();
    await page.getByTestId('field-phoneNumber').fill('+963900000444');
    await page.getByTestId('field-displayName').click();

    // The row in Postgres is the assertion, read back through the API on a
    // connection the browser is not involved in.
    await expect
      .poll(
        async () => {
          const draft = await api<{ data: { displayName?: string } }>(
            account.jar,
            '/v1/me/provider/onboarding/draft',
          );
          return draft.body.data.displayName;
        },
        { timeout: 30_000, message: 'the typed name should reach the database' },
      )
      .toBe(typed);

    // And the browser reads its own write back after a full reload.
    await page.reload();
    await expect(page.getByTestId('field-displayName')).toHaveValue(typed);
  });

  test('a direct task deep link opens that task', async ({ page, context }) => {
    const account = await registerProvider();
    await applyRealSession(context, account);
    await seedFlag(page, true);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding/WORK_AREA');
    await expect(page.getByTestId('task-screen-WORK_AREA')).toBeVisible();

    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
  });

  test('login returns the provider to the V2 destination', async ({ page, context }) => {
    const account = await registerProvider();
    // No session cookies on purpose: this is the logged-out entry path.
    await seedFlag(page, true);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding');
    await expect(page).toHaveURL(/\/login/);

    await loginViaUi(page, account);

    // The destination survived the round trip through login and the OTP
    // screen, and the hub it lands on is the real one.
    await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    expect(await context.cookies()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'hsm_at', httpOnly: true })]),
    );
  });

  // ── review, consent and submission ──────────────────────────────────────

  test('review blockers agree with the hub, because both read one policy', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    // One deliberate hole: the profile step. Everything else is complete, so
    // the only blocker either surface may report is PORTFOLIO's.
    await completeDraft(account, { skip: ['PROFILE'] });
    await approveCategoriesFor(account);
    await openHub(page, context, account);

    const hub = await api<{ tasks: { id: string; status: string }[] }>(
      account.jar,
      '/v1/me/provider/onboarding/hub',
    );
    const review = await api<{ groups: { kind: string; items: { taskId: string }[] }[] }>(
      account.jar,
      '/v1/me/provider/onboarding/review',
    );
    const blockingTasks = new Set(
      review.body.groups
        .filter((g) => g.kind === 'BLOCKING')
        .flatMap((g) => g.items.map((i) => i.taskId)),
    );
    const incomplete = new Set(
      hub.body.tasks
        .filter((t) => t.id !== 'REVIEW_SUBMISSION' && t.status !== 'COMPLETE')
        .map((t) => t.id),
    );
    expect([...blockingTasks].filter((id) => id !== 'REVIEW_SUBMISSION').sort()).toEqual(
      [...incomplete].sort(),
    );

    // And the browser shows the same thing: review is not enterable yet.
    await expect(page.getByTestId('task-row-REVIEW_SUBMISSION')).toHaveAttribute(
      'data-status',
      'BLOCKED',
    );
    await expect(page.getByTestId('task-row-PORTFOLIO')).toHaveAttribute(
      'data-status',
      'AVAILABLE',
    );
  });

  test('terms gate submission, and accepting them in the browser opens it', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    await completeDraft(account);
    await approveCategoriesFor(account);
    await openHub(page, context, account);

    await page.getByTestId('task-row-REVIEW_SUBMISSION').click();
    await expect(page.getByTestId('review-screen')).toBeVisible();

    // Everything is collected, so consent is the only thing left — and the
    // server says so, not the client.
    await expect(page.getByTestId('review-submit')).toBeDisabled();
    await expect(page.getByTestId('review-blocked-reason')).toBeVisible();

    await page.getByTestId('terms-accept').click();

    await expect(page.getByTestId('review-submit')).toBeEnabled({ timeout: 30_000 });
    // The acceptance was recorded server-side, not just in component state.
    await expect
      .poll(async () => {
        const review = await api<{ terms: { accepted: boolean } }>(
          account.jar,
          '/v1/me/provider/onboarding/review',
        );
        return review.body.terms.accepted;
      })
      .toBe(true);
  });

  test('completing the last task moves hub progress, and submission persists', async ({
    page,
    context,
  }) => {
    const account = await registerProvider();
    await completeDraft(account);
    await approveCategoriesFor(account);
    await acceptTerms(account);
    await openHub(page, context, account);

    // Everything collected: five of six, and review is the one left.
    await expect(page.getByTestId('onboarding-v2-progress')).toHaveText('5 of 6 complete');
    await expect(page.getByTestId('task-row-REVIEW_SUBMISSION')).toHaveAttribute(
      'data-status',
      'AVAILABLE',
    );

    await page.getByTestId('task-row-REVIEW_SUBMISSION').click();
    await expect(page.getByTestId('review-submit')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('review-submit').click();

    // The application really left the provider's hands.
    await expect
      .poll(
        async () => {
          const hub = await api<{ status: string }>(account.jar, '/v1/me/provider/onboarding/hub');
          return hub.body.status;
        },
        { timeout: 30_000, message: 'the hub should report a handed-in application' },
      )
      .toBe('SUBMITTED');

    // And the submitted surface is what the browser shows, with no task list
    // to keep editing.
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-state-SUBMITTED')).toBeVisible();
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);
  });

  // ── privacy ─────────────────────────────────────────────────────────────

  test('the public projection carries no private field', async ({ context }) => {
    const account = await registerProvider();
    await completeDraft(account);
    await approveCategoriesFor(account);

    const preview = await api<unknown>(account.jar, '/v1/me/provider/public-profile/preview');
    expect(preview.status).toBe(200);
    const serialised = JSON.stringify(preview.body);

    // The values we know were written to the private record.
    for (const secret of ['+963900000444', 'Asia/Damascus']) {
      expect(serialised, `${secret} must not reach a public projection`).not.toContain(secret);
    }
    // And the shapes of the things that must never appear.
    for (const forbidden of [
      'phoneNumber',
      'serviceAreaLat',
      'serviceAreaLng',
      'workshopAddressLine',
      'storageKey',
      'userId',
      'verification/',
    ]) {
      expect(serialised, `${forbidden} must not reach a public projection`).not.toContain(
        forbidden,
      );
    }
    expect(context).toBeTruthy();
  });

  // ── bilingual, at the sizes the criteria name ───────────────────────────

  test('Arabic renders right-to-left against real data', async ({ page, context }) => {
    const account = await registerProvider();
    await applyRealSession(context, account);
    await seedFlag(page, true);
    await seedLanguage(page, 'ar');

    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    expect(await htmlLangDir(page)).toEqual({ lang: 'ar', dir: 'rtl' });
    await expect(page.getByTestId(/^task-row-/)).toHaveCount(6);

    // The client's own bundle wins over the server's fallback text, which is
    // why the response carrying English titles is not a bug.
    await expect(page.getByTestId('task-row-BASICS_IDENTITY')).not.toContainText('Your details');
  });
});
