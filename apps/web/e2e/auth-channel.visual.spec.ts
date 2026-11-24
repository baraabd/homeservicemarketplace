import { expect, test, type Page } from '@playwright/test';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';

// Real Chromium layout and interaction; the API is an explicit presentation fixture.
// This suite does not establish database persistence, WhatsApp delivery or service acceptance.
const WIDTHS = [320, 390, 430, 768, 1024, 1440];
const APPS = ['seeker', 'provider', 'admin'] as const;
const LANGUAGES = ['en', 'ar'] as const;
const CHANNELS = ['email', 'whatsapp'] as const;

async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  for (const field of await page
    .locator('input:not([type="hidden"]):not(.sr-only), select')
    .all()) {
    const box = await field.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(40);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

async function assertPhoneControls(page: Page, country: string) {
  await expect(page.getByRole('button', { name: /Use my location|استخدم موقعي/ })).toHaveCount(0);
  await expect(page.getByText(/OpenStreetMap/)).toHaveCount(0);
  await expect(page.getByTestId('dial-code-select')).toHaveValue(country);
  const flag = page.getByTestId('selected-country-flag');
  await expect(flag).toHaveAttribute('data-country', country);
  await expect(flag.locator('img')).toBeVisible();
  await expect
    .poll(() =>
      flag
        .locator('img')
        .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  for (const control of await page
    .locator('[data-testid="dial-code-select"], input[type="tel"]')
    .all()) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      await control.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
}

for (const channel of CHANNELS)
  for (const app of APPS)
    for (const lang of LANGUAGES) {
      test(`${channel} / ${app} / ${lang}: responsive identity, consent and OTP presentation`, async ({
        page,
      }, info) => {
        await page.addInitScript(
          ({ app, lang }) => {
            localStorage.setItem('hsm.lang', lang);
            sessionStorage.setItem('fixnow_intended_app', app);
            sessionStorage.removeItem('hsm.signup.draft.v1');
          },
          { app, lang },
        );
        const failures: string[] = [];
        page.on('pageerror', (error) => failures.push(error.message));
        await page.route('**/v1/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          const response = (status: number, body: unknown) =>
            route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (pathname === '/v1/auth/config')
            return response(200, { otpChannel: channel, whatsappAvailable: true });
          if (pathname === '/v1/auth/me' || pathname === '/v1/auth/refresh')
            return response(401, { error: { code: 'UNAUTHORIZED' } });
          if (pathname === '/v1/legal/documents')
            return response(200, {
              acceptanceOpen: true,
              documents: Object.values(CURRENT_LEGAL_DOCUMENTS),
            });
          if (pathname === '/v1/auth/register' || pathname === '/v1/auth/login')
            return response(202, {
              otpRequired: true,
              challengeId: 'visual-fixture-challenge',
              codeLength: 6,
              expiresInSeconds: 300,
              channel,
              maskedDestination: channel === 'whatsapp' ? '+966 •••• 4567' : 'v•••@example.test',
            });
          if (pathname === '/v1/auth/resend-otp') return response(202, { success: true });
          return response(404, { error: { code: 'NOT_FOUND' } });
        });
        await page.goto('/login');
        await expect(page.getByTestId(`auth-hero-${app}`)).toBeVisible();
        await expect(page.getByTestId(`auth-channel-${channel}`)).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
        if (channel === 'whatsapp') await assertPhoneControls(page, 'US');
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 844 });
          await assertNoOverflow(page);
        }
        // CSS 200% zoom exercises layout reflow; it is recorded separately from browser chrome zoom.
        await page.setViewportSize({ width: 768, height: 844 });
        await page.locator('html').evaluate((el) => {
          el.style.zoom = '2';
        });
        await assertNoOverflow(page);
        await page.locator('html').evaluate((el) => {
          el.style.zoom = '';
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.keyboard.press('Tab');
        expect(
          await page.evaluate(
            () =>
              document.activeElement instanceof HTMLElement &&
              document.activeElement !== document.body,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath(`login-${channel}-${app}-${lang}-390.png`),
          fullPage: true,
        });

        await page
          .getByRole('button', { name: lang === 'ar' ? 'إنشاء حساب' : 'Sign Up', exact: true })
          .click();
        await expect(page.getByTestId(`auth-channel-${channel}`)).toBeVisible();
        await page
          .getByLabel(lang === 'ar' ? 'الاسم الكامل' : 'Full Name', { exact: true })
          .fill(lang === 'ar' ? 'نورة أحمد' : 'Noura Ahmad');
        if (channel === 'whatsapp') {
          const country = page.getByTestId('dial-code-select');
          const phone = page.getByLabel(
            lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
            { exact: true },
          );
          // Device locale is pinned to en-US independently of the UI language.
          await expect(country).toHaveValue('US');
          await expect(country.locator('option:checked')).toContainText('+1');
          await assertPhoneControls(page, 'US');
          await country.selectOption('SA');
          await phone.fill('+963944123456');
          await expect(country).toHaveValue('SY');
          await assertPhoneControls(page, 'SY');
          await expect(country).toBeDisabled();
          await expect(phone).toHaveValue('+963944123456');
          await page.setViewportSize({ width: 320, height: 844 });
          await assertNoOverflow(page);
          // Restore the Saudi fixture before the registration/OTP presentation flow.
          await phone.fill('');
          await expect(country).toBeEnabled();
          await country.selectOption('SA');
          await phone.fill('0501234567');
          await assertPhoneControls(page, 'SA');
        }
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 844 });
          await assertNoOverflow(page);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: info.outputPath(`signup-${channel}-${app}-${lang}-390.png`),
          fullPage: true,
        });
        await page
          .getByRole('button', { name: lang === 'ar' ? 'التالي' : 'Next', exact: true })
          .click();
        if (channel === 'email')
          await page.locator('input[type="email"]').fill('visual@example.test');
        else await expect(page.locator('input[type="email"]')).toHaveCount(0);
        await page.locator('input[type="password"]').fill('Presentation-fixture-27');
        await page.getByRole('checkbox').check();
        await page
          .getByRole('button', {
            name: lang === 'ar' ? 'إنشاء الحساب' : 'Create Account',
            exact: true,
          })
          .click();
        await expect(page.getByTestId('otp-input')).toBeAttached();
        await expect(
          page.getByText(
            channel === 'whatsapp'
              ? lang === 'ar'
                ? 'تحقق من واتساب'
                : 'Check WhatsApp'
              : lang === 'ar'
                ? 'تحقق من بريدك الإلكتروني'
                : 'Verify your email',
            { exact: true },
          ),
        ).toBeVisible();
        await assertNoOverflow(page);
        await page.getByTestId('otp-box-0').click();
        await expect(page.getByTestId('otp-input')).toBeFocused();
        await page.keyboard.type('123456');
        await expect(page.getByTestId('otp-box-5')).toHaveText('6');
        await page.screenshot({
          path: info.outputPath(`otp-${channel}-${app}-${lang}-390.png`),
          fullPage: true,
        });
        expect(failures).toEqual([]);
      });
    }

