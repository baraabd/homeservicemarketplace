import { expect, test } from '@playwright/test';

import {
  expectLegible,
  expectNoHorizontalPageOverflow,
  expectVisibleFocusIndicator,
  htmlLangDir,
  langToggle,
  seedLanguage,
  stubApi,
} from './fixtures';

// Phase 12 — RTL in a real browser.
//
// The defect these pin: `dir` was applied only to inner <div> wrappers and
// `lang` was whatever index.html hardcoded, so
//   - assistive technology announced Arabic content in an English voice;
//   - the UA's own bidi handling never engaged, leaving native form controls,
//     scrollbar side, and text selection LTR inside an RTL layout;
//   - the choice reset to English on every reload.
//
// A jsdom/happy-dom test cannot catch any of this: it reports whatever
// attributes it is told about and has no layout engine. Hence a real Chromium.

test.beforeEach(async ({ page }) => {
  await stubApi(page); // unauthenticated; /login renders the public shell
});

test.describe('language and direction', () => {
  test('English renders with html lang=en and dir=ltr', async ({ page }) => {
    await page.goto('/login');
    await expect(langToggle(page)).toBeVisible();

    const { lang, dir } = await htmlLangDir(page);
    expect(lang).toBe('en');
    expect(dir).toBe('ltr');
  });

  test('switching via the VISIBLE control flips to lang=ar and dir=rtl', async ({ page }) => {
    await page.goto('/login');
    await expect(langToggle(page)).toBeVisible();

    // Deliberately driven through the control a user would click, not by
    // poking state — a test that sets the language directly would still pass
    // if the toggle were broken.
    await langToggle(page).click();

    await expect
      .poll(async () => (await htmlLangDir(page)).lang, { message: 'html lang' })
      .toBe('ar');
    expect((await htmlLangDir(page)).dir).toBe('rtl');
  });

  test('the Arabic choice survives NAVIGATION', async ({ page }) => {
    await page.goto('/login');
    await langToggle(page).click();
    await expect.poll(async () => (await htmlLangDir(page)).lang).toBe('ar');

    await page.goto('/signup');
    await expect(langToggle(page)).toBeVisible();
    const after = await htmlLangDir(page);
    expect(after.lang).toBe('ar');
    expect(after.dir).toBe('rtl');
  });

  test('the Arabic choice survives a full RELOAD', async ({ page }) => {
    await page.goto('/login');
    await langToggle(page).click();
    await expect.poll(async () => (await htmlLangDir(page)).lang).toBe('ar');

    await page.reload();
    await expect(langToggle(page)).toBeVisible();
    const after = await htmlLangDir(page);
    expect(after.lang).toBe('ar');
    expect(after.dir).toBe('rtl');
  });

  test('switching back restores LTR', async ({ page }) => {
    // Deliberately NOT seeded: seedLanguage() uses addInitScript, which re-runs
    // on every navigation INCLUDING the reload below, so it would keep writing
    // 'ar' back and mask a broken switch-back. Reaching Arabic by clicking is
    // also closer to what a user does.
    await page.goto('/login');
    await langToggle(page).click();
    await expect.poll(async () => (await htmlLangDir(page)).dir).toBe('rtl');

    await langToggle(page).click();

    await expect.poll(async () => (await htmlLangDir(page)).lang).toBe('en');
    expect((await htmlLangDir(page)).dir).toBe('ltr');

    // And the restoration persists too — otherwise a user who switched back
    // would find themselves in Arabic again on the next load.
    await page.reload();
    await expect(langToggle(page)).toBeVisible();
    expect((await htmlLangDir(page)).lang).toBe('en');
  });

  test('a blocked localStorage does not break the app', async ({ page }) => {
    // Safari private mode and "block site data" make localStorage THROW rather
    // than return null. An unguarded read would take down first render.
    await page.addInitScript(() => {
      const boom = () => {
        throw new Error('storage blocked');
      };
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get: () => ({ getItem: boom, setItem: boom, removeItem: boom }),
      });
    });
    await page.goto('/login');

    await expect(langToggle(page)).toBeVisible();
    expect((await htmlLangDir(page)).lang).toBe('en');
    // The toggle still works in-session; only persistence is lost.
    await langToggle(page).click();
    await expect.poll(async () => (await htmlLangDir(page)).lang).toBe('ar');
  });
});

test.describe('RTL layout geometry', () => {
  for (const lang of ['en', 'ar'] as const) {
    test(`the ${lang} auth screen does not scroll horizontally`, async ({ page }) => {
      await seedLanguage(page, lang);
      await page.goto('/login');
      await expect(langToggle(page)).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    });

    test(`the ${lang} signup screen does not scroll horizontally`, async ({ page }) => {
      await seedLanguage(page, lang);
      await page.goto('/signup');
      await expect(langToggle(page)).toBeVisible();
      await expectNoHorizontalPageOverflow(page);
    });
  }

  test('Arabic text is rendered and legible, not clipped to nothing', async ({ page }) => {
    await seedLanguage(page, 'ar');
    await page.goto('/login');
    await expect(langToggle(page)).toBeVisible();

    const heading = page.getByRole('heading').first();
    await expectLegible(heading, 'Arabic heading');

    // Arabic script must actually be on screen — a missing translation would
    // render Latin text inside an RTL document and still "pass" a dir check.
    const text = await page.locator('body').innerText();
    expect(text, 'no Arabic script rendered').toMatch(/[؀-ۿ]/);
  });

  test('the language toggle keeps a visible focus indicator', async ({ page }) => {
    await page.goto('/login');
    await expectVisibleFocusIndicator(langToggle(page), 'language toggle');
  });

  test('the language toggle is reachable and operable by KEYBOARD alone', async ({ page }) => {
    await page.goto('/login');
    const toggle = langToggle(page);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await htmlLangDir(page)).lang).toBe('ar');
  });

  test('form inputs stay inside the viewport in Arabic', async ({ page }) => {
    await seedLanguage(page, 'ar');
    await page.goto('/login');
    await expect(langToggle(page)).toBeVisible();

    const inputs = page.locator('input');
    const count = await inputs.count();
    expect(count, 'expected the login form to render inputs').toBeGreaterThan(0);

    const viewport = page.viewportSize()!;
    for (let i = 0; i < count; i += 1) {
      const box = await inputs.nth(i).boundingBox();
      if (!box) continue;
      expect(box.x, `input ${i} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
      expect(
        box.x + box.width,
        `input ${i} extends past the right edge of the viewport`,
      ).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});
