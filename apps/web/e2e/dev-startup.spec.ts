import { expect, test } from '@playwright/test';

// Only auth HTTP responses are fixtures. Vite, native ESM and the complete
// application graph are real; this is startup coverage, not API acceptance.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/auth/**', (route) => {
    const request = route.request();
    const publicPolicy =
      request.method() === 'GET' && new URL(request.url()).pathname === '/v1/auth/config';
    return route.fulfill({
      status: publicPolicy ? 200 : 401,
      contentType: 'application/json',
      body: JSON.stringify(
        publicPolicy
          ? { otpChannel: 'email', whatsappAvailable: false }
          : { message: 'Unauthorized' },
      ),
    });
  });
});

test('cold entry renders and all three application choices reach their login', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const brokenModules: string[] = [];
  const policyStatuses: number[] = [];
  const identityStatuses: number[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === '/v1/auth/config') policyStatuses.push(response.status());
    if (pathname === '/v1/auth/me') identityStatuses.push(response.status());
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
  expect(policyStatuses.length).toBeGreaterThanOrEqual(3);
  expect(policyStatuses.every((status) => status === 200)).toBe(true);
  expect(identityStatuses.length).toBeGreaterThan(0);
  expect(identityStatuses.every((status) => status === 401)).toBe(true);
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
  const credentialRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      ['/v1/auth/login', '/v1/auth/register'].includes(new URL(request.url()).pathname)
    )
      credentialRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByTestId('app-card-seeker')).toBeVisible();
  await expect(page.getByTestId('app-card-provider')).toBeVisible();
  await page.getByTestId('app-card-seeker').click();
  await expect(page.getByTestId('auth-hero-seeker')).toBeVisible();
  await expect(page.getByTestId('auth-channel-whatsapp')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText(
    'The sign-in service is temporarily unavailable. Please try again shortly.',
  );
  const phone = page.locator('input[type="tel"]');
  await phone.fill('2025550123');
  await phone.press('Enter');
  await expect(phone).toHaveValue('2025550123');
  await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Send verification code', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled();
  expect(credentialRequests).toEqual([]);
  expect(errors).toEqual([]);
});
