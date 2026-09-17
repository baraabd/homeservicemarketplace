import AxeBuilder from '@axe-core/playwright';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { ProviderOnboardingDraftView } from '@homeservicemarketplace/contracts';

import { expectNoHorizontalPageOverflow } from './fixtures';
import { api, loginViaUi, REAL_API, type Account } from './real-api';

export const DRAFT_PATH = '/v1/me/provider/onboarding/draft';
export const ALEPPO = { latitude: 36.2021, longitude: 37.1343 };

/** Genuine cookies issued by registration, OTP, upgrade and refresh. */
export async function useProviderSession(context: BrowserContext, account: Account) {
  await context.addCookies(
    [...account.jar].map(([name, value]) => ({
      name,
      value,
      domain: new URL(REAL_API).hostname,
      path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
    })),
  );
}

export async function draftOf(account: Account) {
  const draft = await api<ProviderOnboardingDraftView>(account.jar, DRAFT_PATH);
  expect(draft.status).toBe(200);
  return draft.body;
}

export async function writeStep(account: Account, step: string, values: Record<string, unknown>) {
  const current = await draftOf(account);
  const saved = await api<ProviderOnboardingDraftView>(
    account.jar,
    `/v1/me/provider/onboarding/steps/${step}`,
    { method: 'PATCH', body: { version: current.version, ...values } },
  );
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  return saved.body;
}

export async function signOutAndBackIn(page: Page, account: Account, destination: string) {
  const csrf = (await page.context().cookies()).find((cookie) => cookie.name === 'hsm_csrf');
  expect(csrf).toBeTruthy();
  const logout = await page.request.post(`${REAL_API}/v1/auth/logout`, {
    headers: { 'X-CSRF-Token': csrf!.value },
  });
  expect(logout.status()).toBe(204);
  await page.goto(destination);
  await expect(page).toHaveURL(/\/login/);
  await loginViaUi(page, account);
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  // The independent read client follows the newly issued session, rather
  // than attempting to reuse a token the real logout just invalidated.
  account.jar.clear();
  for (const cookie of await page.context().cookies()) account.jar.set(cookie.name, cookie.value);
}

/** Normal SPA navigation preserves the product's in-memory theme preference.
 * No React state, CSS, API response or permission is replaced. */
