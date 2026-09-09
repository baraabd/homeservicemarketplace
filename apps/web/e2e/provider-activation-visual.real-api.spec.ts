import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { seedLanguage } from './fixtures';
import { api, newJar, otpFor, REAL_API, type Jar } from './real-api';
import { assertFontsReady, freezeMotion, serveVendoredAssets } from './prototype-assets';
import { recordParityEvidence, writeParityReport, type ParityMeasurement } from './visual-evidence';

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = join(HERE, '__screenshots__', 'reference');
/** Written for every case, pass or fail — see `visual-evidence.ts`. */
const EVIDENCE_DIR = join(HERE, '..', 'test-results', 'visual-evidence');

// Sprint 09B.29 — the IMPLEMENTATION half of the visual gate for prototype
// screens 0 and 1, compared against the approved reference.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md
//
// The reference snapshots are produced by `prototype-reference.spec.ts` from the
// immutable prototype, under the same pinned icon build, the same vendored
// fonts, the same viewport, the same locale and with motion frozen. This spec
// renders the real implementation through the real API and compares against
// them, so a difference here is a difference in the PRODUCT.
//
// GEOMETRY. Both halves are captured at 388×764 — the product surface inside
// the prototype's 1px harness bezel, which caps its phone at the 390px design
// width. That 2px belongs to the device mock, not the design; see
// `prototype-reference.spec.ts` for the assertions that pin it.
//
// TRANSIENT STATES. Screen 1 exists only while the session rotation is open. It
// is captured by HOLDING the real refresh request, not by faking it: the
// request still travels to the real API and its real response is returned, so
// the journey completes for real afterwards.

const FLAG_KEY = 'hsm.ff.providerOnboardingV2';
const PASSWORD = 'a-reasonable-passphrase-1';

/** Matches the reference capture exactly. */
const SURFACE = { width: 388, height: 764 };

/** The threshold the contract names. */
const VISUAL = { maxDiffPixelRatio: 0.005 } as const;

test.describe('activation screens 0 and 1 — visual parity with the approved prototype', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is not set — start the real stack to run these.');
  test.describe.configure({ timeout: 180_000 });

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

  // `context` only — listing `page` here would create it before these init
  // scripts are registered, so neither the flag nor the language would reach the
  // page the test actually drives.
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(([key]) => window.localStorage.setItem(key, 'true'), [FLAG_KEY]);
    await seedLanguage(context, 'en');
  });

  /** Collected across both language runs and written once at the end. */
  const measurements: ParityMeasurement[] = [];
  test.afterAll(() => {
    if (measurements.length) writeParityReport(EVIDENCE_DIR, measurements);
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`screens 0 and 1 match the reference, ${lang}`, async ({ page }, testInfo) => {
      // The same deterministic asset layer the reference used: pinned icons,
      // vendored Inter and Cairo, nothing from the network.
      const { missing } = await serveVendoredAssets(page);
      await page.setViewportSize(SURFACE);

      const { email } = await registerSeeker(`visual-${lang}`);
      await signIn(page, email);

      if (lang === 'ar') {
        await page.addInitScript(() => window.localStorage.setItem('hsm.lang', 'ar'));
      }

      // ── screen 0 — activation, idle ───────────────────────────────────
      await test.step('screen 0 — activation idle', async () => {
        await page.goto('/provider/activate');
        await expect(page.getByTestId('activation-hero')).toBeVisible();
        await freezeMotion(page);
        await assertFontsReady(page);

        const shell = page.getByTestId('onboarding-v2-shell');
        await expect(shell).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByTestId('onboarding-v2-progress-bar')).toHaveAttribute(
          'aria-valuenow',
          '0',
        );

        // One dominant primary action, at a real target size.
        const box = await page.getByTestId('activation-cta').boundingBox();
        expect(box?.height ?? 0, 'primary action is a 44px target').toBeGreaterThanOrEqual(44);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);

        const actual = await shell.screenshot();
        await testInfo.attach(`screen-0-activation-${lang}-actual`, {
          body: actual,
          contentType: 'image/png',
        });
        // Recorded BEFORE the assertion, so the evidence exists whichever way
        // the gate goes.
        measurements.push(
          await recordParityEvidence(page, {
            name: `screen-0-activation-${lang}`,
            actual,
            referencePath: join(REFERENCE_DIR, `screen-0-activation-${lang}.png`),
            outDir: EVIDENCE_DIR,
          }),
        );
        expect(actual).toMatchSnapshot(['reference', `screen-0-activation-${lang}.png`], VISUAL);
      });

      // ── screen 1 — synchronization, pending ───────────────────────────
      await test.step('screen 1 — synchronization pending', async () => {
        // Held, not faked. The request completes through the real API after the
        // capture, and the journey below proves it did.
        await page.route('**/v1/auth/refresh', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          await route.continue();
        });

        await page.getByTestId('activation-cta').click();
        await expect(page.getByTestId('activation-sync-notice')).toBeVisible({ timeout: 30_000 });

        // Park the pointer off every interactive target before capturing.
        //
        // Screen 0's CTA and screen 1's sticky action occupy the SAME rectangle,
        // so the click that advances the screen leaves the virtual mouse hovering
        // the new button — and the capture came back with a `:hover` accent
        // (#1d4ed8) where the reference has the resting one (#2563eb). That is a
        // 356x48 block: 17,088 pixels, almost exactly the residual the sticky
        // band was reporting. The prototype is a static document with no pointer
        // over it, so the resting state is the one under comparison.
        //
        // (4, 120) is the content background at the start edge: inside the
        // surface, outside the 20px centre gutter, and over nothing that has a
        // hover style.
        await page.mouse.move(4, 120);

        await freezeMotion(page);
        await assertFontsReady(page);

        const shell = page.getByTestId('onboarding-v2-shell');
        await expect(shell).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByTestId('onboarding-v2-progress-bar')).toHaveAttribute(
          'aria-valuenow',
          '5',
        );
        // A polite live region is present while the rotation runs.
        await expect(page.locator('[role="status"][aria-live="polite"]').first()).toHaveCount(1);

        const actual = await shell.screenshot();
        await testInfo.attach(`screen-1-sync-${lang}-actual`, {
          body: actual,
          contentType: 'image/png',
        });
        measurements.push(
          await recordParityEvidence(page, {
            name: `screen-1-sync-${lang}`,
            actual,
            referencePath: join(REFERENCE_DIR, `screen-1-sync-${lang}.png`),
            outDir: EVIDENCE_DIR,
          }),
        );
        expect(actual).toMatchSnapshot(['reference', `screen-1-sync-${lang}.png`], VISUAL);
      });

      // ── the held request really did complete ──────────────────────────
      await test.step('synchronization completes through the real API', async () => {
        await expect(page).toHaveURL(/\/provider\/onboarding$/, { timeout: 60_000 });
        await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
      });

      expect(
        missing,
        `every external asset must be vendored; unserved: ${missing.join(', ')}`,
      ).toEqual([]);
    });
  }
});
