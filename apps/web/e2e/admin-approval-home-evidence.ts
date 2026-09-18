import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ListAdminProvidersResponse } from '@homeservicemarketplace/contracts';
import { expectNoHorizontalPageOverflow } from './fixtures';

let capture = 0;

/** Called after normal Admin login in the existing un-stubbed HTTP acceptance suite. */
export async function verifyApprovalHome(page: Page) {
  const center = page.getByTestId('admin-approval-center');
  await expect(center).toBeVisible();
  const refresh = page.getByTestId('approval-refresh');
  await expect(refresh).toBeEnabled();
  // Observe the exact response consumed by the screen, not a racing aggregate read.
  const pending = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/v1/admin/providers'
      && url.searchParams.get('limit') === '3'
      && response.request().method() === 'GET';
  });
  await refresh.click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const body = await response.json() as ListAdminProvidersResponse;
  expect(body.counts).toBeDefined();
  await expect(page.getByTestId('approval-count-pendingReview'))
    .toHaveText(body.counts!.pendingReview.toLocaleString('en'));
  await expect(center.locator('.ac-request')).toHaveCount(body.items.length);
  await expect(refresh).toBeEnabled();
  await expect(center.getByTestId('review-approve')).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="admin-approval-center"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const info = test.info();
  const name = `approval-home-real-api-${++capture}`;
  const path = info.outputPath(`${name}.png`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
  await info.attach(`${name}-source.json`, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify({
      route: '/admin', responseStatus: response.status(), counts: body.counts,
      transport: 'real HTTP; no route interception', commit: process.env.GITHUB_SHA ?? null,
      viewport: page.viewportSize(),
    })),
  });
}