export async function navigateWithinApp(page: Page, path: string) {
  await page.evaluate((destination) => {
    window.history.pushState(null, '', destination);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

/** The existing Settings control owns theme; onboarding has no theme toggle. */
export async function chooseDarkTheme(page: Page, lang: 'en' | 'ar') {
  await page.goto('/home/profile');
  // The profile menu entry has an icon; the location-permission notice has
  // another Settings button without one. Select the menu, not an arbitrary
  // first match, and keep strict uniqueness as an acceptance requirement.
  const settings = page
    .getByRole('button', { name: lang === 'ar' ? 'الإعدادات' : 'Settings', exact: true })
    .filter({ has: page.locator('svg') });
  await expect(settings).toHaveCount(1);
  await settings.click();
  const label = page.getByText(lang === 'ar' ? 'الوضع الليلي' : 'Dark Mode', { exact: true });
  await expect(label).toBeVisible();
  // This older settings button has no accessible name. Locate its actual
  // labeled row; do not modify the out-of-scope Settings UI for this test.
  await label.locator('..').locator('..').getByRole('button').click();
}

export async function recordRepairEvidence(
  page: Page,
  testInfo: TestInfo,
  name: string,
  account: Account,
  details: { lang: 'en' | 'ar'; theme: 'light' | 'dark'; zoom?: number },
) {
  const shell = page.getByTestId('onboarding-v2-shell');
  await expect(shell).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', details.lang);
  await expect(page.locator('html')).toHaveAttribute('dir', details.lang === 'ar' ? 'rtl' : 'ltr');
  await expect(shell).toHaveAttribute('dir', details.lang === 'ar' ? 'rtl' : 'ltr');
  const dark = await shell.evaluate((element) => Boolean(element.closest('.dark')));
  expect(dark).toBe(details.theme === 'dark');
  await expectNoHorizontalPageOverflow(page);
  await page.evaluate(() => document.fonts.ready);
  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="onboarding-v2-shell"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  await testInfo.attach(`${name}-accessibility.json`, {
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(accessibility.violations)),
  });
  expect(accessibility.violations, `${name}: accessibility violations`).toEqual([]);
  const viewport = page.viewportSize()!;
  const box = await shell.boundingBox();
  expect(box).not.toBeNull();
  // CSS zoom 2 uses half the layout viewport for the reflow check below.
  const expectedMaximum = details.zoom === 2 ? 960 : 480;
  expect(box!.width).toBeLessThanOrEqual(Math.min(viewport.width, expectedMaximum) + 1);
  const mapScreen = new URL(page.url()).pathname.endsWith('/WORK_AREA');
  const controls = mapScreen
    ? shell.locator('.pv-service-area-map button, [data-testid="service-area-locate"]')
    : shell.locator('[data-testid="day-toggles"] button, [data-testid="apply-to-selected"]');
  await expect(controls.first()).toBeVisible();
  const controlGeometry = await controls.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        label: element.getAttribute('aria-label') ?? element.textContent?.trim(),
        width: rect.width,
        height: rect.height,
      };
    }),
  );
  for (const control of controlGeometry) {
    expect(control.width, `${name}: ${control.label} touch width`).toBeGreaterThanOrEqual(
      44 * (details.zoom ?? 1) - 1,
    );
    expect(control.height, `${name}: ${control.label} touch height`).toBeGreaterThanOrEqual(
      44 * (details.zoom ?? 1) - 1,
    );
  }
  const inputs = mapScreen ? page.getByTestId('service-area-city') : page.getByTestId('bulk-start');
  const inputFontSize = await inputs.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  expect(inputFontSize, `${name}: editable text size`).toBeGreaterThanOrEqual(16);
  const draft = await draftOf(account);
  const observed = mapScreen
    ? {
        city: await page.getByTestId('service-area-city').inputValue(),
        point: await page.getByTestId('service-area-point').innerText(),
      }
    : { rows: await page.locator('[data-testid^="availability-summary-day-"]').allTextContents() };
  if (mapScreen) expect(observed.city).toBe(draft.data.serviceAreaCity);
  else expect(observed.rows).toHaveLength(7);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await testInfo.attach(`${name}-runtime.json`, {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        route: new URL(page.url()).pathname,
        viewport,
        language: details.lang,
        direction: details.lang === 'ar' ? 'rtl' : 'ltr',
        theme: details.theme,
        zoom: details.zoom ?? 1,
        zoomMethod:
          details.zoom === 2 ? 'CSS content zoom 200%; not browser chrome zoom' : 'normal scale',
        commit: process.env.GITHUB_SHA ?? null,
        apiOrigin: REAL_API,
        providerProfileId: account.profileId,
        draftVersion: draft.version,
        observed,
        controlGeometry,
        inputFontSize,
        persisted: mapScreen
          ? {
              city: draft.data.serviceAreaCity,
              countryCode: draft.data.serviceAreaCountryCode,
              latitude: draft.data.serviceAreaLat,
              longitude: draft.data.serviceAreaLng,
              radiusKm: draft.data.serviceAreaRadiusKm,
            }
          : { timezone: draft.data.timezone, availability: draft.data.availability },
        transport: 'real application HTTP and persisted database; no application API interception',
        geolocation: 'browser permission and device emulation only in GPS test',
        externalMaps: 'live OpenStreetMap tiles; no tile interception',
        themeSetup:
          details.theme === 'dark'
            ? 'existing Settings toggle, then SPA navigation'
            : 'default product theme',
        flag: 'V2 enabled by CI build; no localStorage override',
        enforcement: {
          verification: process.env.VERIFICATION_ENFORCED === 'true',
          workAccess: process.env.WORK_ACCESS_ENFORCED === 'true',
        },
      }),
    ),
  });
}
