import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { seedLanguage } from './fixtures';
import { api, newJar, otpFor, REAL_API, type Jar } from './real-api';

// Sprint 09B.29 — accessibility for prototype screens 0 and 1.
//
// TWO LAYERS, REPORTED SEPARATELY
//
// 1. AUTOMATED — axe-core over the whole rendered page, at the WCAG 2.2 AA tag
//    set. Nothing is disabled and nothing is excluded: a rule turned off to get
//    a green run is a rule that will never catch anything, and an `.exclude()`
//    around the region under test is the same thing wearing a disguise. The
//    gate is "no critical or serious violations".
//
// 2. EXPLICIT — the things axe cannot decide. Automated tooling can see that a
//    control has a name; it cannot see whether the name is the right one, that
//    the focus order matches the reading order, that a retry button actually
//    retries, or that focus survives an asynchronous transition. Those are
//    asserted by driving the keyboard and reading the result.
//
// Both layers run against the REAL API in a REAL browser, over the same states
// the visual gate captures, in both languages.
//
// HOW THE FAILURE STATES ARE REACHED
//
// The account is genuinely upgraded server-side every time. What is intercepted
// is the SESSION ROTATION, because the two failures under test are defined by
// what the rotation returns:
//
//   refresh-failed  POST /v1/auth/refresh fails at the transport level.
//   role-missing    the rotation succeeds and the authoritative session still
//                   does not carry `provider` — so GET /v1/auth/me is answered
//                   with the real response minus that role.
//
// Neither weakens a guard: the server's answer is unchanged, and the client is
// shown the reply it would receive if the rotation genuinely lagged.

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, '..', 'test-results', 'a11y-evidence');
const FLAG_KEY = 'hsm.ff.providerOnboardingV2';
const PASSWORD = 'a-reasonable-passphrase-1';
const SURFACE = { width: 388, height: 764 };

/** WCAG 2.2 AA, the level the rule names. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The impacts that fail the gate. */
const BLOCKING_IMPACTS = new Set(['critical', 'serious']);

interface AxeRecord {
  scenario: string;
  lang: string;
  violations: number;
  blocking: number;
  passes: number;
  incomplete: number;
  rules: string[];
}

const axeRecords: AxeRecord[] = [];
const explicitRecords: Array<{ scenario: string; lang: string; check: string; detail: string }> =
  [];

function note(scenario: string, lang: string, check: string, detail: string): void {
  explicitRecords.push({ scenario, lang, check, detail });
}

/**
 * The automated layer. Whole page, WCAG 2.2 AA tags, nothing disabled.
 *
 * Returns the full result so a caller can record it; fails the test on any
 * critical or serious violation, naming them so the report is actionable
 * rather than a bare count.
 */
async function scan(page: Page, scenario: string, lang: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter((v) => BLOCKING_IMPACTS.has(v.impact ?? ''));

  axeRecords.push({
    scenario,
    lang,
    violations: results.violations.length,
    blocking: blocking.length,
    passes: results.passes.length,
    incomplete: results.incomplete.length,
    rules: results.violations.map((v) => `${v.id}(${v.impact}, ${v.nodes.length})`),
  });

  expect(
    blocking.map(
      (v) =>
        `${v.id} [${v.impact}] ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join('; ')}`,
    ),
    `axe found blocking violations on "${scenario}" (${lang})`,
  ).toEqual([]);
}

/** WCAG relative luminance, for the contrast checks axe cannot do on a state
 *  it never puts the element into (hover, focus). */