test.describe('automatic country without coordinate lookup', () => {
  test.use({ locale: 'en-US', timezoneId: 'Europe/Stockholm' });

  for (const lang of LANGUAGES) {
    test(`${lang}: Stockholm timezone suggests Sweden and manual selection preserves digits`, async ({
      page,
    }, info) => {
      const geocoderRequests: string[] = [];
      const failures: string[] = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.route('**://nominatim.openstreetmap.org/**', async (route) => {
        geocoderRequests.push(route.request().url());
        await route.abort();
      });
      await page.addInitScript((language) => {
        localStorage.setItem('hsm.lang', language);
        sessionStorage.setItem('fixnow_intended_app', 'admin');
        const location = { requests: 0 };
        Object.defineProperty(window, '__authGeolocationCalls', {
          get: () => location.requests,
        });
        Object.defineProperty(navigator.geolocation, 'getCurrentPosition', {
          value: () => {
            location.requests += 1;
          },
        });
      }, lang);
      await page.route('**/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        await route.fulfill({
          status: path === '/v1/auth/config' ? 200 : 401,
          contentType: 'application/json',
          body: JSON.stringify(
            path === '/v1/auth/config'
              ? { otpChannel: 'whatsapp', whatsappAvailable: true }
              : { error: { code: 'UNAUTHORIZED' } },
          ),
        });
      });
      await page.goto('/login');
      await expect(page.getByTestId('auth-hero-admin')).toBeVisible();
      await assertPhoneControls(page, 'SE');
      const country = page.getByTestId('dial-code-select');
      const phone = page.getByLabel(
        lang === 'ar' ? 'رقم الهاتف المسجل في واتساب' : 'WhatsApp phone number',
        { exact: true },
      );
      await expect(country.locator('option:checked')).toContainText('+46');
      await phone.fill('0701234567');
      await country.selectOption('SA');
      await expect(phone).toHaveValue('0701234567');
      await assertPhoneControls(page, 'SA');
      await phone.fill('');
      await country.selectOption('SE');
      await assertPhoneControls(page, 'SE');
      await page.setViewportSize({ width: 390, height: 844 });
      await assertNoOverflow(page);
      await page.screenshot({
        path: info.outputPath(`login-auto-country-admin-${lang}-390.png`),
        fullPage: true,
      });
      expect(await page.evaluate(() => Reflect.get(window, '__authGeolocationCalls'))).toBe(0);
      expect(geocoderRequests).toEqual([]);
      expect(failures).toEqual([]);
    });
  }
});
