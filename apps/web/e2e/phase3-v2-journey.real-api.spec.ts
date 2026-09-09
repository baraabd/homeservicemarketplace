import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, htmlLangDir, seedLanguage } from './fixtures';
import {
  acceptTerms,
  api,
  approveCategoriesFor,
  completeDraft,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';
import {
  approveProviderApplication,
  approveVerificationCase,
  capabilitiesOf,
  reactivateProvider,
  submitVerificationCase,
  supplyEvidence,
  suspendProvider,
  waitForEvidenceClean,
} from './phase3-activation';

// Sprint 09B.29 Phase 3, Section 4 — the V2 provider journey in a real browser.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.12
//
// WHAT MAKES THIS DIFFERENT FROM EVERY OTHER V2 SPEC
//
// 1. NO ROUTE INTERCEPTION AT ALL. Not one `page.route`. Onboarding, profile,
//    moderation, verification, capability and work-access endpoints are all
//    served by the real API against real Postgres and real Redis.
//
// 2. NO localStorage FLAG SEEDING. Every other V2 spec calls `seedFlag()` to
//    force the feature on. This one must not: the bundle under test was BUILT
//    with `VITE_PROVIDER_ONBOARDING_V2=true` and served from its own directory
//    on its own port, and an override would make the run prove nothing about
//    the artifact that would actually ship. `dist-phase3-v2` inlines the
//    literal `("true")` at the flag site; `dist-phase3-v1` inlines `("false")`.
//
// 3. 390×844, the viewport the V2 rule names — not the config's 375×812.
//
// The admin half of the chain goes through `phase3-activation.ts`, which drives
// the canonical admin HTTP endpoints with a genuine seeded admin session and
// real CSRF. There is no admin UI for the verification-case queue in this
// application, so there is no screen to click.

const OUT = join('e2e', '__artifacts__', 'phase3-v2');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);

/** The Arabic submit CTA, in LOGICAL order. Built from code points so the
 *  source file itself cannot smuggle in a visually-reversed string: a reversed
 *  literal looks identical in many editors and terminals. */
const AR_SUBMIT = String.fromCodePoint(
  0x0625,
  0x0631,
  0x0633,
  0x0627,
  0x0644,
  0x0020,
  0x0627,
  0x0644,
  0x0637,
  0x0644,
  0x0628,
);

interface AxeRecord {
  scenario: string;
  lang: string;
  violations: number;
  blocking: number;
  rules: string[];
  details: Array<{
    rule: string;
    impact: string | null;
    target: string;
    summary: string;
    html: string;
  }>;
}
const axeRecords: AxeRecord[] = [];