function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = (c: [number, number, number]) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function parseRgb(value: string): [number, number, number] {
  const m = value.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) throw new Error(`cannot parse colour: ${value}`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

test.describe('activation screens 0 and 1 — accessibility', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the real stack to run these.');
  test.describe.configure({ timeout: 180_000 });

  test.afterAll(() => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(
      join(EVIDENCE_DIR, 'a11y-results.json'),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          tags: WCAG_TAGS,
          blockingImpacts: [...BLOCKING_IMPACTS],
          automated: axeRecords,
          explicit: explicitRecords,
        },
        null,
        2,
      ),
    );
  });

  async function registerSeeker(prefix: string): Promise<{ email: string; jar: Jar }> {
    const jar = newJar();
    const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
    const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
      method: 'POST',
      body: { email, password: PASSWORD, firstName: 'Sam', lastName: 'Seeker' },
    });
    expect(registered.status, 'register should be accepted').toBeLessThan(400);
    const verified = await api(jar, '/v1/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
    });
    expect(verified.status).toBe(200);
    return { email, jar };
  }

  async function signIn(page: Page, email: string): Promise<void> {
    await page.goto('/login');
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    const otp = page.getByTestId('otp-input');
    await otp.waitFor({ state: 'visible', timeout: 45_000 });
    await otp.fill(await otpFor(email));
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 });
  }

  /**
   * Everything a scenario needs: a verified account, signed in, on screen 0.
   *
   * The language is switched AFTER sign-in, not in the context seed. Sign-in
   * happens on the shared auth screens, whose controls this file locates by
   * their English names; seeding Arabic up front renames them and the login
   * button is never found. The visual gate solves it the same way, and the
   * surfaces under test are entered in the language asked for either way.
   */
  async function arriveAtActivation(page: Page, lang: 'en' | 'ar', prefix: string): Promise<void> {
    await page.setViewportSize(SURFACE);
    const { email } = await registerSeeker(`${prefix}-${lang}`);
    await signIn(page, email);
    if (lang === 'ar') {
      await page.addInitScript(() => window.localStorage.setItem('hsm.lang', 'ar'));
    }
    await page.goto('/provider/activate');
    await expect(page.getByTestId('activation-hero')).toBeVisible();
  }

  // ONE hook for every test. Declaring it inside the language loop below
  // registers it twice on the same describe, so both copies run for every test
  // and the last one decides the language — which is how the whole file ended
  // up signing in against an Arabic login page.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(([key]) => window.localStorage.setItem(key, 'true'), [FLAG_KEY]);
    await seedLanguage(context, 'en');
  });

  for (const lang of ['en', 'ar'] as const) {
    const rtl = lang === 'ar';

    // ── idle -> pending -> recovered ─────────────────────────────────────
    test(`screen 0 idle, screen 1 pending, and the transition — ${lang}`, async ({ page }) => {
      await arriveAtActivation(page, lang, 'a11y-happy');

      // ── screen 0, activation idle ────────────────────────────────────
      await scan(page, 'screen-0-activation-idle', lang);

      const docLang = await page.evaluate(() => document.documentElement.lang);
      const docDir = await page.evaluate(() => document.documentElement.dir);
      expect(docLang, 'document language').toBe(lang);
      expect(docDir, 'document direction').toBe(rtl ? 'rtl' : 'ltr');
      await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute(
        'dir',
        rtl ? 'rtl' : 'ltr',
      );
      note('screen-0-activation-idle', lang, 'lang and dir', `html lang=${docLang} dir=${docDir}`);

      // Accessible names, read from the accessibility tree rather than the DOM.
      const closeName = await page.getByTestId('onboarding-v2-close').getAttribute('aria-label');
      expect(closeName?.trim(), 'close control has an accessible name').toBeTruthy();
      const cta = page.getByTestId('activation-cta');
      expect((await cta.textContent())?.trim(), 'primary action has a name').toBeTruthy();
      await expect(page.getByTestId('onboarding-v2-progress-bar')).toHaveAttribute(
        'aria-label',
        /.+/,
      );
      note(
        'screen-0-activation-idle',
        lang,
        'accessible names',
        `close="${closeName}" primary="${(await cta.textContent())?.trim()}" progressbar labelled`,
      );

      // Focus order follows the reading order: the way out, then the action.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      const first = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      await page.keyboard.press('Tab');
      const second = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      expect([first, second], 'focus order: close then primary action').toEqual([
        'onboarding-v2-close',
        'activation-cta',
      ]);
      note('screen-0-activation-idle', lang, 'focus order', `${first} -> ${second}`);

      // Visible focus. `Tab` puts the button in `:focus-visible`, so the outline
      // the design declares must actually be painted.
      const focusRing = await cta.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          outlineColor: cs.outlineColor,
          boxShadow: cs.boxShadow,
        };
      });
      expect(
        focusRing.outlineStyle !== 'none' && parseFloat(focusRing.outlineWidth) > 0,
        `keyboard focus must be visible (got ${JSON.stringify(focusRing)})`,
      ).toBe(true);
      note(
        'screen-0-activation-idle',
        lang,
        'visible focus',
        `outline ${focusRing.outlineWidth} ${focusRing.outlineStyle} ${focusRing.outlineColor}`,
      );

      // No keyboard trap: focus keeps moving and does not stick.
      const walked: Array<string | null> = [];
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        walked.push(await page.evaluate(() => document.activeElement?.tagName ?? null));
      }
      expect(new Set(walked).size, `focus is trapped: ${walked.join(',')}`).toBeGreaterThan(1);
      note('screen-0-activation-idle', lang, 'no keyboard trap', `walked ${walked.join(' -> ')}`);

      // Target size, and editable text size where any exists.
      const targets = await page.evaluate(() => {
        const out: Array<{ id: string; w: number; h: number }> = [];
        for (const el of document.querySelectorAll<HTMLElement>(
          '[data-testid="onboarding-v2-ground"] button, [data-testid="onboarding-v2-ground"] a[href]',
        )) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          out.push({
            id: el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 24) ?? '?',
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
        return out;
      });
      const tooSmall = targets.filter((t) => t.w < 44 || t.h < 44);
      expect(
        tooSmall,
        `every target is at least 44x44 (offenders: ${JSON.stringify(tooSmall)})`,
      ).toEqual([]);
      note(
        'screen-0-activation-idle',
        lang,
        'target size >= 44x44',
        targets.map((t) => `${t.id} ${t.w}x${t.h}`).join(', '),
      );

      const editable = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('input, textarea, select')].map((el) => ({
          tag: el.tagName,
          size: parseFloat(getComputedStyle(el).fontSize),
        })),
      );
      expect(
        editable.filter((e) => e.size < 16),
        'editable text is at least 16px',
      ).toEqual([]);
      note(
        'screen-0-activation-idle',
        lang,
        'editable text >= 16px',
        editable.length ? JSON.stringify(editable) : 'no editable controls on this screen',
      );

      // Contrast of the primary action at rest AND hovered — axe measures the
      // resting state only, and the hover tone is a different colour.
      const buttonContrast = await cta.evaluate((el) => {
        const cs = getComputedStyle(el);
        return {
          fg: cs.color,
          bgRest: cs.backgroundColor,
          fontSize: cs.fontSize,
          weight: cs.fontWeight,
        };
      });
      await cta.hover();
      const hoverBg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
      const restRatio = contrastRatio(parseRgb(buttonContrast.fg), parseRgb(buttonContrast.bgRest));
      const hoverRatio = contrastRatio(parseRgb(buttonContrast.fg), parseRgb(hoverBg));
      expect(
        restRatio,
        `primary action contrast at rest (${buttonContrast.bgRest})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(hoverRatio, `primary action contrast on hover (${hoverBg})`).toBeGreaterThanOrEqual(
        4.5,
      );
      note(
        'screen-0-activation-idle',
        lang,
        'contrast, interactive states',
        `rest ${restRatio.toFixed(2)}:1 (${buttonContrast.bgRest}), hover ${hoverRatio.toFixed(2)}:1 (${hoverBg})`,
      );

      // ── screen 1, synchronization pending ────────────────────────────
      // Held, not faked: the real rotation is delayed so the transient state
      // can be examined, and completes for real afterwards.
      await page.route('**/v1/auth/refresh', async (route) => {
        await new Promise((r) => setTimeout(r, 6_000));
        await route.continue();
      });

      // Operated from the KEYBOARD, which is the assertion: the flow must be
      // completable without a pointer.
      await cta.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('activation-sync-notice')).toBeVisible({ timeout: 30_000 });
      note('screen-1-sync-pending', lang, 'keyboard operation', 'activation triggered with Enter');

      await scan(page, 'screen-1-sync-pending', lang);

      // The live status must exist, be polite, and actually carry text while
      // the rotation is open — an empty live region announces nothing.
      const live = page.locator('[role="status"][aria-live="polite"]#activation-sync-status');
      await expect(live).toHaveCount(1);
      const announced = (await live.textContent())?.trim() ?? '';
      expect(announced.length, 'the live region announces the rotation').toBeGreaterThan(0);
      note('screen-1-sync-pending', lang, 'live status announcement', `polite: "${announced}"`);

      // The sticky action is present, named, focusable, and honestly reports
      // that it is not yet available.
      const syncCta = page.getByTestId('activation-sync-cta');
      await expect(syncCta).toBeVisible();
      await expect(syncCta).toHaveAttribute('aria-disabled', 'true');
      await expect(syncCta).toHaveAttribute('aria-describedby', 'activation-sync-status');
      await syncCta.focus();
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
        'an unavailable action is still reachable by keyboard, so its reason can be read',
      ).toBe('activation-sync-cta');
      note(
        'screen-1-sync-pending',
        lang,
        'unavailable action is reachable and explained',
        'aria-disabled=true, aria-describedby=activation-sync-status, focusable',
      );

      // Reduced motion: the spinner must stop, not merely slow down.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const spinnerAnimation = await page
        .locator('[data-testid="activation-sync-icon"] svg')
        .evaluate((el) => getComputedStyle(el).animationName);
      expect(spinnerAnimation, 'reduced motion stops the spinner').toBe('none');
      note('screen-1-sync-pending', lang, 'reduced motion', `animation-name=${spinnerAnimation}`);
      await page.emulateMedia({ reducedMotion: null });

      await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute(
        'dir',
        rtl ? 'rtl' : 'ltr',
      );
      note('screen-1-sync-pending', lang, 'lang and dir', `shell dir=${rtl ? 'rtl' : 'ltr'}`);

      // ── the transition completes ─────────────────────────────────────
      await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
      await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });

      // Focus after the async route change.
      //
      // The failure this rules out is a STALE focus reference: an activeElement
      // that has been detached from the document, which leaves a screen reader
      // announcing nothing and a keyboard user with no reliable starting point.
      //
      // It does NOT claim the new surface takes focus. It does not — focus
      // returns to `document.body` — and the assertion below says so rather
      // than being written loosely enough to pass either way. Moving focus into
      // the hub is the hub's job, and the hub is Phase 5; recorded here as a
      // measured gap so it is carried rather than lost.
      const focusAfter = await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el?.tagName ?? null,
          testid: el?.getAttribute('data-testid') ?? null,
          detached: el ? !el.isConnected : false,
          isBody: el === document.body,
          withinShell: el ? !!el.closest('[data-testid="onboarding-v2-ground"]') : false,
        };
      });
      expect(focusAfter.detached, 'focus must not be left on a detached node').toBe(false);
      note(
        'screen-1-sync-recovered',
        lang,
        'focus after the async transition',
        `activeElement=${focusAfter.tag}${focusAfter.testid ? `[${focusAfter.testid}]` : ''} ` +
          `detached=${focusAfter.detached} withinNewSurface=${focusAfter.withinShell} ` +
          `— no stale reference; the hub does not yet take programmatic focus (Phase 5 gap)`,
      );

      await scan(page, 'screen-1-sync-recovered-hub', lang);
    });

    // ── refresh failure, retryable ───────────────────────────────────────
    test(`screen 1 refresh failure offers an accessible retry — ${lang}`, async ({ page }) => {
      await arriveAtActivation(page, lang, 'a11y-refresh-fail');

      // The rotation fails at the transport level. The upgrade itself is real
      // and still commits on the server.
      await page.route('**/v1/auth/refresh', (route) => route.abort('failed'));

      await page.getByTestId('activation-cta').click();
      const error = page.getByTestId('activation-sync-error');
      await expect(error).toBeVisible({ timeout: 30_000 });
      await expect(error).toHaveAttribute('data-reason', 'refresh-failed');

      await scan(page, 'screen-1-refresh-failed', lang);

      // Focus was MOVED to the recovery block, so a screen-reader user lands on
      // the explanation rather than being left where the button used to be.
      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-testid'),
      );
      expect(focused, 'focus moves to the recovery alert').toBe('activation-sync-error');
      note(
        'screen-1-refresh-failed',
        lang,
        'focus management on failure',
        `activeElement=${focused}`,
      );

      // It is an alert, so it interrupts rather than waiting to be found.
      await expect(error).toHaveAttribute('role', 'alert');

      // The retry is named, reachable and operable from the keyboard.
      const retry = page.getByTestId('activation-sync-retry');
      await expect(retry).toBeVisible();
      const retryName = (await retry.textContent())?.trim();
      expect(retryName, 'retry has an accessible name').toBeTruthy();
      const retryBox = await retry.boundingBox();
      expect(retryBox?.height ?? 0, 'retry is a 44px target').toBeGreaterThanOrEqual(44);
      note(
        'screen-1-refresh-failed',
        lang,
        'retry accessibility',
        `name="${retryName}" height=${Math.round(retryBox?.height ?? 0)} role=alert container`,
      );

      // And it actually retries: with the route released, a keyboard press
      // completes the journey.
      await page.unroute('**/v1/auth/refresh');
      await retry.focus();
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('data-testid')),
        'retry is keyboard focusable',
      ).toBe('activation-sync-retry');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
      note(
        'screen-1-refresh-failed',
        lang,
        'keyboard operation of retry',
        'Enter on the retry completed the synchronization and navigated',
      );
    });

    // ── the rotation worked and the role still is not there ──────────────
    test(`screen 1 role-missing refusal is announced, not offered a retry — ${lang}`, async ({
      page,
    }) => {
      await arriveAtActivation(page, lang, 'a11y-role-missing');

      // The rotation succeeds; the authoritative session is answered without
      // the provider role, which is the `role-missing` fact the UI must not
      // confuse with an expired session.
      await page.route('**/v1/auth/me', async (route) => {
        const response = await route.fetch();
        const body = await response.json().catch(() => null);
        if (!body) return route.fulfill({ response });
        const stripped = {
          ...body,
          roles: (body.roles ?? []).filter((r: string) => r !== 'provider'),
        };
        await route.fulfill({ response, json: stripped });
      });

      await page.getByTestId('activation-cta').click();
      const error = page.getByTestId('activation-sync-error');
      await expect(error).toBeVisible({ timeout: 30_000 });
      await expect(error).toHaveAttribute('data-reason', 'role-missing');

      await scan(page, 'screen-1-role-missing-forbidden', lang);

      // No retry, because the server answered. Offering one would be a lie.
      await expect(page.getByTestId('activation-sync-retry')).toHaveCount(0);

      // And the copy must never say the session expired — that is a 401 fact.
      const text = ((await error.textContent()) ?? '').toLowerCase();
      for (const forbidden of [
        'sign in again',
        'session has expired',
        'تسجيل الدخول من جديد',
        'انتهت جلستك',
      ]) {
        expect(
          text.includes(forbidden.toLowerCase()),
          `role-missing copy must not say "${forbidden}"`,
        ).toBe(false);
      }
      note(
        'screen-1-role-missing-forbidden',
        lang,
        'no retry, no session-expired copy',
        'retry absent; copy free of sign-in wording',
      );

      const focused = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-testid'),
      );
      expect(focused, 'focus moves to the refusal').toBe('activation-sync-error');
      note(
        'screen-1-role-missing-forbidden',
        lang,
        'focus management on refusal',
        `activeElement=${focused}`,
      );
    });
  }
});
