import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';

import { seedLanguage } from './fixtures';
import {
  api,
  loginViaUi,
  newJar,
  otpFor,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';

// R09 — the provider's work area and the marketplace obey ONE geographic
// authority, proved in a real browser against the real API and PostgreSQL.
//
//   work-area screen -> API validation -> PostgreSQL row -> matching
//
// NOTHING IS STUBBED AND NOTHING IS OVERRIDDEN. The bundle was built with
// VITE_PROVIDER_ONBOARDING_V2=true and the browser flag override is asserted
// absent. No response is fabricated. One test discards a real reply on its way
// back; the request itself reaches the real API and commits.
//
// All coordinates are synthetic. None is a real person's location.

// These tests put real session cookies into the browser. A trace or a video
// would carry them into uploaded evidence, so neither is recorded.
test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const FLAG_OVERRIDE_KEY = 'hsm.ff.providerOnboardingV2';
const DRAFT = '/v1/me/provider/onboarding/draft';
const LOCATION_STEP = '/v1/me/provider/onboarding/steps/LOCATION';
const KM_PER_DEGREE = (2 * Math.PI * 6371) / 360;

const CITY = 'حلب';
// Synthetic points. Inside the Syria envelope the development seed declares.
const ALEPPO = { lat: 36.2, lng: 37.16 };
// Far outside it.
const ELSEWHERE = { lat: 16.02, lng: 7.03 };
const MAP_UNAVAILABLE = 'Map tiles could not load';

interface DraftView {
  version: number;
  editable: boolean;
  data: Record<string, unknown> & {
    radiusPolicy?: { minKm: number; maxKm: number; suggestedKm: number };
  };
}
interface MarketsView {
  markets: Array<{
    countryCode: string;
    bounds?: { south: number; west: number; north: number; east: number };
  }>;
}

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R09 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface GeoRow {
  serviceAreaCity: string | null;
  serviceAreaCityKey: string | null;
  serviceAreaCountryCode: string | null;
  serviceAreaLat: number | null;
  serviceAreaLng: number | null;
  serviceAreaRadiusKm: number | null;
}
/** The work-area columns, read straight from PostgreSQL. */
async function geoRow(profileId: string): Promise<GeoRow> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT "serviceAreaCity", "serviceAreaCityKey", "serviceAreaCountryCode",
              "serviceAreaLat", "serviceAreaLng", "serviceAreaRadiusKm"
         FROM "ProviderProfile" WHERE id = $1`,
      [profileId],
    );
    expect(result.rowCount, 'the provider profile row must exist').toBe(1);
    return result.rows[0] as GeoRow;
  });
}

async function applySession(context: BrowserContext, account: Account): Promise<void> {
  const host = new URL(REAL_API).hostname;
  await context.addCookies(
    [...account.jar].map(([name, value]) => ({
      name,
      value,
      domain: host,
      path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
    })),
  );
}

async function signedInPage(
  browser: Browser,
  account: Account,
  options: Parameters<Browser['newContext']>[0] = {},
  lang: 'en' | 'ar' = 'en',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  await applySession(context, account);
  const page = await context.newPage();
  await seedLanguage(page, lang);
  return { context, page };
}

/** V2 is being served, and only the BUILD made it so. */
async function expectBuildFlagOnly(page: Page): Promise<void> {
  const override = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    FLAG_OVERRIDE_KEY,
  );
  expect(override, 'the browser flag override must be absent').toBeNull();
}

async function openWorkArea(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/provider/onboarding/WORK_AREA`);
  await expect(page.getByTestId('task-screen-WORK_AREA')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('work-area-task')).toBeVisible({ timeout: 30_000 });
  await expectBuildFlagOnly(page);
}

const isLocationWrite = (r: Response) =>
  r.url() === `${REAL_API}${LOCATION_STEP}` && r.request().method() === 'PATCH';

/** Do something in the UI and wait for the server to acknowledge the value. */
async function acknowledged(
  page: Page,
  action: () => Promise<void>,
  settled: (view: DraftView) => boolean,
): Promise<DraftView> {
  const seen: Response[] = [];
  const listener = (r: Response) => {
    if (isLocationWrite(r)) seen.push(r);
  };
  page.on('response', listener);
  try {
    await action();
    let last: DraftView | null = null;
    await expect
      .poll(
        async () => {
          for (const r of seen.splice(0)) {
            expect(r.status(), 'PATCH LOCATION must be accepted').toBe(200);
            last = (await r.json()) as DraftView;
          }
          return last !== null && settled(last);
        },
        { timeout: 30_000, message: 'waiting for the LOCATION acknowledgement' },
      )
      .toBe(true);
    return last as unknown as DraftView;
  } finally {
    page.off('response', listener);
  }
}

async function draftOf(account: Account): Promise<DraftView> {
  const res = await api<DraftView>(account.jar, DRAFT);
  expect(res.status).toBe(200);
  return res.body;
}

