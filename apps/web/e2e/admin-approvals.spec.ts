import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  adminProviderRows, expectNoHorizontalPageOverflow, seedLanguage, signedInAdmin, stubApi,
} from './fixtures';

// Actual /admin route renders with deterministic HTTP fixtures. Backend claims
// and real-API screenshots remain in the separate un-stubbed acceptance suite.
const COUNTS = { all: 127, pendingReview: 24, draft: 18, active: 73, returned: 9, suspended: 3 };
async function prepare(page: Page, lang: 'en' | 'ar') {
  await seedLanguage(page, lang);
  await stubApi(page, { me: signedInAdmin() });
  const template = adminProviderRows().find((row) => row.status === 'PENDING_REVIEW')!;
  const names = lang === 'ar'
    ? ['أحمد الخطيب', 'نور الحسن', 'سامر العلي']
    : ['Ahmad Al Khatib', 'Nour Al Hassan', 'Samer Al Ali'];
  const items = names.map((name, i) => ({
    ...template,
    id: `applicant-${i}`,
    displayName: name,
    initials: lang === 'ar' ? ['أخ', 'نح', 'سع'][i] : ['AK', 'NH', 'SA'][i],
    email: `applicant${i}@example.test`,
    serviceAreaCity: lang === 'ar' ? 'دمشق' : 'Damascus',
    serviceAreaCountry: lang === 'ar' ? 'سوريا' : 'Syria',
    submittedForReviewAt: '2026-09-17T08:00:00.000Z',
  }));
  let failed = false;
  await page.route('**/v1/admin/providers**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/v1/admin/providers') return route.fallback();
    return route.fulfill({
      status: failed ? 500 : 200,
      contentType: 'application/json',
      body: JSON.stringify(failed
        ? { error: { code: 'INTERNAL_ERROR' } }
        : { items, counts: COUNTS, total: 24, nextCursor: null }),
    });
  });
  return { fail: () => { failed = true; } };
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`approval center is discoverable and accessible in ${lang} ${theme}`, async ({ page }, testInfo) => {
      await prepare(page, lang);
      await page.goto('/admin');
      const center = page.getByTestId('admin-approval-center');
      await expect(center).toBeVisible();
      await expect(page.getByTestId('approval-count-pendingReview')).toHaveText((24).toLocaleString(lang));
      if (theme === 'dark')
        await page.getByRole('button', { name: lang === 'ar' ? 'الوضع الداكن' : 'Dark theme', exact: true }).click();
      const widths = testInfo.project.name.endsWith('desktop')
        ? [1024, 1440]
        : testInfo.project.name.endsWith('tablet') ? [768] : [320, 390, 430];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await expect(center).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        const primary = center.getByRole('link', {
          name: lang === 'ar' ? 'مراجعة طلبات التسجيل' : 'Review applications', exact: true,
        });
        await expect(primary).toBeVisible();
        await expectNoHorizontalPageOverflow(page);
        await page.evaluate(() => document.fonts.ready);
        const result = await new AxeBuilder({ page })
          .include('[data-testid="admin-approval-center"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(result.violations).toEqual([]);
        await primary.focus();
        await expect(primary).toBeFocused();
        const size = await primary.boundingBox();
        expect(size?.height).toBeGreaterThanOrEqual(44);
        await page.evaluate(() => window.scrollTo(0, 0));
        const path = testInfo.outputPath(`approval-center-${lang}-${theme}-${width}.png`);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        await testInfo.attach(`approval-center-${lang}-${theme}-${width}`, { path, contentType: 'image/png' });
      }
      await center.getByRole('link', {
        name: lang === 'ar' ? 'مراجعة طلبات التسجيل' : 'Review applications', exact: true,
      }).click();
      await expect(page).toHaveURL(/\/admin\/reviews$/);
      await expect(page.getByTestId('admin-review-directory')).toBeVisible();
      await page.goBack();
      await expect(center).toBeVisible();
      await page.reload();
      await expect(center).toBeVisible();
    });
  }
}

test('home never treats failed application loading as an empty successful queue', async ({ page }) => {
  const state = await prepare(page, 'en');
  await page.goto('/admin');
  await expect(page.getByTestId('approval-preview-applicant-0')).toBeVisible();
  state.fail();
  await page.getByTestId('approval-refresh').click();
  await expect(page.getByTestId('approval-preview-applicant-0')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('approval-count-pendingReview')).toHaveText('—');
  await expect(page.getByText('No applications awaiting review', { exact: true })).toHaveCount(0);
});
