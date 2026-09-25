import { expect, test } from '@playwright/test';

// Only auth HTTP responses are fixtures. Vite, native ESM and the complete
// application graph are real; this is startup coverage, not API acceptance.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/auth/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: '{"message":"Unauthorized"}',
    }),
  );
});

test('cold entry renders and all three application choices reach their login', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const brokenModules: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script' && response.status() >= 400) {
      brokenModules.push(`${response.status()} ${response.url()}`);
    }
  });
  const started = Date.now();
  await page.goto('/');
  await expect(page.getByTestId('app-card-seeker')).toBeVisible();
  await expect(page.getByTestId('app-card-provider')).toBeVisible();
  await expect(page.getByTestId('app-card-admin')).toBeVisible();
  await testInfo.attach('entry-timing', {
    body: JSON.stringify({ coldEntryMs: Date.now() - started }),
    contentType: 'application/json',
  });
  await testInfo.attach('entry', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  for (const app of ['seeker', 'provider', 'admin']) {
    await page.goto('/select');
    await page.getByTestId(`app-card-${app}`).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByTestId(`auth-hero-${app}`)).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  }
  expect(errors).toEqual([]);
  expect(brokenModules).toEqual([]);
});

test('module failure shows recovery and Retry loads the application', async ({ page }) => {
  await page.route('**/src/bootstrap.tsx*', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('The application could not start');
  await expect(page.getByRole('alert')).toContainText('تعذّر بدء التطبيق');
  await expect(page.locator('#startup-loading')).toBeHidden();
  await page.unroute('**/src/bootstrap.tsx*');
  await page.getByRole('button', { name: 'إعادة المحاولة / Retry' }).click();
  await expect(page.getByTestId('app-card-seeker')).toBeVisible();
  await expect(page.locator('#startup-error')).toHaveCount(0);
});

test('the public selector renders when the API is unavailable', async ({ page }) => {
  await page.route('**/v1/auth/**', (route) => route.abort());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('app-card-seeker')).toBeVisible();
  await expect(page.getByTestId('app-card-provider')).toBeVisible();
  expect(errors).toEqual([]);
});
