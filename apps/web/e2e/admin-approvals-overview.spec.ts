import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminProviderRows, expectNoHorizontalPageOverflow, seedLanguage, signedInAdmin, stubApi } from './fixtures';

// Actual application routes and layout; illustrative API data, never real-API acceptance.
const applicants = ['Ahmad Khalil', 'Layla Mansour', 'Omar Haddad'].map((displayName, index) => ({
  ...adminProviderRows().find((row) => row.status === 'PENDING_REVIEW')!,
  id: `overview-applicant-${index}`, displayName, initials: displayName.split(' ').map((part) => part[0]).join(''),
  email: `applicant${index + 1}@example.test`, serviceAreaCity: 'Damascus', serviceAreaCountry: 'Syria',
}));
async function prepare(page: Page, lang: 'en' | 'ar' = 'en', denied = false) {
  await seedLanguage(page, lang);
  await stubApi(page, { me: signedInAdmin() });
  await page.route('**/v1/admin/providers**', async (route) => {
    if (denied) return route.fulfill({ status: 403, json: { error: { code: 'FORBIDDEN' } } });
    return route.fulfill({ json: { items: applicants, nextCursor: null, total: 23, counts: { all: 164, pendingReview: 23, active: 107, returned: 8, draft: 21, suspended: 5 } } });
  });
  await page.goto('/admin');
  await expect(page.getByTestId('admin-approvals-overview')).toBeVisible();
}

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`approval centre visible from normal Admin home — ${lang} ${theme}`, async ({ page }, testInfo) => {
      await prepare(page, lang);
      if (theme === 'dark') await page.getByRole('button', { name: lang === 'ar' ? 'الوضع الداكن' : 'Dark theme', exact: true }).click();
      const widths = testInfo.project.name.endsWith('desktop') ? [1024, 1440] : testInfo.project.name.endsWith('tablet') ? [768] : [320, 390, 430];
      const centre = page.getByTestId('admin-approvals-overview');
      await expect(centre.getByTestId('overview-count-pendingReview')).toHaveText((23).toLocaleString(lang));
      await expect(centre.getByTestId('overview-count-draft')).toHaveText((21).toLocaleString(lang));
      await expect(centre.getByTestId(/^approval-preview-/)).toHaveCount(3);
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await expectNoHorizontalPageOverflow(page);
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        await expect(page.getByTestId('overview-open-queue')).toBeVisible();
        if (width < 1024) await expect(page.getByTestId('quick-nav-reviews')).toBeVisible();
        const result = await new AxeBuilder({ page }).include('[data-testid="admin-approvals-overview"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        expect(result.violations).toEqual([]);
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
        const name = `admin-home-${lang}-${theme}-${width}`;
        const path = testInfo.outputPath(`${name}.png`);
        await page.screenshot({ path, fullPage: true, animations: 'disabled' });
        await testInfo.attach(name, { path, contentType: 'image/png' });
        await testInfo.attach(`${name}-provenance`, { body: Buffer.from(JSON.stringify({ route: '/admin', width, lang, theme, commit: process.env.GITHUB_SHA ?? null, evidence: 'UI_STATE_FIXTURES', inspected: false })), contentType: 'application/json' });
      }
      await page.getByTestId('overview-open-queue').click();
      await expect(page).toHaveURL(/\/admin\/reviews$/);
      await expect(page.getByTestId('admin-review-directory')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('admin-review-directory')).toBeVisible();
    });
  }
}

test('a denied provider read is not shown as an empty approval queue', async ({ page }) => {
  await prepare(page, 'en', true);
  const centre = page.getByTestId('admin-approvals-overview');
  await expect(centre.getByRole('alert')).toContainText('You do not have permission');
  await expect(centre.getByTestId('overview-count-pendingReview')).toHaveText('—');
  await expect(centre.getByText('No applications awaiting review', { exact: true })).toHaveCount(0);
  await expect(centre.getByTestId(/^approval-preview-/)).toHaveCount(0);
});