async function patchLocation(account: Account, body: Record<string, unknown>) {
  return api<DraftView & { error?: { details?: { reason?: string } } }>(
    account.jar,
    LOCATION_STEP,
    { method: 'PATCH', body: { version: (await draftOf(account)).version, ...body } },
  );
}

const mapSurface = (page: Page) =>
  page.getByTestId('service-area-map').locator('.leaflet-container');
const pin = (page: Page) => page.locator('.pv-service-area-pin');
const feedback = (page: Page) => page.getByTestId('service-area-location-feedback');
const saveStatus = (page: Page) => page.getByTestId('task-save-status');

/** Choose the market through the picker, as a provider does. */
async function chooseSyria(page: Page): Promise<DraftView> {
  const market = page.getByTestId('market-select');
  await expect(market).toBeVisible();
  return acknowledged(
    page,
    () => market.selectOption('SY').then(() => undefined),
    (v) => v.data.serviceAreaCountryCode === 'SY',
  );
}

async function clickMapCentre(page: Page): Promise<void> {
  const box = await mapSurface(page).boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

/**
 * Tap the western edge of the map as it opens on the market.
 *
 * The map opens fitted to the market's envelope with room to spare on each
 * side, so its very edge is outside the envelope. This is the simplest gesture
 * a provider can make that lands outside the market.
 */
async function pressWesternEdge(page: Page, touch = false): Promise<void> {
  const box = await mapSurface(page).boundingBox();
  expect(box).not.toBeNull();
  if (touch) await mapSurface(page).tap({ position: { x: 3, y: box!.height / 2 } });
  else await page.mouse.click(box!.x + 3, box!.y + box!.height / 2);
}

/** A point `north` kilometres from another. */
const northOf = (from: { lat: number; lng: number }, km: number) => ({
  lat: from.lat + km / KM_PER_DEGREE,
  lng: from.lng,
});

async function registerSeeker(): Promise<Account> {
  const jar = newJar();
  const email = `r09-seeker-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = `R09-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'R09', lastName: 'Seeker' },
  });
  expect(registered.status, 'R09 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R09 seeker OTP should verify').toBe(200);
  return { email, password, jar, profileId: '' };
}

/**
 * R09 is not an admin-review acceptance suite. The provider's WORK AREA is
 * written through the real screen and the real API and is never touched here;
 * only the already-certified review outcome (approved category, active
 * status, work access) is seeded, so the marketplace routes can be exercised.
 */
async function grantWorkAccess(account: Account, categoryId: string): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `UPDATE "ProviderProfile"
          SET status = 'ACTIVE', "onboardingState" = 'ACCEPTED', "standingState" = 'GOOD',
              "verificationState" = 'VERIFIED', verified = TRUE
        WHERE id = $1`,
      [account.profileId],
    );
    await db.query('DELETE FROM "ProviderProfileServiceCategory" WHERE "providerProfileId" = $1', [
      account.profileId,
    ]);
    await db.query(
      `INSERT INTO "ProviderProfileServiceCategory" ("providerProfileId","serviceCategoryId","createdAt")
       VALUES ($1,$2,NOW())`,
      [account.profileId, categoryId],
    );
    await db.query('DELETE FROM "ProviderWorkAccessGrant" WHERE "providerProfileId" = $1', [
      account.profileId,
    ]);
    await db.query(
      `INSERT INTO "ProviderWorkAccessGrant"
         ("id","providerProfileId","status","reason","source","grantedAt","expiresAt","createdAt","updatedAt")
       VALUES ($1,$2,'ACTIVE','R09_BROWSER_FIXTURE','VERIFIED_DOCUMENTS',
               NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [`r09grant-${randomUUID()}`, account.profileId],
    );
  });
}

async function leafCategoryId(): Promise<string> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT id FROM "ServiceCategory" WHERE "isLeaf" AND "isActive" ORDER BY id LIMIT 1`,
    );
    return result.rows[0].id as string;
  });
}

