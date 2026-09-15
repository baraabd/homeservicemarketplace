import { expect, test, type Page } from '@playwright/test';
import type { ProviderOnboardingHubView } from '@homeservicemarketplace/contracts';

import { seedLanguage } from './fixtures';
import {
  addPortfolioPhoto,
  api,
  completeDraft,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';
import {
  ALEPPO,
  chooseDarkTheme,
  draftOf,
  navigateWithinApp,
  recordRepairEvidence,
  signOutAndBackIn,
  useProviderSession,
  writeStep,
} from './provider-onboarding-repairs-real-api';

// Application endpoints are never intercepted. Only the independent external
// geocoder is emulated where its response is the specific condition under test.
// Real OTP, refresh, guards, optimistic writes and Postgres reads are mandatory.
test.describe.configure({ timeout: 180_000 });
test.use({ hasTouch: true });

// These edits share one genuine session and one logout/login below. This both
// proves the same UI-entered values survive together and respects the real
// login limiter instead of widening it for redundant fixture authentication.
async function applyCustomWorkingHours(page: Page, account: Account) {
  await writeStep(account, 'AVAILABILITY', { timezone: 'Asia/Damascus' });
  await page.goto('/provider/onboarding/WORKING_HOURS');
  await page.getByTestId('day-toggle-0').click();
  await page.getByTestId('day-toggle-2').click();
  await page.getByTestId('bulk-start').fill('10:30');
  await page.getByTestId('bulk-end').fill('18:45');
  const acknowledged = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/me/provider/onboarding/steps/AVAILABILITY` &&
      response.request().method() === 'PATCH',
  );
  await page.getByTestId('apply-to-selected').click();
  expect((await acknowledged).status()).toBe(200);
  await expect(page.getByTestId('availability-apply-feedback')).toHaveAttribute(
    'data-state',
    'saved',
  );
  await expect(page.getByTestId('availability-apply-feedback')).toContainText(
    'Working hours applied and saved.',
  );
  const expected = [
    { dayOfWeek: 0, startMinute: 630, endMinute: 1125 },
    { dayOfWeek: 2, startMinute: 630, endMinute: 1125 },
  ];
  expect((await draftOf(account)).data.availability).toMatchObject(expected);
  await expect(page.getByTestId('availability-summary-day-0')).toContainText('10:30–18:45');
  await expect(page.getByTestId('availability-summary-day-2')).toContainText('10:30–18:45');
  await expect(page.getByTestId('availability-summary-day-1')).toContainText('Unavailable');
  await page.getByTestId('task-back-to-tasks').click();
  await expect(page.getByTestId('task-row-WORKING_HOURS')).toHaveAttribute(
    'data-status',
    'COMPLETE',
  );
  await page.goto('/provider/onboarding/WORKING_HOURS');
  await page.reload();
  await expect(page.getByTestId('bulk-start')).toHaveValue('10:30');
  await expect(page.getByTestId('bulk-end')).toHaveValue('18:45');
  await expect(page.getByTestId('availability-summary-day-2')).toContainText('10:30–18:45');
  expect((await draftOf(account)).data.availability).toMatchObject(expected);
}

test('GPS, interactive red pin, applied hours and a short generated title survive a fresh login', async ({
  page,
  context,
}, testInfo) => {
  const account = await registerProvider();
  await completeDraft(account, { skip: ['LOCATION', 'AVAILABILITY', 'SPECIALTIES', 'PROFILE'] });
  // Reproduce V2's canonical country-code path, without the legacy display
  // country field that used to accidentally make the fixture complete.
  await writeStep(account, 'LOCATION', {
    serviceAreaCountryCode: 'SY',
    serviceAreaRadiusKm: 25,
  });
  await useProviderSession(context, account);
  await seedLanguage(page, 'en');
  await context.setGeolocation(ALEPPO);
  await context.grantPermissions(['geolocation']);
  let vendorCalls = 0;
  await page.route('https://nominatim.openstreetmap.org/reverse?*', async (route) => {
    vendorCalls += 1;
    const url = new URL(route.request().url());
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(ALEPPO.latitude, 5);
    expect(Number(url.searchParams.get('lon'))).toBeCloseTo(ALEPPO.longitude, 5);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        display_name: 'Aleppo, Syria',
        address: { city: 'Aleppo', country: 'Syria', country_code: 'sy' },
      }),
    });
  });
  await page.goto('/provider/onboarding/WORK_AREA');
  const map = page.getByTestId('service-area-map');
  await expect(map.locator('.leaflet-container')).toBeVisible();
  expect((await draftOf(account)).data.serviceAreaLat).toBeNull();
  expect(vendorCalls, 'location is requested by the provider, not on mount').toBe(0);

  await page.getByTestId('service-area-locate').click();
  await expect(page.getByTestId('service-area-city')).toHaveValue('Aleppo');
  await expect
    .poll(async () => {
      const { data } = await draftOf(account);
      return [data.serviceAreaLat, data.serviceAreaLng, data.serviceAreaCity];
    })
    .toEqual([ALEPPO.latitude, ALEPPO.longitude, 'Aleppo']);
  expect(vendorCalls).toBe(1);
  const hub = await api<ProviderOnboardingHubView>(account.jar, '/v1/me/provider/onboarding/hub');
  expect(hub.body.tasks.find((task) => task.id === 'WORK_AREA')?.status).toBe('COMPLETE');
  await expect(map.locator('.pv-service-area-pin')).toBeVisible();

  // A selected map point, rather than a decorative circle, writes both
  // coordinates. Selecting a point does not silently overwrite the city.
  const surface = map.locator('.leaflet-container');
  const mapBox = await surface.boundingBox();
  expect(mapBox).not.toBeNull();
  await page.touchscreen.tap(mapBox!.x + 90, mapBox!.y + 90);
  await expect
    .poll(async () => (await draftOf(account)).data.serviceAreaLat)
    .not.toBe(ALEPPO.latitude);
  const tapped = (await draftOf(account)).data;
  expect(tapped.serviceAreaCity).toBe('Aleppo');
  const pin = map.locator('.pv-service-area-pin');
  const pinBox = await pin.boundingBox();
  expect(pinBox).not.toBeNull();
  await page.mouse.move(pinBox!.x + pinBox!.width / 2, pinBox!.y + pinBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(pinBox!.x + 65, pinBox!.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => (await draftOf(account)).data.serviceAreaLat)
    .not.toBe(tapped.serviceAreaLat);
  const dragged = (await draftOf(account)).data;
  // Chromium sends real multi-touch events to Leaflet. A static picture, a
  // disabled touchZoom handler, or a non-interactive overlay cannot pass.
  const session = await context.newCDPSession(page);
  const centreX = mapBox!.x + mapBox!.width / 2;
  const centreY = mapBox!.y + mapBox!.height / 2;
  const mapPane = surface.locator('.leaflet-map-pane');
  const beforePan = await mapPane.getAttribute('style');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: centreX - 70, y: centreY + 30, id: 1 }],
  });
  for (const distance of [15, 30, 45, 60]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: centreX - 70 - distance, y: centreY + 30, id: 1 }],
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => mapPane.getAttribute('style')).not.toBe(beforePan);
  const tileZoom = () =>
    surface
      .locator('img.leaflet-tile')
      .evaluateAll((tiles) =>
        Math.max(
          ...tiles.map((tile) =>
            Number(new URL((tile as HTMLImageElement).src).pathname.split('/')[1]),
          ),
        ),
      );
  await map.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(tileZoom).toBe(14);
  const beforePinch = await tileZoom();
  const fingers = (spread: number) => [
    { x: centreX - spread, y: centreY, id: 1 },
    { x: centreX + spread, y: centreY, id: 2 },
  ];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(20) });
  for (const spread of [30, 40, 55, 70, 90]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: fingers(spread),
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(tileZoom).toBeGreaterThan(beforePinch);
  await session.detach();
  await page.reload();
  await expect(page.getByTestId('service-area-city')).toHaveValue('Aleppo');
  await expect(page.getByTestId('service-area-point')).toBeVisible();
  expect((await draftOf(account)).data).toMatchObject({
    serviceAreaLat: dragged.serviceAreaLat,
    serviceAreaLng: dragged.serviceAreaLng,
  });
  await applyCustomWorkingHours(page, account);
  const bio =
    'I provide careful home repairs, explain the work clearly, arrive on time and leave the customer with a clean finished result.';
  await enterServiceAndBio(page, account, 'plumbing', 'Plumber', bio);
  await signOutAndBackIn(page, account, '/provider/onboarding/WORK_AREA');
  await expect(page.getByTestId('service-area-city')).toHaveValue('Aleppo');
  expect((await draftOf(account)).data).toMatchObject({
    serviceAreaLat: dragged.serviceAreaLat,
    serviceAreaLng: dragged.serviceAreaLng,
    serviceAreaCountryCode: 'SY',
    serviceAreaCountry: null,
  });
  await page.goto('/provider/onboarding/WORKING_HOURS');
  await expect(page.getByTestId('bulk-start')).toHaveValue('10:30');
  await expect(page.getByTestId('bulk-end')).toHaveValue('18:45');
  await expect(page.getByTestId('availability-summary-day-2')).toContainText('10:30–18:45');
  await page.goto('/provider/onboarding/PORTFOLIO');
  await expect(page.getByTestId('bio-input')).toHaveValue(bio);
  expect((await draftOf(account)).data.headline).toBe('Plumber');
  await testInfo.attach('gps-vendor-scope.json', {
    contentType: 'application/json',
    body: Buffer.from(
      JSON.stringify({
        interceptedOrigin: 'https://nominatim.openstreetmap.org',
        purpose: 'deterministic city lookup; no application API or tile interception',
        calls: vendorCalls,
        coordinatesPersistedThrough: '/v1/me/provider/onboarding/steps/LOCATION',
      }),
    ),
  });
});

test('denied location permission leaves manual city and touch map selection usable', async ({
  page,
  context,
}) => {
  const account = await registerProvider();
  await writeStep(account, 'LOCATION', { serviceAreaCountryCode: 'SY', serviceAreaRadiusKm: 25 });
  await useProviderSession(context, account);
  await seedLanguage(page, 'en');
  // A browser permission denial, not a replacement of navigator.geolocation.
  await context.grantPermissions([]);
  await page.goto('/provider/onboarding/WORK_AREA');
  await page.getByTestId('service-area-locate').click();
  await expect(page.getByTestId('service-area-location-feedback')).toContainText(
    /permission|allow|denied/i,
  );
  await page.getByTestId('service-area-city').fill('Aleppo');
  await page.getByTestId('service-area-city').blur();
  await expect.poll(async () => (await draftOf(account)).data.serviceAreaCity).toBe('Aleppo');
  expect((await draftOf(account)).data.serviceAreaLat).toBeNull();
  const map = page.getByTestId('service-area-map').locator('.leaflet-container');
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect.poll(async () => (await draftOf(account)).data.serviceAreaLat).not.toBeNull();
  await expect(page.getByTestId('service-area-point')).toBeVisible();
  const selected = (await draftOf(account)).data;
  expect(selected.serviceAreaLng).not.toBeNull();
  await page.reload();
  await expect(page.getByTestId('service-area-city')).toHaveValue('Aleppo');
  expect((await draftOf(account)).data).toMatchObject({
    serviceAreaLat: selected.serviceAreaLat,
    serviceAreaLng: selected.serviceAreaLng,
  });
});

async function enterServiceAndBio(
  page: Page,
  account: Account,
  slug: 'plumbing' | 'painting',
  expectedTitle: 'Plumber' | 'Painter',
  bio: string,
) {
  const catalog = await api<{ items: Array<{ id: string; slug: string; isLeaf: boolean }> }>(
    account.jar,
    '/v1/services',
  );
  const trade = catalog.body.items.find((item) => item.slug === slug && item.isLeaf);
  expect(trade, 'seeded trade must be selectable; do not substitute a longer title').toBeTruthy();
  await page.goto('/provider/onboarding/SERVICES_EXPERIENCE');
  await page.getByTestId(`specialty-choice-${trade!.id}`).click();
  await expect.poll(async () => (await draftOf(account)).data.headline).toBe(expectedTitle);
  await page.getByTestId('task-back-to-tasks').click();
  await page.goto('/provider/onboarding/PORTFOLIO');
  await page.getByTestId('bio-input').fill(bio);
  await page.getByTestId('bio-input').blur();
  await expect.poll(async () => (await draftOf(account)).data.bio).toBe(bio);
  await page.goto('/provider/onboarding');
  await expect(page.getByTestId('task-row-PORTFOLIO')).toHaveAttribute('data-status', 'COMPLETE');
  const readyWithoutPhotos = await draftOf(account);
  expect(
    readyWithoutPhotos.missing.filter((issue) => ['headline', 'bio'].includes(issue.field)),
  ).toEqual([]);
  // A genuinely uploaded optional photo awaiting moderation must not turn
  // the provider's completed input back into a required task.
  await addPortfolioPhoto(account.jar, 'My completed repair');
  await page.reload();
  await expect(page.getByTestId('task-row-PORTFOLIO')).toHaveAttribute('data-status', 'COMPLETE');
  await page.goto('/provider/onboarding/PORTFOLIO');
  await expect(page.getByTestId('bio-input')).toHaveValue(bio);
  expect((await draftOf(account)).data.headline).toBe(expectedTitle);
}

test('Arabic: a selected service generates a short valid title and pending photos preserve completion', async ({
  page,
  context,
}) => {
  const account = await registerProvider();
  await completeDraft(account, { skip: ['SPECIALTIES', 'PROFILE'] });
  await useProviderSession(context, account);
  await seedLanguage(page, 'ar');
  await enterServiceAndBio(
    page,
    account,
    'painting',
    'Painter',
    'أعمل بعناية في تقديم الخدمات المنزلية وأشرح خطوات العمل بوضوح وأحافظ على نظافة المكان وجودة تنفيذ الأعمال المتفق عليها.',
  );
});

test('an incomplete provider stays in onboarding after fresh login, token refresh and every workspace deep link', async ({
  page,
  context,
}) => {
  const account = await registerProvider();
  await completeDraft(account, { skip: ['LOCATION', 'PROFILE'] });
  await seedLanguage(page, 'en');
  await page.goto('/provider/jobs');
  await expect(page).toHaveURL(/\/login/);
  await loginViaUi(page, account);
  await expect(page).toHaveURL(/\/provider\/onboarding$/);
  await expect(page.getByTestId('task-row-WORK_AREA')).toHaveAttribute('data-status', 'AVAILABLE');
  await expect(page.getByTestId('task-row-PORTFOLIO')).toHaveAttribute('data-status', 'AVAILABLE');
  for (const path of [
    '/provider',
    '/provider/jobs',
    '/provider/bids',
    '/provider/profile',
    '/provider/status',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/provider\/onboarding$/);
    await expect(page.getByTestId('hub-task-list')).toBeVisible();
    await expect(page.getByTestId('provider-bids-list')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Opportunities', exact: true })).toHaveCount(0);
  }
  for (const endpoint of ['/v1/provider/bids', '/v1/provider/available-requests']) {
    expect((await page.request.get(`${REAL_API}${endpoint}`)).status()).toBe(403);
  }
  // Expire the access credential without discarding its valid refresh cookie.
  // This uses Chromium's cookie store; no forged token or fake 401 response.
  await context.clearCookies({ name: 'hsm_at' });
  const refreshed = page.waitForResponse(
    (response) =>
      response.url() === `${REAL_API}/v1/auth/refresh` && response.request().method() === 'POST',
  );
  await page.reload();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByTestId('hub-task-list')).toBeVisible();
  await page.goto('/provider/onboarding/PORTFOLIO');
  await expect(page.getByTestId('bio-input')).toBeEditable();
  await expect(page).not.toHaveURL(/\/login/);
  expect((await page.request.get(`${REAL_API}/v1/provider/available-requests`)).status()).toBe(403);
});

for (const lang of ['en', 'ar'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`actual persisted map and weekly schedule — ${lang} ${theme}`, async ({
      page,
      context,
    }, testInfo) => {
      test.setTimeout(300_000);
      const account = await registerProvider();
      await completeDraft(account);
      await writeStep(account, 'LOCATION', {
        serviceAreaCity: lang === 'ar' ? 'حلب' : 'Aleppo',
        serviceAreaCountryCode: 'SY',
        serviceAreaLat: ALEPPO.latitude,
        serviceAreaLng: ALEPPO.longitude,
      });
      await writeStep(account, 'AVAILABILITY', {
        timezone: 'Asia/Damascus',
        availability: [
          { dayOfWeek: 0, startMinute: 540, endMinute: 780 },
          { dayOfWeek: 0, startMinute: 900, endMinute: 1080 },
          { dayOfWeek: 1, startMinute: 630, endMinute: 1125 },
          { dayOfWeek: 4, startMinute: 540, endMinute: 1020 },
        ],
      });
      await useProviderSession(context, account);
      await seedLanguage(page, lang);
      if (theme === 'dark') await chooseDarkTheme(page, lang);
      else await page.goto('/provider/onboarding');
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: width < 640 ? 844 : 1024 });
        await navigateWithinApp(page, '/provider/onboarding/WORK_AREA');
        await expect(
          page.getByTestId('service-area-map').locator('.leaflet-container'),
        ).toBeVisible();
        await expect
          .poll(() => page.getByTestId('service-area-map').locator('.leaflet-tile-loaded').count())
          .toBeGreaterThan(0);
        await recordRepairEvidence(page, testInfo, `map-${lang}-${theme}-${width}`, account, {
          lang,
          theme,
        });
        await navigateWithinApp(page, '/provider/onboarding/WORKING_HOURS');
        await expect(page.getByTestId('availability-summary-day-0')).toContainText('09:00–13:00');
        await expect(page.getByTestId('availability-summary-day-0')).toContainText('15:00–18:00');
        // Capture at the bottom too: a fixed-height shell's fullPage PNG does
        // not expand its internal scroller. This makes the new table visible.
        await page.getByTestId('availability-week-summary').scrollIntoViewIfNeeded();
        await recordRepairEvidence(page, testInfo, `hours-${lang}-${theme}-${width}`, account, {
          lang,
          theme,
        });
      }
      // 200% text/content zoom supplements the width matrix; it is labeled as
      // CSS zoom in provenance, not claimed to emulate browser chrome zoom.
      if (theme === 'light') {
        await page.setViewportSize({ width: 1440, height: 1200 });
        await page.evaluate(() => {
          document.documentElement.style.zoom = '2';
        });
        for (const [task, name] of [
          ['WORK_AREA', 'map'],
          ['WORKING_HOURS', 'hours'],
        ] as const) {
          await navigateWithinApp(page, `/provider/onboarding/${task}`);
          await page
            .getByTestId(name === 'map' ? 'service-area-map' : 'availability-week-summary')
            .scrollIntoViewIfNeeded();
          await recordRepairEvidence(page, testInfo, `${name}-${lang}-${theme}-zoom200`, account, {
            lang,
            theme,
            zoom: 2,
          });
        }
      }
    });
  }
}
