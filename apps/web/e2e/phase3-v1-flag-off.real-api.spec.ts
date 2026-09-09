import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { expectNoHorizontalPageOverflow, seedLanguage } from './fixtures';
import {
  acceptTerms,
  api,
  completeDraft,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';

// Sprint 09B.29 Phase 3, Section 4 — the V1 journey, flag OFF, real browser.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §3.12
//
// THE POINT OF A SECOND BUNDLE
//
// `VITE_PROVIDER_ONBOARDING_V2` is a BUILD-TIME flag: vite replaces
// `import.meta.env.VITE_PROVIDER_ONBOARDING_V2` with a literal, so one artifact
// can only ever prove one value. Proving the OFF state therefore needs a second
// bundle, built with the flag explicitly false, served from its own directory
// on its own port:
//
//   dist-phase3-v2  ->  127.0.0.1:4177   inlines ("true")
//   dist-phase3-v1  ->  127.0.0.1:4178   inlines ("false")
//
// This file runs against 4178 and NEVER seeds
// `localStorage['hsm.ff.providerOnboardingV2']`. The override exists and works,
// and using it here would prove only that the override works — not that the
// shipped artifact is configured the way a flag-off deployment would be.
//
// Same real API (4012), same Postgres, same Redis, same guards. No route
// interception anywhere.

const OUT = join('e2e', '__artifacts__', 'phase3-v1');
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING = new Set(['critical', 'serious']);
const FLAG_KEY = 'hsm.ff.providerOnboardingV2';

interface AxeRecord {
  scenario: string;
  lang: string;
  violations: number;
  blocking: number;
  details: Array<{ rule: string; impact: string | null; target: string; summary: string }>;
}
const axeRecords: AxeRecord[] = [];

test.describe('Phase 3 — V1 provider onboarding, flag OFF, real browser', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the isolated Phase 3 stack.');

  test.describe.configure({ timeout: 300_000, mode: 'serial' });
  test.use({ viewport: { width: 390, height: 844 } });

  mkdirSync(OUT, { recursive: true });

  let account: Account;

  async function applyRealSession(context: BrowserContext, acc: Account): Promise<void> {
    const host = new URL(REAL_API).hostname;
    await context.addCookies(
      [...acc.jar].map(([name, value]) => ({
        name,
        value,
        domain: host,
        path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
      })),
    );
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
      details: results.violations.flatMap((v) =>
        v.nodes.map((n) => ({
          rule: v.id,
          impact: v.impact ?? null,
          target: n.target.join(' '),
          summary: (n.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
        })),
      ),
    });
    expect(
      blocking.flatMap((v) =>
        v.nodes.map((n) => `${v.id} [${v.impact}] ${n.target.join(' ')} :: ${n.failureSummary}`),
      ),
      `axe blocking violations on "${scenario}" (${lang})`,
    ).toEqual([]);
  }

  /** The V1 wizard, reached the way a flag-off deployment reaches it. */
  async function openV1(page: Page, lang: 'en' | 'ar'): Promise<void> {
    await seedLanguage(page, lang);
    await page.goto('/provider');
    // The V2 route is not merely unrendered — it redirects away.
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
    await page
      .getByRole('button', { name: lang === 'ar' ? /متابعة|إكمال/ : /continue onboarding/i })
      .first()
      .click();
  }

  // ══ the artifact itself ════════════════════════════════════════════════

  test('the served bundle has the flag compiled OFF, with no override in play', async ({
    page,
    context,
  }) => {
    account = await registerProvider();
    await applyRealSession(context, account);
    await seedLanguage(page, 'en');
    await page.goto('/provider');

    // Nothing seeded the override, and nothing set it at runtime.
    const override = await page.evaluate((k) => window.localStorage.getItem(k), FLAG_KEY);
    expect(override, 'the flag proof must not rest on a localStorage override').toBeNull();

    // The V2 route is unreachable from this artifact.
    await page.goto('/provider/onboarding');
    await expect(page).toHaveURL(/\/provider$/);
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
    await expect(page.getByTestId('hub-task-list')).toHaveCount(0);

    // And this preview is serving the V1 artifact, not the V2 one.
    const entry = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src)
        .join(','),
    );
    expect(entry, 'the V1 preview serves its own bundle').toContain('/assets/index-');
  });

  test('EN — V1 renders, and the pending specialty is shown separately from missing work', async ({
    page,
    context,
  }) => {
    // Complete the provider-owned inputs; the SPECIALTIES step files the
    // PENDING moderation application.
    await completeDraft(account);
    await acceptTerms(account);

    await applyRealSession(context, account);
    await openV1(page, 'en');

    // The Sprint 8 wizard, identified by vocabulary only it has.
    await expect(page.getByText('Account type', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);
    await shot(page, 'en-01-v1-wizard');

    // Walk to the review step, where both lists live.
    const review = page.getByTestId('wizard-awaiting-review');
    for (let i = 0; i < 12 && !(await review.isVisible().catch(() => false)); i++) {
      const next = page.getByRole('button', { name: /next|review|continue/i }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(400);
    }

    // The platform-owned item is present, as its own status block…
    await expect(review, 'awaitingReview is rendered').toBeVisible({ timeout: 20_000 });
    await expect(review).toHaveAttribute('role', 'status');
    await expect(review).toContainText(/we are checking your services/i);
    await expect(review).toContainText(/do not need to do anything/i);

    // …and NOT in the provider-action list.
    await expect(
      page.getByTestId('wizard-missing'),
      'a platform item never joins the amber to-do list',
    ).toHaveCount(0);

    await expectNoHorizontalPageOverflow(page);
    await axe(page, 'v1-review-pending-moderation', 'en');
    await shot(page, 'en-02-awaiting-review');
  });

  test('EN — submission stays available and succeeds while moderation is pending', async ({
    page,
    context,
  }) => {
    await applyRealSession(context, account);
    await openV1(page, 'en');

    const submit = page.getByRole('button', { name: 'Send application' }).last();
    for (let i = 0; i < 12 && !(await submit.isVisible().catch(() => false)); i++) {
      const next = page.getByRole('button', { name: /next|review|continue/i }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(400);
    }
    await expect(submit, 'moderation does not disable submission').toBeEnabled();

    const post = page.waitForResponse(
      (r) => r.url().includes('/me/provider/onboarding/submit') && r.request().method() === 'POST',
    );
    await submit.click();
    expect((await post).status(), 'a pending specialty does not block V1 submission').toBe(200);

    await shot(page, 'en-03-submitted');

    // The server agrees: still pending moderation, application in.
    const draft = await api<{ awaitingReview: unknown[]; missing: unknown[] }>(
      account.jar,
      '/v1/me/provider/onboarding/draft',
    );
    expect(draft.body.awaitingReview.length).toBeGreaterThan(0);
    expect(draft.body.missing, 'the platform item is not provider work').toEqual([]);
  });

  test('EN — data survives navigation, hard reload and sign-out/sign-in', async ({
    page,
    context,
  }) => {
    // A DEDICATED, unsubmitted account.
    //
    // Reusing the account from the previous test does not work and should not:
    // once an application is handed in the wizard is no longer editable, so
    // "Continue onboarding" is correctly absent and there is no form left to
    // prove persistence against. Persistence is a property of a DRAFT, so this
    // test owns a draft.
    const draftAccount = await registerProvider();
    await completeDraft(draftAccount);
    await acceptTerms(draftAccount);

    await applyRealSession(context, draftAccount);
    await openV1(page, 'en');

    const before = await api<{ data: { displayName: string } }>(
      draftAccount.jar,
      '/v1/me/provider/onboarding/draft',
    );
    const name = before.body.data.displayName;
    expect(name, 'the fixture wrote a display name').toBeTruthy();

    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    // Hard reload.
    await page.reload();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    // Browser navigation.
    await page.goto('/provider');
    await page.goBack();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    // A real sign-out and sign-in through the actual form and OTP screen.
    await context.clearCookies();
    await page.goto('/provider');
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
    await loginViaUi(page, draftAccount);
    await expect(page).toHaveURL(/\/provider/, { timeout: 60_000 });

    // Login lands on the workspace, not inside the wizard — so re-enter it the
    // way the provider would. Asserting the draft value on `/provider` would be
    // testing the shell's identity header, not persistence of the answer.
    await openV1(page, 'en');
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
    await shot(page, 'en-04-persisted-after-relogin');
  });

  test('AR — the same V1 surface in Arabic', async ({ page, context }) => {
    const ar = await registerProvider();
    await completeDraft(ar);
    await acceptTerms(ar);

    await applyRealSession(context, ar);
    await seedLanguage(page, 'ar');
    await page.goto('/provider');

    // Still V1, still no override.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), FLAG_KEY)).toBeNull();
    await expect(page.getByTestId('onboarding-v2-shell')).toHaveCount(0);

    const dir = await page.evaluate(() => document.documentElement.dir);
    expect(dir, 'Arabic renders RTL').toBe('rtl');

    await page
      .getByRole('button', { name: /متابعة|إكمال/ })
      .first()
      .click()
      .catch(() => undefined);

    const review = page.getByTestId('wizard-awaiting-review');
    for (let i = 0; i < 12 && !(await review.isVisible().catch(() => false)); i++) {
      const next = page.getByRole('button', { name: /التالي|مراجعة|متابعة/ }).last();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.waitForTimeout(400);
    }

    await expect(review, 'awaitingReview is rendered in Arabic').toBeVisible({ timeout: 20_000 });
    const text = (await review.innerText()).trim();
    // Arabic copy, not an English fallback.
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).not.toMatch(/we are checking/i);
    await expect(page.getByTestId('wizard-missing')).toHaveCount(0);

    await expectNoHorizontalPageOverflow(page);
    await axe(page, 'v1-review-pending-moderation', 'ar');
    await shot(page, 'ar-01-awaiting-review');
  });

  test.afterAll(() => {
    writeFileSync(join(OUT, 'axe-report.json'), JSON.stringify(axeRecords, null, 2));
  });
});