test.describe('Phase 3 — V2 provider journey, real browser, real API', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the isolated Phase 3 stack.');

  test.describe.configure({ timeout: 300_000, mode: 'serial' });
  test.use({ viewport: { width: 390, height: 844 } });

  mkdirSync(OUT, { recursive: true });

  // ── observability, armed on every page ─────────────────────────────────

  interface Watch {
    consoleErrors: string[];
    pageErrors: string[];
    failed: Array<{ url: string; status: number }>;
    statuses: Array<{ url: string; status: number }>;
    /** Transport-level failures: a request that never produced a response.
     *  Captured with the URL and Chromium's own reason, because the console
     *  only says "Failed to load resource: net::ERR_…" and naming neither
     *  makes such a failure impossible to diagnose after the fact. */
    aborted: Array<{ url: string; reason: string; resourceType: string }>;
  }

  function watch(page: Page): Watch {
    const w: Watch = {
      consoleErrors: [],
      pageErrors: [],
      failed: [],
      statuses: [],
      aborted: [],
    };
    page.on('console', (m) => {
      if (m.type() === 'error') w.consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => w.pageErrors.push(String(e)));
    page.on('requestfailed', (r) => {
      w.aborted.push({
        url: r.url(),
        reason: r.failure()?.errorText ?? 'unknown',
        resourceType: r.resourceType(),
      });
    });
    page.on('response', (r) => {
      const url = r.url();
      if (!url.startsWith(REAL_API)) return;
      w.statuses.push({ url, status: r.status() });
      if (r.status() >= 400) w.failed.push({ url, status: r.status() });
    });
    return w;
  }

  /**
   * No unexplained browser noise.
   *
   * `allow.urls` lists request substrings whose 4xx is the SUBJECT of a test.
   * `allow.statuses` lists the HTTP statuses those tests deliberately provoke.
   *
   * The status list is needed because Chromium emits its OWN console error for
   * every non-2xx resource load — "Failed to load resource: the server
   * responded with a status of 401" — which is the browser narrating the very
   * response the test asked for, not the application failing. A signed-out
   * browser requesting a protected route MUST produce a 401, so treating that
   * echo as an error would make the sign-out test unable to pass while it was
   * behaving correctly.
   *
   * Only that exact automatic message is filtered, and only for a status the
   * test named. Any other console error — an application throw, a React
   * warning, a CSP refusal — still fails the gate.
   */
  function expectQuiet(
    w: Watch,
    label: string,
    allow: { urls?: string[]; statuses?: number[] } = {},
  ): void {
    const urls = allow.urls ?? [];
    const statuses = allow.statuses ?? [];

    expect(w.pageErrors, `${label}: page errors`).toEqual([]);

    // A transport failure is reported with its URL and reason, so it can be
    // diagnosed rather than guessed at. Asserted BEFORE the console check,
    // because the console's "net::ERR_…" line is the same event with less
    // information — reporting that first would bury the useful message.
    expect(w.aborted, `${label}: requests that never completed`).toEqual([]);

    const RESOURCE_ECHO = /Failed to load resource: the server responded with a status of (\d+)/;
    const unexplainedConsole = w.consoleErrors.filter((line) => {
      const m = RESOURCE_ECHO.exec(line);
      return !(m && statuses.includes(Number(m[1])));
    });
    expect(unexplainedConsole, `${label}: console errors`).toEqual([]);

    // A failed request is explained when the test named its URL or its status.
    // Naming the STATUS is what covers a sign-out: the 401 on whichever
    // protected route the app happened to request is the point of the test,
    // and pinning the URL would make the assertion depend on which endpoint
    // the shell calls first rather than on the behaviour.
    const unexplained = w.failed.filter(
      (f) => !urls.some((a) => f.url.includes(a)) && !statuses.includes(f.status),
    );
    expect(unexplained, `${label}: unexplained failed requests`).toEqual([]);
  }

  async function shot(page: Page, name: string): Promise<void> {
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  }

  async function axe(page: Page, scenario: string, lang: string): Promise<void> {
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ''));
    axeRecords.push({
      scenario,
      lang,
      violations: results.violations.length,
      blocking: blocking.length,
      rules: results.violations.map((v) => `${v.id}(${v.impact}, ${v.nodes.length})`),
      // Node-level detail, so a failure names the element and the measured
      // ratio rather than only the rule. A report that says "8 nodes" and
      // nothing else is not actionable.
      details: results.violations.flatMap((v) =>
        v.nodes.map((n) => ({
          rule: v.id,
          impact: v.impact ?? null,
          target: n.target.join(' '),
          summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
          html: n.html.slice(0, 200),
        })),
      ),
    });
    expect(
      blocking.flatMap((v) =>
        v.nodes.map(
          (n) =>
            `${v.id} [${v.impact}] ${n.target.join(' ')} :: ${(n.failureSummary ?? '')
              .replace(/\s+/g, ' ')
              .trim()}`,
        ),
      ),
      `axe blocking violations on "${scenario}" (${lang})`,
    ).toEqual([]);
  }

  /** Real cookies from the real login pipeline, handed to the browser. */
  async function applyRealSession(context: BrowserContext, account: Account): Promise<void> {
    const host = new URL(REAL_API).hostname;
    await context.addCookies(
      [...account.jar].map(([name, value]) => ({
        name,
        value,
        domain: host,
        path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
      })),
    );
  }

  /** Mobile-first shell rules the V2 rule names, asserted on the live layout. */
  async function expectMobileFirstShell(page: Page, label: string): Promise<void> {
    await expectNoHorizontalPageOverflow(page);

    const shell = page.getByTestId('onboarding-v2-shell');
    await expect(shell, `${label}: the V2 shell renders`).toBeVisible();

    // Single column at 390: the shell fills the viewport rather than sitting
    // in a centred desktop card.
    const box = await shell.boundingBox();
    expect(box, `${label}: shell has a box`).not.toBeNull();
    expect(box!.width, `${label}: shell is full-width at 390`).toBeGreaterThan(360);
    expect(box!.width, `${label}: shell does not exceed the viewport`).toBeLessThanOrEqual(390);

    // No dark decorative phone frame — the thing the V2 rule bans by name.
    const ground = page.getByTestId('onboarding-v2-ground');
    const bg = await ground.evaluate((el) => getComputedStyle(el).backgroundColor);
    const dark = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg);
    if (dark) {
      const [r, g, b] = [Number(dark[1]), Number(dark[2]), Number(dark[3])];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance, `${label}: the ground is not a dark phone frame`).toBeGreaterThan(0.4);
    }

    // No workspace bottom navigation inside onboarding.
    await expect(
      page.getByTestId('provider-bottom-nav'),
      `${label}: no workspace nav inside onboarding`,
    ).toHaveCount(0);
  }

  /** Touch targets and editable text, per the V2 rule. */
  async function expectTouchTargets(page: Page, label: string): Promise<void> {
    const buttons = page.locator('button:visible');
    const n = Math.min(await buttons.count(), 12);
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      const box = await b.boundingBox();
      if (!box) continue;
      // 44×44 is the rule. A 2px tolerance for sub-pixel layout rounding.
      expect(
        Math.max(box.height, 0),
        `${label}: touch target ${i} height (${await b.innerText().catch(() => '?')})`,
      ).toBeGreaterThanOrEqual(42);
    }
  }

  // ── shared state across the serial journey ─────────────────────────────

  let account: Account;
  let caseId: string;

  // ══ 1-3. upgrade, session refresh, and the hub the flag chose ══════════

  test('EN — a real provider reaches the V2 hub with no stale-role 403 loop', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    // A genuine account: register -> OTP out of the isolated Mailpit ->
    // verify -> upgrade -> authoritative session refresh. `registerProvider`
    // performs the refresh precisely because `RolesGuard` reads roles from the
    // ACCESS TOKEN, so the pre-upgrade token still says "customer".
    account = await registerProvider();
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // The bundle's baked-in flag is what routed us here — nothing seeded an
    // override, and the V2 shell is only reachable when the flag is on.
    await expect(page.getByTestId('onboarding-v2-shell')).toBeVisible();

    // No 403 loop: the session the browser carries is post-refresh, so the
    // provider endpoints answer. A stale-role loop shows up as repeated 403s
    // on the same URL.
    const forbidden = w.statuses.filter((s) => s.status === 403);
    expect(forbidden, 'no 403 on the onboarding surface after refresh').toEqual([]);

    await expectMobileFirstShell(page, 'EN hub');
    await axe(page, 'hub', 'en');
    await shot(page, 'en-01-hub');
    expectQuiet(w, 'EN hub');
  });

  // ══ 4-5. a real task write, server-acknowledged, and persistent ════════

  test('EN — a task saves only after the server acknowledges, and the value persists', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');

    await page.goto('/provider/onboarding');
    await page.getByTestId('task-row-BASICS_IDENTITY').click();

    const displayName = page.getByLabel(/display name|full name|name/i).first();
    await displayName.waitFor({ state: 'visible' });
    const unique = `Browser Journey ${Date.now()}`;
    await displayName.fill(unique);

    // The PATCH must be observed on the wire BEFORE any "Saved" appears. That
    // ordering is the contract: a client that says Saved optimistically is
    // exactly what the persistence rule forbids.
    const patch = await page.waitForResponse(
      (r) => r.url().includes('/me/provider/onboarding/steps/') && r.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    expect(patch.status(), 'the step write is accepted by the real API').toBe(200);

    await expect(page.getByText(/^Saved$/i).first()).toBeVisible({ timeout: 15_000 });

    // task -> hub -> task
    await page
      .getByRole('button', { name: /close|back/i })
      .first()
      .click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(displayName).toHaveValue(unique);

    // hard reload
    await page.reload();
    await expect(displayName).toHaveValue(unique);

    // browser back/forward
    await page.goBack();
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    await page.goForward();
    await expect(displayName).toHaveValue(unique);

    await shot(page, 'en-02-task-persisted');
    expectQuiet(w, 'EN task save');

    // And it is on the server, not just in the tab.
    const draft = await api<{ data: { displayName: string } }>(
      account.jar,
      '/v1/me/provider/onboarding/draft',
    );
    expect(draft.body.data.displayName).toBe(unique);
  });

  test('EN — the value survives a real sign-out and sign-in', async ({ page, context }) => {
    const w = watch(page);
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // A real sign-out: clear the browser's cookies, then log in through the
    // actual form and OTP screen.
    //
    // The protected route is requested FIRST, so the app captures it as the
    // return destination and the login flow itself brings us back. Navigating
    // straight to it after clicking Confirm races the login: the OTP exchange
    // and the session it establishes are still in flight, so the guard sees no
    // session and bounces to /login — which is exactly what the first run of
    // this test did (a harness fault, not a product one).
    await context.clearCookies();
    await page.goto('/provider/onboarding');
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await loginViaUi(page, account);

    // The app returns to the destination on its own. This is also the
    // deep-link recovery assertion: the route survived the round trip through
    // sign-in and the OTP screen.
    await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    // A genuine httpOnly session cookie, minted by the real login pipeline.
    expect(await context.cookies()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'hsm_at', httpOnly: true })]),
    );
    await page.getByTestId('task-row-BASICS_IDENTITY').click();
    await expect(page.getByLabel(/display name|full name|name/i).first()).toHaveValue(
      /Browser Journey/,
    );
    // This test signs out on purpose, so the browser MUST see a 401 on the
    // protected route before the login form appears. That 401 is the assertion,
    // not a fault.
    expectQuiet(w, 'EN re-login', { statuses: [401] });
  });

  // ══ 6-8. the pending specialty, and submission ═════════════════════════

  test('EN — a pending specialty is platform-owned waiting, not provider work', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    // Fill the remaining provider-owned inputs through the same PATCH
    // endpoints the task screens use. The SPECIALTIES step is what files the
    // PENDING moderation application — that is the state under test.
    await completeDraft(account);
    await acceptTerms(account);

    await applyRealSession(context, account);
    await seedLanguage(page, 'en');
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    const services = page.getByTestId('task-row-SERVICES_EXPERIENCE');
    // Not openable: there is nothing for the provider to fix.
    await expect(services).toHaveAttribute('data-actionable', 'false');
    expect(await services.evaluate((el) => el.tagName)).not.toBe('BUTTON');

    // Explained as ours, and differently from a blocked row.
    const explanation = page.getByTestId('task-explanation-SERVICES_EXPERIENCE');
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(/we are checking/i);

    // Absent from provider-action work: the review task is open, and the
    // primary action points at submitting rather than back at the wait.
    await expect(page.getByTestId('task-row-REVIEW_SUBMISSION')).toHaveAttribute(
      'data-actionable',
      'true',
    );
    await expect(page.getByRole('button', { name: 'Submit application' })).toBeEnabled();

    await axe(page, 'pending-moderation', 'en');
    await shot(page, 'en-03-pending-moderation');
    expectQuiet(w, 'EN pending moderation');
  });

  test('EN — submission succeeds while moderation is pending', async ({ page, context }) => {
    const w = watch(page);
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');
    await page.goto('/provider/onboarding');

    // The hub CTA OPENS the review task; it does not submit. So the hub row is
    // gone by design once we are on the review screen — asserting it here was
    // an assertion fault of mine, not a product one.
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(page.getByTestId('review-screen')).toBeVisible();
    await expect(page).toHaveURL(/\/provider\/onboarding\/REVIEW_SUBMISSION$/);
    await axe(page, 'review', 'en');
    await shot(page, 'en-04-review');

    // The review screen's own submit control, which the server's `canSubmit`
    // is what enables.
    const submit = page.getByTestId('review-submit');
    await expect(submit, 'a pending specialty leaves submission available').toBeEnabled();
    const post = page.waitForResponse(
      (r) => r.url().includes('/me/provider/onboarding/submit') && r.request().method() === 'POST',
    );
    await submit.click();
    const res = await post;
    expect(res.status(), 'a pending specialty does not block submission').toBe(200);

    // The review screen acknowledges in place. Asserted on BEHAVIOUR rather
    // than on one branch's test id: once the application is in, the review
    // task becomes a waiting task, so the screen stops offering to submit and
    // states that it is with us. Pinning `review-submitted` was wrong — that
    // id belongs to a different branch of the same screen.
    await expect(page.getByTestId('review-submit'), 'submission is no longer offered').toHaveCount(
      0,
      { timeout: 20_000 },
    );
    await expect(
      page.getByText(/we are checking this|with us/i).first(),
      'the screen says the application is with us',
    ).toBeVisible();
    await axe(page, 'review-submitted', 'en');
    await shot(page, 'en-05-submitted');

    // …and the HUB now states the application is with us, as status rather
    // than as a task. That separation is the point: lifecycle, moderation,
    // verification and work access are four axes, and only one of them moved.
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-state-SUBMITTED')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);
    await axe(page, 'submitted-hub', 'en');
    await shot(page, 'en-05b-submitted-hub');
    expectQuiet(w, 'EN submit');

    // The moderation application is genuinely still pending on the server.
    const draft = await api<{ awaitingReview: unknown[] }>(
      account.jar,
      '/v1/me/provider/onboarding/draft',
    );
    expect(draft.body.awaitingReview.length).toBeGreaterThan(0);
  });

  // ══ 9-10. work is refused, and it is not a session problem ═════════════

  test('EN — protected work is refused, without session-expiry copy or a retry loop', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');

    await page.goto('/provider/bids');
    await page.waitForTimeout(3_000);

    // 1. NOT a session problem. No bounce to sign-in, and no expiry copy.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/session (has )?expired|please sign in again/i)).toHaveCount(0);
    await expect(page.getByText(/sign in again|log in again/i)).toHaveCount(0);

    // 2. The work surface is NOT rendered. The client guards the route before
    //    requesting it, which is why the network may show no /provider/bids
    //    call at all — a correct product decision (do not issue a request you
    //    already know is refused) and the reason an earlier draft of this test
    //    wrongly demanded one.
    await expect(page.getByTestId('provider-bids-list')).toHaveCount(0);

    // 3. The refusal is EXPLAINED, as the application's standing rather than
    //    as an error. This is the axis separation in the UI: submitted
    //    lifecycle is shown, work access is withheld, and neither is described
    //    as the other.
    await expect(
      page.getByText(/pending review|being reviewed|activated/i).first(),
      'the denial is explained as review status',
    ).toBeVisible();

    // 4. Whatever DID go over the wire was bounded: never a 200 on the work
    //    endpoint, and no retry storm.
    const bids = w.statuses.filter((s) => s.url.includes('/provider/bids'));
    expect(
      bids.filter((s) => s.status === 200),
      'work is never served before activation',
    ).toEqual([]);
    expect(bids.length, 'no 403 retry loop').toBeLessThanOrEqual(3);
    const refreshes = w.statuses.filter((s) => s.url.includes('/auth/refresh'));
    expect(refreshes.length, 'no refresh loop on a denial').toBeLessThanOrEqual(1);

    // 5. And the SERVER genuinely refuses this browser's own session — proved
    //    through the browser context's cookie jar, not a separate client, so
    //    it is the same session the page is using.
    const direct = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(direct.status(), 'the API refuses this browser session').toBe(403);

    await axe(page, 'work-denied', 'en');
    await shot(page, 'en-06-work-denied');
    expectQuiet(w, 'EN work denied', { urls: ['/provider/bids'], statuses: [403] });
  });

  // ══ 11-12. the canonical admin chain, then work succeeds ═══════════════

  test('the canonical admin chain activates the provider', async () => {
    // Genuine authenticated admin HTTP with real CSRF — no UI exists for the
    // verification queue, and no state is written with SQL.
    await approveProviderApplication(account);
    expect((await capabilitiesOf(account.jar)).primaryReason).toBe('VERIFICATION_REQUIRED');

    await approveCategoriesFor(account);
    expect((await capabilitiesOf(account.jar)).primaryReason).toBe('VERIFICATION_REQUIRED');

    ({ caseId } = await supplyEvidence(account));
    await waitForEvidenceClean(account);
    await submitVerificationCase(account);
    await approveVerificationCase(caseId);

    const caps = await capabilitiesOf(account.jar);
    expect(caps.primaryReason).toBeNull();
    expect(caps.allowed).toContain('SUBMIT_BID');
  });

  test('EN — the same work surface now succeeds in the browser', async ({ page, context }) => {
    const w = watch(page);
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');

    await page.goto('/provider/bids');
    await page.waitForTimeout(3_000);

    // The route is no longer guarded away — the workspace itself renders.
    // This is the assertion the Phase 2 residual gap named: a redirect to the
    // activation surface does NOT count as loading the work screen.
    await expect(page).not.toHaveURL(/\/provider\/(activate|status)/);
    await expect(
      page.getByText(/pending review|being reviewed/i),
      'the pending-review gate is gone',
    ).toHaveCount(0);

    const bids = w.statuses.filter((s) => s.url.includes('/provider/bids'));
    expect(bids.length, 'the work endpoint is now actually requested').toBeGreaterThan(0);
    expect(
      bids.every((s) => s.status === 200),
      'work access is open',
    ).toBe(true);

    // And the server agrees for this browser's own session.
    const direct = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(direct.status(), 'the API serves this browser session').toBe(200);

    await axe(page, 'work-activated', 'en');
    await shot(page, 'en-07-work-activated');
    expectQuiet(w, 'EN work activated');
  });

  // ══ 13-14. suspension and reactivation ═════════════════════════════════

  test('EN — suspension returns work to 403, reactivation restores it with no new grant', async ({
    page,
    context,
  }) => {
    const w = watch(page);
    await suspendProvider(account, 'Phase 3 browser acceptance.');
    expect((await capabilitiesOf(account.jar)).primaryReason).toBe('PROVIDER_SUSPENDED');

    await applyRealSession(context, account);
    await seedLanguage(page, 'en');
    await page.goto('/provider/bids');
    await page.waitForTimeout(2_000);

    // Never served, and — the assertion that matters — the server refuses this
    // browser's own session again.
    const denied = w.statuses.filter((s) => s.url.includes('/provider/bids'));
    expect(
      denied.filter((s) => s.status === 200),
      'suspension shuts work',
    ).toEqual([]);
    const direct = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(direct.status(), 'suspension returns the API to 403').toBe(403);
    // Still not a session problem.
    await expect(page).not.toHaveURL(/\/login/);
    await axe(page, 'suspended', 'en');
    await shot(page, 'en-08-suspended');

    // Reactivation restores access WITHOUT minting a second grant. The grant
    // count is read from the provider's own capability posture plus a direct
    // database assertion in the integration journey; here the browser proves
    // the access is back.
    await reactivateProvider(account);
    const caps = await capabilitiesOf(account.jar);
    expect(caps.primaryReason).toBeNull();
    expect(caps.allowed).toContain('SUBMIT_BID');

    await page.goto('/provider/bids');
    await page.waitForTimeout(2_000);
    const restored = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(restored.status(), 'reactivation restores work in the browser').toBe(200);
    await shot(page, 'en-09-reactivated');
  });

  // ══ Arabic ═════════════════════════════════════════════════════════════

  test('AR — a second provider completes the same journey in Arabic', async ({ page, context }) => {
    const w = watch(page);
    const ar = await registerProvider();
    await completeDraft(ar);
    await acceptTerms(ar);

    await applyRealSession(context, ar);
    await seedLanguage(page, 'ar');
    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-task-list')).toBeVisible();

    // RTL, on the document itself.
    const { lang, dir } = await htmlLangDir(page);
    expect(lang).toBe('ar');
    expect(dir).toBe('rtl');
    const shellDir = await page
      .getByTestId('onboarding-v2-shell')
      .evaluate((el) => getComputedStyle(el).direction);
    expect(shellDir, 'the shell itself is RTL').toBe('rtl');

    await expectMobileFirstShell(page, 'AR hub');
    await expectTouchTargets(page, 'AR hub');
    await axe(page, 'hub', 'ar');
    await shot(page, 'ar-01-hub');

    // The pending specialty, in Arabic, as platform-owned waiting.
    const services = page.getByTestId('task-row-SERVICES_EXPERIENCE');
    await expect(services).toHaveAttribute('data-actionable', 'false');
    const explanation = page.getByTestId('task-explanation-SERVICES_EXPERIENCE');
    await expect(explanation).toBeVisible();
    const explanationText = (await explanation.innerText()).trim();
    // Arabic copy, not an English fallback.
    expect(explanationText).toMatch(/[؀-ۿ]/);
    expect(explanationText).not.toMatch(/we are checking/i);
    await axe(page, 'pending-moderation', 'ar');
    await shot(page, 'ar-02-pending-moderation');

    // THE CTA. Asserted against a code-point-built literal, and additionally
    // against the DOM's own text, so a manually reversed string fails.
    const cta = page.getByRole('button', { name: AR_SUBMIT });
    await expect(cta).toBeEnabled();
    const ctaText = (await cta.innerText()).trim();
    expect(ctaText, 'the CTA is stored in logical order').toBe(AR_SUBMIT);
    expect(
      [...ctaText].map((c) => c.codePointAt(0)),
      'the CTA is not a visually-reversed string',
    ).toEqual([...AR_SUBMIT].map((c) => c.codePointAt(0)));
    // The reversed form must not appear anywhere on the page.
    const reversed = [...AR_SUBMIT].reverse().join('');
    expect(await page.content()).not.toContain(reversed);

    await expectNoHorizontalPageOverflow(page);

    // Submit, in Arabic. The hub CTA opens the review task; the review
    // screen's own control submits.
    await cta.click();
    await expect(page.getByTestId('review-screen')).toBeVisible();
    await axe(page, 'review', 'ar');
    await shot(page, 'ar-02b-review');
    await expectNoHorizontalPageOverflow(page);

    const submitBtn = page.getByTestId('review-submit');
    await expect(submitBtn, 'a pending specialty leaves submission available').toBeEnabled();
    // The submit control carries the same logical-order Arabic string.
    expect((await submitBtn.innerText()).trim()).toBe(AR_SUBMIT);

    const post = page.waitForResponse(
      (r) => r.url().includes('/me/provider/onboarding/submit') && r.request().method() === 'POST',
    );
    await submitBtn.click();
    expect((await post).status()).toBe(200);

    await expect(page.getByTestId('review-submit'), 'submission is no longer offered').toHaveCount(
      0,
      { timeout: 20_000 },
    );
    await axe(page, 'review-submitted', 'ar');
    await shot(page, 'ar-03-submitted');
    await expectNoHorizontalPageOverflow(page);

    await page.goto('/provider/onboarding');
    await expect(page.getByTestId('hub-state-SUBMITTED')).toBeVisible({ timeout: 20_000 });
    await axe(page, 'submitted-hub', 'ar');
    await shot(page, 'ar-03b-submitted-hub');
    await expectNoHorizontalPageOverflow(page);

    expectQuiet(w, 'AR journey', { statuses: [401, 403] });

    // Denied work, in Arabic, without session-expiry copy.
    await page.goto('/provider/bids');
    await page.waitForTimeout(2_500);
    await expect(page).not.toHaveURL(/\/login/);
    // The server refuses this browser's own session, in Arabic too.
    const arDenied = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(arDenied.status(), 'the API refuses the AR browser session').toBe(403);
    await expectNoHorizontalPageOverflow(page);
    await axe(page, 'work-denied', 'ar');
    await shot(page, 'ar-04-work-denied');

    // Activate through the canonical chain and confirm in the browser.
    await approveProviderApplication(ar);
    await approveCategoriesFor(ar);
    const { caseId: arCase } = await supplyEvidence(ar);
    await waitForEvidenceClean(ar);
    await submitVerificationCase(ar);
    await approveVerificationCase(arCase);

    const w2 = watch(page);
    await page.goto('/provider/bids');
    await page.waitForTimeout(2_500);
    const bids = w2.statuses.filter((s) => s.url.includes('/provider/bids'));
    expect(
      bids.filter((s) => s.status !== 200),
      'AR provider is activated',
    ).toEqual([]);
    const arOpen = await page.request.get(`${REAL_API}/v1/provider/bids`);
    expect(arOpen.status(), 'the API serves the AR browser session').toBe(200);
    // The activation gate is gone rather than merely redirected past.
    await expect(page).not.toHaveURL(/\/provider\/(activate|status)/);
    await expectNoHorizontalPageOverflow(page);
    await axe(page, 'work-activated', 'ar');
    await shot(page, 'ar-05-work-activated');
  });

  test.afterAll(() => {
    writeFileSync(join(OUT, 'axe-report.json'), JSON.stringify(axeRecords, null, 2));
  });
});
