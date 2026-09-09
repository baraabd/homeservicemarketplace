import { expect, test, type Frame, type Page } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import {
  assertFontsReady,
  freezeMotion,
  injectVendoredFonts,
  neutraliseHarnessFontWeight,
  serveVendoredAssets,
} from './prototype-assets';

// These specs run as ES modules, so `__dirname` does not exist.
const HERE = dirname(fileURLToPath(import.meta.url));

// Sprint 09B.29 — the approved prototype, captured deterministically.
//
// This is the REFERENCE half of the visual gate. It opens the immutable
// prototype, drives its own controls (`#hsm-screen-picker`, `#hsm-lang`), and
// snapshots screens 0 and 1 in both languages at the design viewport.
//
// It is also a guard against reference DRIFT: on a second run it compares the
// prototype's rendering against the stored snapshot, so a change to the
// reference file, the pinned icon version, or the vendored fonts fails here
// rather than silently moving the target the implementation is measured against.
//
// WHAT IS CAPTURED, AND WHY IT IS NOT THE WHOLE PAGE
//
// `#hsm-phone-content` — the product surface — not `.hsm-phone`, which is the
// prototype's own 390px device bezel (28px radius, border, drop shadow) sitting
// next to a toolbar labelled "Prototype controls". That bezel is harness, and
// the approved responsive rule is a 480px column with no decorative frame, so
// baking the bezel into the baseline would make the target unreachable by
// construction. Recorded as conflict C4 in SPRINT_09B29_BASELINE.md §7.
//
// Needs no API, no database and no network: every external asset is vendored.

const PROTOTYPE = pathToFileURL(
  join(
    HERE,
    '..',
    '..',
    '..',
    'docs',
    'provider-experience-v2',
    'reference',
    'provider-onboarding-prototype.html',
  ),
).href;

/** The design width the contract names. The captured surface must be exactly
 *  this, and it is asserted rather than assumed. */
const DESIGN_WIDTH = 390;

/** The product surface inside the prototype's 1px harness bezel. Both halves of
 *  the visual gate are captured at this width. */
export const SURFACE_WIDTH = 388;

/**
 * The viewport the PROTOTYPE PAGE is given, which is not the design width.
 *
 * The prototype's outer wrapper sets `body { padding: 1rem }` and sizes its
 * iframe to `width: 100%`, so the phone column is the viewport minus 32px of
 * harness gutter, minus its own 1px borders. At a 390px viewport that yields a
 * 356px surface — a 34px error baked into every baseline, and one that would
 * then be blamed on the implementation.
 *
 * Widening the page by the gutter gives the phone its natural 390px. The
 * assertion below is what stops this drifting silently if the harness padding
 * ever changes.
 */
const PROTOTYPE_VIEWPORT = { width: DESIGN_WIDTH + 32, height: 900 };

/** Prototype screen indices, from its own `hsmScreens` table. */
const SCREEN = { activation: 0, sync: 1 } as const;

/** The prototype's product surface, inside its sandboxed iframe. */
async function openPrototype(page: Page): Promise<Frame> {
  const { missing } = await serveVendoredAssets(page);

  await page.setViewportSize(PROTOTYPE_VIEWPORT);
  await page.goto(PROTOTYPE);

  // The real markup lives in a sandboxed `srcdoc` iframe. Playwright reaches it
  // through the browser protocol, so the missing `allow-same-origin` does not
  // block us the way it would block script in the page.
  await page.waitForSelector('iframe');
  const frame = page.frames().find((f) => f !== page.mainFrame());
  expect(frame, 'the prototype iframe should be attached').toBeTruthy();

  await frame!.waitForSelector('#hsm-screen-picker');
  await frame!.waitForSelector('#hsm-phone-content');

  await injectVendoredFonts(frame!);
  await neutraliseHarnessFontWeight(frame!);
  await freezeMotion(frame!);
  await assertFontsReady(frame!);

  // Icons are drawn by the pinned lucide build. If interception missed, the
  // `<i data-lucide>` placeholders are never replaced and the capture is a
  // plausible-looking lie.
  await frame!.waitForFunction(
    () => document.querySelectorAll('#hsm-phone-content svg').length > 0,
    undefined,
    { timeout: 15_000 },
  );

  expect(missing, `every external asset must be vendored; unserved: ${missing.join(', ')}`).toEqual(
    [],
  );

  return frame!;
}

