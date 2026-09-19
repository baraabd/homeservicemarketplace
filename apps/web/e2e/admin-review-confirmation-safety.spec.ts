import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openReviewTask } from './admin-review-tabs';
import { expectNoHorizontalPageOverflow, seedLanguage, signedInAdmin } from './fixtures';
import {
  actionableReview, portfolioItem, PORTFOLIO_PATH,
} from '../src/app/features/admin-provider-review/tests/review-safety-fixtures';

// Deterministic browser/UI evidence, not backend authorization or persistence.
// The separate required admin-review real-API job remains unchanged.
const ROOT = '/v1/admin/providers/provider-1';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf9sAAAAASUVORK5CYII=',
  'base64',
);
for (const [lang, width] of [['en', 1440], ['ar', 390]] as const) {
  test(`portfolio conflict recovery and denied-preview cleanup (${lang}, ${width}, UI fixture)`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seedLanguage(page, lang);
    let portfolioStatus = 200;
    let writes = 0;
    await page.route('**/v1/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = (body: unknown, status = 200) => route.fulfill({
        status, contentType: 'application/json', body: JSON.stringify(body),
      });
      if (path.endsWith('/auth/me')) return json(signedInAdmin());
      if (path === `${ROOT}/review`) return json(actionableReview());
      if (path === ROOT) return json({}, 403); // independent account controls unavailable
      if (path === PORTFOLIO_PATH) return json({ items: [portfolioItem] }, portfolioStatus);
      if (path === `${PORTFOLIO_PATH}/image-1/media`) return route.fulfill({
        contentType: 'image/png', body: PNG, headers: { 'Cache-Control': 'private, no-store' },
      });
      if (path === `${PORTFOLIO_PATH}/image-1/review`) {
        writes++;
        expect(route.request().postDataJSON().expectedRevision).toBe(3);
        return json({ error: { code: 'CONFLICT' } }, 409);
      }
      if (path.includes('/notifications/unread-count')) return json({ count: 0 });
      return json({ items: [], nextCursor: null });
    });
    await page.goto('/admin/providers/provider-1');
    await openReviewTask(page, 'PORTFOLIO');
    await page.getByTestId('review-portfolio-open-image-1').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('img')).toBeVisible();
    await page.getByTestId('review-portfolio-action-reject').click();
    const reason = lang === 'ar' ? 'يرجى إزالة البيانات الخاصة قبل إعادة إرسال الصورة.' : 'Please remove private details before resubmitting.';
    await dialog.getByRole('textbox').fill(reason);
    await page.getByTestId('review-portfolio-confirm').click();
    await expect(page.getByTestId('review-portfolio-reload')).toBeVisible();
    portfolioStatus = 500;
    await page.getByTestId('review-portfolio-reload').click();
    await expect(dialog.getByRole('status')).toContainText(lang === 'ar' ? 'القرارات متوقفة' : 'Decisions are paused');
    await expect(dialog.getByRole('textbox')).toHaveValue(reason);
    expect(writes).toBe(1);
    await expectNoHorizontalPageOverflow(page);
    const audit = await new AxeBuilder({ page }).include('[role="dialog"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    await testInfo.attach('axe-confirmation-safety.json', {
      body: JSON.stringify(audit, null, 2), contentType: 'application/json',
    });
    expect(audit.violations).toEqual([]);
    const screenshot = testInfo.outputPath(`admin-review-preserved-conflict-${lang}-${width}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach(`Preserved portfolio conflict ${lang} ${width} (UI fixture)`, {
      path: screenshot, contentType: 'image/png',
    });
    portfolioStatus = 403;
    await page.getByTestId('review-portfolio-reload').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('img.ar-inspected-image')).toHaveCount(0);
    await expect(page.getByTestId('review-portfolio-retry')).toBeFocused();
    expect(writes).toBe(1);
  });
}