async function createRequest(
  seeker: Account,
  categoryId: string,
  label: string,
  point: { lat: number; lng: number },
): Promise<string> {
  const created = await api<{ id: string }>(seeker.jar, '/v1/me/requests', {
    method: 'POST',
    body: {
      categoryId,
      customServiceText: null,
      description: `R09 browser ${label}`,
      scheduleType: 'ASAP',
      scheduledAt: null,
      manualAddress: { line1: '1 Test Street', city: 'Aleppo', country: 'SY', ...point },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
  return created.body.id;
}

/** What the provider can reach, on each of the three routes. */
async function reach(provider: Account, requestId: string) {
  const list = await api<{ items: Array<{ id: string; distanceKm: number | null }> }>(
    provider.jar,
    '/v1/provider/available-requests?limit=100',
  );
  expect(list.status).toBe(200);
  const detail = await api(provider.jar, `/v1/provider/available-requests/${requestId}`);
  return {
    listed: list.body.items.some((i) => i.id === requestId),
    distanceKm: list.body.items.find((i) => i.id === requestId)?.distanceKm ?? null,
    detail: detail.status,
  };
}

// ─── The work area, from the screen to the row and back ─────────────────────

test.describe.serial('R09 work area — real browser, API and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R09 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  let account: Account;
  let context: BrowserContext;
  let page: Page;
  let stored: { lat: number; lng: number };
  let radiusKm: number;

  test.beforeAll(async ({ browser }) => {
    account = await registerProvider();
    ({ context, page } = await signedInPage(browser, account));
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test('the map opens on the chosen market; a tap outside it is refused and a tap inside it is stored', async () => {
    await openWorkArea(page);
    await chooseSyria(page);

    const markets = await api<MarketsView>(account.jar, '/v1/me/provider/onboarding/markets');
    const bounds = markets.body.markets.find((m) => m.countryCode === 'SY')?.bounds;
    expect(bounds, 'the seeded Syria market must describe where it is').toBeTruthy();

    await acknowledged(
      page,
      async () => {
        await page.getByTestId('service-area-city').fill(CITY);
        await page.getByTestId('service-area-city').blur();
      },
      (v) => v.data.serviceAreaCity === CITY,
    );

    // First, a tap that lands outside the market: explained, and not sent.
    const untouched = await draftOf(account);
    await pressWesternEdge(page);
    await expect(feedback(page)).toContainText('outside the country you selected');
    await expect(pin(page)).toHaveCount(0);
    await expect
      .poll(async () => (await draftOf(account)).version, { timeout: 4_000, intervals: [3_000] })
      .toBe(untouched.version);
    expect(await geoRow(account.profileId)).toMatchObject({
      serviceAreaLat: null,
      serviceAreaLng: null,
    });

    const pinned = await acknowledged(
      page,
      () => clickMapCentre(page),
      (v) => typeof v.data.serviceAreaLat === 'number' && typeof v.data.serviceAreaLng === 'number',
    );
    stored = {
      lat: pinned.data.serviceAreaLat as number,
      lng: pinned.data.serviceAreaLng as number,
    };
    // The middle of the map is the middle of the market, not of the world.
    expect(stored.lat).toBeGreaterThanOrEqual(bounds!.south);
    expect(stored.lat).toBeLessThanOrEqual(bounds!.north);
    expect(stored.lng).toBeGreaterThanOrEqual(bounds!.west);
    expect(stored.lng).toBeLessThanOrEqual(bounds!.east);
    await expect(pin(page)).toBeVisible();
    await expect(feedback(page)).toContainText('Starting point selected');

    // The radius has no control: it is the server's number, stated.
    const view = await draftOf(account);
    radiusKm = view.data.serviceAreaRadiusKm as number;
    expect(radiusKm).toBeGreaterThanOrEqual(view.data.radiusPolicy!.minKm);
    expect(radiusKm).toBeLessThanOrEqual(view.data.radiusPolicy!.maxKm);
    await expect(page.getByTestId('service-area-radius')).toContainText(String(radiusKm));

    expect(await geoRow(account.profileId)).toEqual({
      serviceAreaCity: CITY,
      serviceAreaCityKey: CITY,
      serviceAreaCountryCode: 'SY',
      serviceAreaLat: stored.lat,
      serviceAreaLng: stored.lng,
      serviceAreaRadiusKm: radiusKm,
    });
  });

  test('the work area survives leaving, a hard reload and a fresh login', async ({ browser }) => {
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
    await openWorkArea(page);
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
    await expect(pin(page)).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
    await expect(pin(page)).toBeVisible();
    await expect(page.getByTestId('service-area-point')).toContainText(stored.lat.toFixed(5));
    await expect(page.getByTestId('service-area-radius')).toContainText(String(radiusKm));
    // A settled market is not asked again.
    await expect(page.getByTestId('market-picker')).toHaveCount(0);

    const before = await draftOf(account);
    const fresh = await browser.newContext();
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/provider/onboarding/WORK_AREA`);
      await expect(freshPage).toHaveURL(/\/login/);
      await loginViaUi(freshPage, account);
      await expect(freshPage).toHaveURL(/\/provider\/onboarding\/WORK_AREA$/, { timeout: 60_000 });
      await expectBuildFlagOnly(freshPage);
      await expect(freshPage.getByTestId('service-area-city')).toHaveValue(CITY);
      await expect(pin(freshPage)).toBeVisible();
      await expect(freshPage.getByTestId('service-area-point')).toContainText(
        stored.lat.toFixed(5),
      );
      await expect(freshPage.getByTestId('service-area-radius')).toContainText(String(radiusKm));
    } finally {
      await fresh.close();
    }
    // Reading back wrote nothing.
    expect((await draftOf(account)).version).toBe(before.version);
    expect(await geoRow(account.profileId)).toMatchObject({
      serviceAreaLat: stored.lat,
      serviceAreaLng: stored.lng,
    });
  });

  test('the server refuses a point outside the market and half a point, whatever the screen does', async () => {
    const before = await draftOf(account);

    // The screen is an explanation. The SERVER is the rule: the same point
    // sent straight to the API is refused, and nothing is written.
    const refused = await patchLocation(account, {
      serviceAreaLat: ELSEWHERE.lat,
      serviceAreaLng: ELSEWHERE.lng,
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error?.details?.reason).toBe('POINT_OUTSIDE_MARKET');
    const half = await patchLocation(account, { serviceAreaLat: null });
    expect(half.status).toBe(400);
    expect(half.body.error?.details?.reason).toBe('COORDINATES_INCOMPLETE');
    expect((await draftOf(account)).version).toBe(before.version);
    expect(await geoRow(account.profileId)).toMatchObject({
      serviceAreaLat: stored.lat,
      serviceAreaLng: stored.lng,
    });
  });

  test('the radius accepts the policy bounds and nothing beyond them', async () => {
    const { minKm, maxKm } = (await draftOf(account)).data.radiusPolicy!;
    for (const [km, status, why] of [
      [minKm, 200, null],
      [maxKm, 200, null],
      [maxKm + 1, 400, 'ABOVE_MAX'],
      [minKm - 1, 400, minKm - 1 < 1 ? undefined : 'BELOW_MIN'],
    ] as const) {
      const res = await patchLocation(account, { serviceAreaRadiusKm: km });
      expect([km, res.status]).toEqual([km, status]);
      if (why) expect(res.body.error?.details?.reason).toBe(why);
    }
    // Refused, not clamped: the last accepted value is what is stored...
    expect((await geoRow(account.profileId)).serviceAreaRadiusKm).toBe(maxKm);
    // ...and what the screen states after a reload.
    await page.reload();
    await expect(page.getByTestId('service-area-radius')).toContainText(String(maxKm));

    const restored = await patchLocation(account, { serviceAreaRadiusKm: radiusKm });
    expect(restored.status).toBe(200);
  });

  test('removing the point and changing the market leave no stale geography', async () => {
    await openWorkArea(page);
    const cleared = await acknowledged(
      page,
      () => page.getByTestId('service-area-remove-point').click(),
      (v) => v.data.serviceAreaLat === null && v.data.serviceAreaLng === null,
    );
    expect(cleared.data.serviceAreaCity).toBe(CITY);
    await expect(pin(page)).toHaveCount(0);
    expect(await geoRow(account.profileId)).toMatchObject({
      serviceAreaLat: null,
      serviceAreaLng: null,
      serviceAreaCity: CITY,
    });

    // Put a point back in Syria, then move the provider to Sweden.
    const again = await patchLocation(account, {
      serviceAreaLat: ALEPPO.lat,
      serviceAreaLng: ALEPPO.lng,
    });
    expect(again.status).toBe(200);
    const moved = await patchLocation(account, { serviceAreaCountryCode: 'SE' });
    expect(moved.status).toBe(200);
    // The Syrian point is not carried into the Swedish market.
    expect(moved.body.data).toMatchObject({
      serviceAreaCountryCode: 'SE',
      serviceAreaLat: null,
      serviceAreaLng: null,
    });
    expect(await geoRow(account.profileId)).toMatchObject({
      serviceAreaCountryCode: 'SE',
      serviceAreaLat: null,
      serviceAreaLng: null,
    });
    await page.reload();
    await expect(page.getByTestId('work-area-task')).toBeVisible();
    await expect(pin(page)).toHaveCount(0);
  });
});

// ─── Permission, keyboard, touch, language ──────────────────────────────────

test.describe('R09 work area — permission, keyboard, touch and language', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R09 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  test('a refused location permission keeps what was entered and leaves the manual path open', async ({
    browser,
  }) => {
    const account = await registerProvider();
    // No geolocation permission is granted to this browser.
    const { context, page } = await signedInPage(browser, account, { permissions: [] });
    try {
      await openWorkArea(page);
      await chooseSyria(page);
      await acknowledged(
        page,
        async () => {
          await page.getByTestId('service-area-city').fill('Aleppo');
          await page.getByTestId('service-area-city').blur();
        },
        (v) => v.data.serviceAreaCity === 'Aleppo',
      );
      const before = await draftOf(account);

      // Nothing asked for the device position until the provider does.
      await page.getByTestId('service-area-locate').click();
      await expect(feedback(page)).toContainText('Location permission was not granted');
      await expect(page.getByTestId('service-area-city')).toHaveValue('Aleppo');
      await expect(pin(page)).toHaveCount(0);
      // No coordinate was invented.
      expect((await draftOf(account)).version).toBe(before.version);
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaLat: null,
        serviceAreaLng: null,
        serviceAreaCity: 'Aleppo',
      });

      // The manual path still works.
      const pinned = await acknowledged(
        page,
        () => clickMapCentre(page),
        (v) => typeof v.data.serviceAreaLat === 'number',
      );
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaLat: pinned.data.serviceAreaLat,
        serviceAreaLng: pinned.data.serviceAreaLng,
      });
    } finally {
      await context.close();
    }
  });

  test('a device that is outside the market is not stored as the starting point', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account, {
      permissions: ['geolocation'],
      geolocation: { latitude: ELSEWHERE.lat, longitude: ELSEWHERE.lng },
    });
    try {
      await openWorkArea(page);
      await chooseSyria(page);
      const before = await draftOf(account);
      await page.getByTestId('service-area-locate').click();
      await expect(feedback(page)).toContainText('outside the country you selected');
      await expect(pin(page)).toHaveCount(0);
      await page.waitForTimeout(1500);
      expect((await draftOf(account)).version).toBe(before.version);
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaLat: null,
        serviceAreaLng: null,
      });
    } finally {
      await context.close();
    }
  });

  test('the radius is the server’s: it follows the transport answer and the screen only states it', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      // The work-area screen is opened FIRST, before any transport is chosen.
      await openWorkArea(page);
      await chooseSyria(page);
      const onFoot = await draftOf(account);
      const walking = onFoot.data.serviceAreaRadiusKm as number;
      expect(walking).toBe(onFoot.data.radiusPolicy!.suggestedKm);
      await expect(page.getByTestId('service-area-radius')).toContainText(String(walking));

      // The provider then says they drive.
      const experience = await api<DraftView>(
        account.jar,
        '/v1/me/provider/onboarding/steps/EXPERIENCE',
        { method: 'PATCH', body: { version: onFoot.version, transportModes: ['CAR'] } },
      );
      expect(experience.status, JSON.stringify(experience.body)).toBe(200);

      const driving = await draftOf(account);
      expect(driving.data.radiusPolicy!.suggestedKm).toBeGreaterThan(walking);
      // Opening the screen did not freeze the walking radius in place.
      expect(driving.data.serviceAreaRadiusKm).toBe(driving.data.radiusPolicy!.suggestedKm);
      expect((await geoRow(account.profileId)).serviceAreaRadiusKm).toBe(
        driving.data.radiusPolicy!.suggestedKm,
      );
      await page.reload();
      await expect(page.getByTestId('service-area-radius')).toContainText(
        String(driving.data.radiusPolicy!.suggestedKm),
      );
    } finally {
      await context.close();
    }
  });

  test('when the map vendor is unreachable the provider can still set a work area', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      // The third-party tile and geocoding hosts are down. Our own API is not
      // touched: every request to it still reaches the real server.
      await context.route(/^https:\/\/(tile|nominatim)\.openstreetmap\.org\//, (route) =>
        route.abort('internetdisconnected'),
      );
      await openWorkArea(page);
      await chooseSyria(page);
      await expect(page.getByTestId('service-area-map')).toContainText(MAP_UNAVAILABLE);

      await acknowledged(
        page,
        async () => {
          await page.getByTestId('service-area-city').fill('Aleppo');
          await page.getByTestId('service-area-city').blur();
        },
        (v) => v.data.serviceAreaCity === 'Aleppo',
      );
      // The map has no pictures, and still takes a point inside the market.
      const pinned = await acknowledged(
        page,
        () => page.getByTestId('service-area-use-centre').click(),
        (v) => typeof v.data.serviceAreaLat === 'number',
      );
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaCity: 'Aleppo',
        serviceAreaCountryCode: 'SY',
        serviceAreaLat: pinned.data.serviceAreaLat,
        serviceAreaLng: pinned.data.serviceAreaLng,
      });
    } finally {
      await context.close();
    }
  });

  test('the point can be chosen with the keyboard alone', async ({ browser }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openWorkArea(page);
      await chooseSyria(page);

      // Every control has a programmatic name.
      await expect(page.getByLabel('City or neighborhood')).toBeVisible();
      await expect(mapSurface(page)).toHaveAttribute('role', 'region');
      await expect(mapSurface(page)).toHaveAttribute('aria-label', /arrow keys/i);

      // Tab reaches the map from the city field, and leaves it again.
      await page.getByTestId('service-area-city').focus();
      const visited: string[] = [];
      for (let i = 0; i < 14; i += 1) {
        await page.keyboard.press('Tab');
        visited.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            return (
              el?.getAttribute('data-testid') ??
              (el?.classList.contains('leaflet-container') ? 'map' : (el?.tagName ?? ''))
            );
          }),
        );
      }
      expect(visited).toContain('service-area-locate');
      expect(visited).toContain('map');
      expect(visited).toContain('service-area-use-centre');
      // Not trapped in the map: focus moved on to the page's own action.
      expect(visited).toContain('task-save-and-continue');

      // Pan with the arrow keys, then commit the centre with Enter.
      await mapSurface(page).focus();
      await expect(mapSurface(page)).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await page.getByTestId('service-area-use-centre').focus();
      await expect(page.getByTestId('service-area-use-centre')).toBeFocused();
      const pinned = await acknowledged(
        page,
        () => page.keyboard.press('Enter'),
        (v) => typeof v.data.serviceAreaLat === 'number',
      );
      await expect(pin(page)).toBeVisible();
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaLat: pinned.data.serviceAreaLat,
        serviceAreaLng: pinned.data.serviceAreaLng,
      });
    } finally {
      await context.close();
    }
  });

  for (const width of [360, 390, 430]) {
    test(`Arabic, right-to-left, ${width}px wide, by touch`, async ({ browser }) => {
      const account = await registerProvider();
      const { context, page } = await signedInPage(
        browser,
        account,
        { viewport: { width, height: 844 }, hasTouch: true, isMobile: true },
        'ar',
      );
      try {
        await openWorkArea(page);
        await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
        const market = page.getByTestId('market-select');
        await expect(market).toBeVisible();
        await acknowledged(
          page,
          () => market.selectOption('SY').then(() => undefined),
          (v) => v.data.serviceAreaCountryCode === 'SY',
        );

        // No sideways scroll, in Arabic, at this width.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        // Every control is inside the viewport's width and big enough to hit.
        for (const id of ['service-area-city', 'service-area-locate', 'service-area-use-centre']) {
          const target = page.getByTestId(id);
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          expect(box, id).not.toBeNull();
          expect(box!.x).toBeGreaterThanOrEqual(0);
          expect(box!.x + box!.width).toBeLessThanOrEqual(width);
          expect(box!.height).toBeGreaterThanOrEqual(44);
        }

        // The map is shorter than the screen, so the page scrolls around it.
        const mapBox = await mapSurface(page).boundingBox();
        expect(mapBox!.height).toBeLessThan(844);
        expect(mapBox!.x).toBeGreaterThanOrEqual(0);
        expect(mapBox!.x + mapBox!.width).toBeLessThanOrEqual(width);

        // A tap outside the market is refused, and the refusal is in Arabic.
        await mapSurface(page).scrollIntoViewIfNeeded();
        await pressWesternEdge(page, true);
        await expect(feedback(page)).toContainText('خارج الدولة التي اخترتها');
        await expect(pin(page)).toHaveCount(0);
        expect(await geoRow(account.profileId)).toMatchObject({
          serviceAreaLat: null,
          serviceAreaLng: null,
        });

        // A tap inside it places the point.
        const pinned = await acknowledged(
          page,
          () => mapSurface(page).tap({ position: { x: mapBox!.width / 2, y: 110 } }),
          (v) => typeof v.data.serviceAreaLat === 'number',
        );
        await expect(pin(page)).toBeVisible();
        await expect(feedback(page)).toContainText('تم تحديد نقطة الانطلاق');

        // A second tap moves it.
        const moved = await acknowledged(
          page,
          () => mapSurface(page).tap({ position: { x: mapBox!.width / 2 - 40, y: 160 } }),
          (v) =>
            typeof v.data.serviceAreaLat === 'number' &&
            v.data.serviceAreaLat !== pinned.data.serviceAreaLat,
        );
        expect(await geoRow(account.profileId)).toMatchObject({
          serviceAreaCountryCode: 'SY',
          serviceAreaLat: moved.data.serviceAreaLat,
          serviceAreaLng: moved.data.serviceAreaLng,
        });

        // The page's own action is still reachable past the map.
        await expect(page.getByTestId('task-save-and-continue')).toBeInViewport();
      } finally {
        await context.close();
      }
    });
  }
});

// ─── Authority under failure ────────────────────────────────────────────────

test.describe('R09 work area — stale tab, lost response, lost session, isolation', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R09 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  test('a stale second tab cannot overwrite the work area, and sees the newer one after a reload', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const context = await browser.newContext();
    await applySession(context, account);
    try {
      const tabA = await context.newPage();
      await seedLanguage(tabA, 'en');
      await openWorkArea(tabA);
      await chooseSyria(tabA);

      // Both tabs now hold the same revision.
      const tabB = await context.newPage();
      await seedLanguage(tabB, 'en');
      await openWorkArea(tabA);
      await openWorkArea(tabB);

      const first = await acknowledged(
        tabA,
        () => clickMapCentre(tabA),
        (v) => typeof v.data.serviceAreaLat === 'number',
      );

      const refused = tabB.waitForResponse(isLocationWrite);
      await tabB.getByTestId('service-area-city').fill('Written by the stale tab');
      await tabB.getByTestId('service-area-city').blur();
      expect((await refused).status()).toBe(409);
      await expect(saveStatus(tabB)).toHaveAttribute('data-status', 'conflict');
      await expect(saveStatus(tabB)).not.toContainText('Saved');

      const row = await geoRow(account.profileId);
      expect(row.serviceAreaCity).not.toBe('Written by the stale tab');
      expect(row.serviceAreaLat).toBe(first.data.serviceAreaLat);
      expect((await draftOf(account)).version).toBe(first.version);

      await tabB.reload();
      await expect(pin(tabB)).toBeVisible();
      await expect(tabB.getByTestId('service-area-point')).toContainText(
        (first.data.serviceAreaLat as number).toFixed(5),
      );
    } finally {
      await context.close();
    }
  });

  test('a point whose acknowledgement is lost is stored once, never called saved, and found after a reload', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openWorkArea(page);
      await chooseSyria(page);
      const before = await draftOf(account);

      // The request goes to the real API and commits. Its reply is dropped.
      let droppedStatus = 0;
      await page.route(`${REAL_API}${LOCATION_STEP}`, async (route) => {
        if (route.request().method() !== 'PATCH' || droppedStatus > 0) return route.continue();
        const real = await route.fetch();
        droppedStatus = real.status();
        await route.abort('connectionreset');
      });
      await clickMapCentre(page);
      await expect.poll(() => droppedStatus, { timeout: 15_000 }).toBe(200);
      await expect(saveStatus(page)).toHaveAttribute('data-status', 'error', { timeout: 15_000 });

      const committed = await draftOf(account);
      expect(committed.version).toBe(before.version + 1);
      expect(typeof committed.data.serviceAreaLat).toBe('number');

      // Trying again cannot apply it twice.
      const retried = page.waitForResponse(isLocationWrite);
      await page.getByTestId('task-save-retry').click();
      expect((await retried).status()).toBe(409);
      expect((await draftOf(account)).version).toBe(before.version + 1);

      await page.unroute(`${REAL_API}${LOCATION_STEP}`);
      await page.reload();
      await expect(pin(page)).toBeVisible();
      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaLat: committed.data.serviceAreaLat,
        serviceAreaLng: committed.data.serviceAreaLng,
      });
    } finally {
      await context.close();
    }
  });

  test('a point chosen after the session is lost is refused and not written', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openWorkArea(page);
      const saved = await chooseSyria(page);

      await context.clearCookies();
      const refused = page.waitForResponse(isLocationWrite);
      await clickMapCentre(page);
      expect([401, 403]).toContain((await refused).status());
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

      expect(await geoRow(account.profileId)).toMatchObject({
        serviceAreaCountryCode: 'SY',
        serviceAreaLat: null,
        serviceAreaLng: null,
      });
      expect((await draftOf(account)).version).toBe(saved.version);
    } finally {
      await context.close();
    }
  });

  test('one provider can neither read nor move the work area of another', async ({ browser }) => {
    const owner = await registerProvider();
    const other = await registerProvider();
    const mine = await patchLocation(owner, {
      serviceAreaCountryCode: 'SY',
      serviceAreaCity: 'Owner City',
      serviceAreaLat: ALEPPO.lat,
      serviceAreaLng: ALEPPO.lng,
    });
    expect(mine.status).toBe(200);
    const ownerRow = await geoRow(owner.profileId);

    // The other provider's screen and draft are their own, and empty.
    const { context, page } = await signedInPage(browser, other);
    try {
      await openWorkArea(page);
      await expect(page.getByTestId('service-area-city')).toHaveValue('');
      await expect(pin(page)).toHaveCount(0);
    } finally {
      await context.close();
    }
    const otherDraft = await draftOf(other);
    expect(otherDraft.data.serviceAreaLat ?? null).toBeNull();
    expect(JSON.stringify(otherDraft)).not.toContain('Owner City');

    // Whatever the other provider writes lands on their own profile only,
    // whichever of the two write routes they use.
    const theirs = await patchLocation(other, {
      serviceAreaCountryCode: 'SY',
      serviceAreaCity: 'Other City',
      serviceAreaLat: 33.51,
      serviceAreaLng: 36.28,
    });
    expect(theirs.status).toBe(200);
    const legacy = await api(other.jar, '/v1/me/provider/profile', {
      method: 'PATCH',
      body: { serviceAreaLat: 33.6, serviceAreaLng: 36.3 },
    });
    expect(legacy.status).toBeLessThan(500);
    expect(await geoRow(owner.profileId)).toEqual(ownerRow);

    // The owner's point is not in anything the public can read.
    const publicProfile = await api(other.jar, `/v1/providers/${owner.profileId}`);
    expect(JSON.stringify(publicProfile.body)).not.toContain(String(ALEPPO.lat));
  });
});

// ─── The marketplace reads the same point the screen wrote ──────────────────

test.describe('R09 marketplace — the feed, the detail and the bid agree with the work area', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R09 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  test('requests inside the radius are reachable, those outside are not, and moving the point moves the line', async ({
    browser,
  }) => {
    const provider = await registerProvider();
    const { context, page } = await signedInPage(browser, provider);
    let point: { lat: number; lng: number };
    let radiusKm: number;
    try {
      // The work area is written through the real screen.
      await openWorkArea(page);
      await chooseSyria(page);
      await acknowledged(
        page,
        async () => {
          // A typed city that is NOT where the point is: the point decides.
          await page.getByTestId('service-area-city').fill('Damascus');
          await page.getByTestId('service-area-city').blur();
        },
        (v) => v.data.serviceAreaCity === 'Damascus',
      );
      const pinned = await acknowledged(
        page,
        () => clickMapCentre(page),
        (v) => typeof v.data.serviceAreaLat === 'number',
      );
      point = {
        lat: pinned.data.serviceAreaLat as number,
        lng: pinned.data.serviceAreaLng as number,
      };
      radiusKm = (await draftOf(provider)).data.serviceAreaRadiusKm as number;
      expect(radiusKm).toBeGreaterThan(1);
    } finally {
      await context.close();
    }
    const row = await geoRow(provider.profileId);
    expect(row).toMatchObject({ serviceAreaLat: point.lat, serviceAreaLng: point.lng });

    const categoryId = await leafCategoryId();
    await grantWorkAccess(provider, categoryId);
    // The fixture did not touch the work area.
    expect(await geoRow(provider.profileId)).toEqual(row);

    // The provider signs in again so the session carries the granted access.
    const relogin = await browser.newContext();
    try {
      const loginPage = await relogin.newPage();
      await seedLanguage(loginPage, 'en');
      await loginPage.goto(`${BASE_URL}/login`);
      await loginViaUi(loginPage, provider);
      await expect(loginPage).not.toHaveURL(/\/login/, { timeout: 60_000 });
      provider.jar.clear();
      for (const cookie of await relogin.cookies()) provider.jar.set(cookie.name, cookie.value);
    } finally {
      await relogin.close();
    }

    const seeker = await registerSeeker();
    // Half a kilometre inside the radius to the south; half a kilometre
    // outside it to the north. Both are labelled with the same city.
    const south = await createRequest(
      seeker,
      categoryId,
      'south',
      northOf(point, -(radiusKm - 0.5)),
    );
    const north = await createRequest(seeker, categoryId, 'north', northOf(point, radiusKm + 0.5));

    const southReach = await reach(provider, south);
    expect(southReach).toMatchObject({ listed: true, detail: 200 });
    expect(southReach.distanceKm).toBeCloseTo(radiusKm - 0.5, 1);
    expect(await reach(provider, north)).toMatchObject({ listed: false, detail: 404 });

    // The bid follows the same line, and a refusal discloses nothing.
    const refusedBid = await api(provider.jar, '/v1/provider/bids', {
      method: 'POST',
      body: { requestId: north, amount: 100, pricingType: 'FIXED' },
    });
    expect(refusedBid.status).toBe(404);
    expect(JSON.stringify(refusedBid.body)).not.toContain('R09 browser north');

    // The provider moves two kilometres north through the profile route an
    // approved provider uses. It obeys the same rules as onboarding.
    const outside = await api<{ error?: { details?: { reason?: string } } }>(
      provider.jar,
      '/v1/me/provider/profile',
      { method: 'PATCH', body: { serviceAreaLat: ELSEWHERE.lat, serviceAreaLng: ELSEWHERE.lng } },
    );
    expect(outside.status).toBe(400);
    expect(outside.body.error?.details?.reason).toBe('POINT_OUTSIDE_MARKET');
    const half = await api<{ error?: { details?: { reason?: string } } }>(
      provider.jar,
      '/v1/me/provider/profile',
      { method: 'PATCH', body: { serviceAreaLat: null } },
    );
    expect(half.status).toBe(400);
    expect(half.body.error?.details?.reason).toBe('COORDINATES_INCOMPLETE');
    expect(await geoRow(provider.profileId)).toEqual(row);

    const next = northOf(point, 2);
    const movedProfile = await api(provider.jar, '/v1/me/provider/profile', {
      method: 'PATCH',
      body: { serviceAreaLat: next.lat, serviceAreaLng: next.lng },
    });
    expect(movedProfile.status, JSON.stringify(movedProfile.body)).toBe(200);
    expect(await geoRow(provider.profileId)).toMatchObject({
      serviceAreaLat: next.lat,
      serviceAreaLng: next.lng,
      serviceAreaRadiusKm: radiusKm,
    });

    // The line moved with the point: no stale geography on any route.
    expect(await reach(provider, south)).toMatchObject({ listed: false, detail: 404 });
    expect(await reach(provider, north)).toMatchObject({ listed: true, detail: 200 });

    const acceptedBid = await api(provider.jar, '/v1/provider/bids', {
      method: 'POST',
      body: { requestId: north, amount: 100, pricingType: 'FIXED' },
    });
    expect(acceptedBid.status, JSON.stringify(acceptedBid.body)).toBe(201);
    const staleBid = await api(provider.jar, '/v1/provider/bids', {
      method: 'POST',
      body: { requestId: south, amount: 100, pricingType: 'FIXED' },
    });
    expect(staleBid.status).toBe(404);

    const bids = await withDb(async (db) => {
      const result = await db.query(
        `SELECT "requestId" FROM "Bid" WHERE "providerId" = $1 ORDER BY "requestId"`,
        [provider.profileId],
      );
      return result.rows.map((r) => r.requestId as string);
    });
    expect(bids).toEqual([north]);
  });
});