/** Select a screen by index and settle. */
async function selectScreen(frame: Frame, index: number): Promise<void> {
  await frame.selectOption('#hsm-screen-picker', String(index));
  await frame.waitForFunction(
    (i) => (document.getElementById('hsm-screen-picker') as HTMLSelectElement).value === String(i),
    index,
  );
  // Icons are re-created on every render; wait for them again.
  await frame.waitForFunction(() => document.querySelectorAll('#hsm-phone-content svg').length > 0);
}

/**
 * Put the prototype into a language.
 *
 * `#hsm-lang` is a TOGGLE whose label shows the language it will switch TO, and
 * it starts in Arabic. Reading the current direction and pressing only when it
 * disagrees is what makes this idempotent — clicking blindly flips whatever it
 * finds.
 */
async function setLanguage(frame: Frame, lang: 'en' | 'ar'): Promise<void> {
  const want = lang === 'ar' ? 'rtl' : 'ltr';
  const current = await frame.getAttribute('.hsm-phone-inner', 'dir');
  if (current !== want) await frame.click('#hsm-lang');
  await frame.waitForFunction(
    (dir) => document.querySelector('.hsm-phone-inner')?.getAttribute('dir') === dir,
    want,
  );
  await frame.waitForFunction(() => document.querySelectorAll('#hsm-phone-content svg').length > 0);
}

/**
 * Pin the geometry both halves of the gate are compared at.
 *
 * The prototype caps its phone at exactly the 390px design width, and draws a
 * 1px bezel inside that cap — so the PRODUCT surface it encloses is 388px. That
 * 2px belongs to the harness (the bezel is the device mock, see the header), not
 * to the design, and nothing in the layout is sensitive at that granularity.
 *
 * Both facts are asserted rather than assumed: if the harness padding or the
 * bezel ever changes, this fails here instead of silently shifting every
 * baseline and blaming the implementation for the difference.
 */
async function assertDesignWidth(frame: Frame): Promise<void> {
  const phone = await frame.locator('.hsm-phone').boundingBox();
  expect(Math.round(phone?.width ?? 0), 'prototype phone honours the 390px design width').toBe(
    DESIGN_WIDTH,
  );

  const content = await frame.locator('#hsm-phone-content').boundingBox();
  expect(Math.round(content?.width ?? 0), 'product surface inside the 1px bezel').toBe(
    SURFACE_WIDTH,
  );
}

test.describe('approved prototype — reference capture', () => {
  test.describe.configure({ timeout: 120_000 });

  for (const lang of ['en', 'ar'] as const) {
    test(`screen 0 (activation), ${lang}`, async ({ page }) => {
      const frame = await openPrototype(page);
      await setLanguage(frame, lang);
      await selectScreen(frame, SCREEN.activation);
      await setLanguage(frame, lang);

      const surface = frame.locator('#hsm-phone-content');
      await expect(surface).toBeVisible();
      await assertDesignWidth(frame);

      expect(await surface.screenshot()).toMatchSnapshot([
        'reference',
        `screen-0-activation-${lang}.png`,
      ]);
    });

    test(`screen 1 (synchronization), ${lang}`, async ({ page }) => {
      const frame = await openPrototype(page);
      await setLanguage(frame, lang);
      await selectScreen(frame, SCREEN.sync);
      await setLanguage(frame, lang);

      const surface = frame.locator('#hsm-phone-content');
      await expect(surface).toBeVisible();
      await assertDesignWidth(frame);

      expect(await surface.screenshot()).toMatchSnapshot([
        'reference',
        `screen-1-sync-${lang}.png`,
      ]);
    });
  }
});
