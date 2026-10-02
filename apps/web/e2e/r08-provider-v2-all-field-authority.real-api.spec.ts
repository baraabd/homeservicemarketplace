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
  addPortfolioPhoto,
  api,
  approveCategoriesFor,
  loginViaUi,
  REAL_API,
  registerProvider,
  type Account,
} from './real-api';

// R08 — every Provider V2 onboarding field a provider can set, proved through
// its whole life: typed in the real UI, acknowledged by the real API, still
// there after leaving the task, after a hard reload, after a fresh login in a
// clean browser, and in the PostgreSQL row.
//
// NOTHING IS STUBBED AND NOTHING IS OVERRIDDEN.
//
// The web artifact under test was built with VITE_PROVIDER_ONBOARDING_V2=true.
// This spec never writes the `hsm.ff.providerOnboardingV2` browser override,
// never fabricates a response and never seeds a persisted value into the
// database. `expectBuildFlagOnly` asserts, in every browser context used, that
// the override key is absent while the V2 route is being served.
//
// One provider is carried through the six tasks in order, so the tests in the
// first block are serial and share state.

// These tests put real session cookies into the browser. A Playwright trace or
// video would carry them into the uploaded evidence, so neither is recorded;
// failure screenshots and the page snapshot remain.
test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const FLAG_OVERRIDE_KEY = 'hsm.ff.providerOnboardingV2';
const DRAFT = '/v1/me/provider/onboarding/draft';
const HUB = '/v1/me/provider/onboarding/hub';

// What the provider enters. Arabic, English and mixed text on purpose.
const DISPLAY_NAME = 'ليلى منصور Layla';
const PHONE = '+963 944 123 456';
const CITY = 'حلب الجديدة';
const BIO =
  'فنية كهرباء منزلية بخبرة طويلة في حلب. Licensed home electrician, careful and on time.';
const YEARS = 4;
const TRANSPORT = ['CAR', 'MOTORCYCLE'] as const;
const DAYS = [0, 2, 4] as const;
const START = '08:30';
const END = '16:45';

interface DraftView {
  version: number;
  editable: boolean;
  state: string;
  data: Record<string, unknown> & {
    availability?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  };
}

interface Shared {
  account: Account;
  specialtyIds: string[];
  avatarUrl: string;
  lat: number;
  lng: number;
  countryCode: string;
  timezone: string;
  radiusKm: number;
  headline: string;
  portfolioItemId: string;
  consentVersion: string;
}
const shared = {} as Shared;

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R08 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The provider's profile row, read straight from PostgreSQL. */
async function profileRow(profileId: string): Promise<Record<string, unknown>> {
  return withDb(async (db) => {
    // The timestamp columns carry no zone and hold UTC. The driver would read
    // them in this machine's zone, so the one compared exactly is rendered by
    // PostgreSQL itself.
    const result = await db.query(
      `SELECT *, to_char("professionSince", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "professionSinceUtc",
                "transportModes"::text[] AS "transportModeList"
         FROM "ProviderProfile" WHERE id = $1`,
      [profileId],
    );
    expect(result.rowCount, 'the provider profile row must exist').toBe(1);
    return result.rows[0] as Record<string, unknown>;
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

/**
 * V2 is being served, and only the BUILD made it so.
 *
 * With the browser override absent, the flag resolver can only return the
 * build-time value. Asserted on every page this spec uses.
 */
async function expectBuildFlagOnly(page: Page): Promise<void> {
  const override = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    FLAG_OVERRIDE_KEY,
  );
  expect(override, 'the browser flag override must be absent').toBeNull();
  await expect(page).toHaveURL(/\/provider\/onboarding/);
}

async function openTask(page: Page, task: string, hash = ''): Promise<void> {
  await page.goto(`${BASE_URL}/provider/onboarding/${task}${hash}`);
  await expect(page.getByTestId(`task-screen-${task}`)).toBeVisible({ timeout: 30_000 });
  await expectBuildFlagOnly(page);
}

/** Leave the task for the hub and come back: nothing may be lost on the way. */
async function leaveAndReturn(page: Page, task: string, hash = ''): Promise<void> {
  await page.getByTestId('onboarding-v2-close').click();
  await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
  await openTask(page, task, hash);
}

const isStepWrite = (step: string) => (r: Response) =>
  r.url() === `${REAL_API}/v1/me/provider/onboarding/steps/${step}` &&
  r.request().method() === 'PATCH';

/**
 * Do something in the UI and wait for the server to acknowledge the value.
 *
 * Several debounced writes can be in flight; this waits for the 200 whose
 * RETURNED draft satisfies `settled`, so it is the acknowledgement of the
 * value on screen and not of an earlier keystroke.
 */
async function acknowledged(
  page: Page,
  step: string,
  action: () => Promise<void>,
  settled: (view: DraftView) => boolean,
): Promise<DraftView> {
  const seen: Response[] = [];
  const listener = (r: Response) => {
    if (isStepWrite(step)(r)) seen.push(r);
  };
  page.on('response', listener);
  try {
    await action();
    let last: DraftView | null = null;
    await expect
      .poll(
        async () => {
          for (const r of seen.splice(0)) {
            expect(r.status(), `PATCH ${step} must be accepted`).toBe(200);
            last = (await r.json()) as DraftView;
          }
          return last !== null && settled(last);
        },
        { timeout: 30_000, message: `waiting for the ${step} acknowledgement` },
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

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const expectedWeek = () =>
  DAYS.map((dayOfWeek) => ({ dayOfWeek, startMinute: minutes(START), endMinute: minutes(END) }));
const weekOf = (view: DraftView) =>
  (view.data.availability ?? [])
    .map(({ dayOfWeek, startMinute, endMinute }) => ({ dayOfWeek, startMinute, endMinute }))
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

/** A real image, encoded by the browser itself. */
async function photo(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 320, 320);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(100, 100, 120, 120);
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.9),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }, color);
  return Buffer.from(base64, 'base64');
}

/** Everything the provider entered, as each task screen shows it. */
async function expectAllFieldsOnScreen(page: Page): Promise<void> {
  await openTask(page, 'BASICS_IDENTITY');
  await expect(page.getByTestId('field-displayName')).toHaveValue(DISPLAY_NAME);
  await expect(page.getByTestId('field-phoneNumber')).toHaveValue(PHONE);
  await expect(page.getByTestId('avatar-preview-image')).toBeVisible();

  await openTask(page, 'SERVICES_EXPERIENCE');
  for (const id of shared.specialtyIds) {
    await expect(page.getByTestId(`specialty-choice-${id}`)).toHaveAttribute(
      'data-checked',
      'true',
    );
  }
  await openTask(page, 'SERVICES_EXPERIENCE', '#experience');
  await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));
  for (const mode of TRANSPORT) {
    await expect(page.getByTestId(`transport-${mode}`)).toHaveAttribute('data-checked', 'true');
  }
  await expect(page.getByTestId('transport-ON_FOOT')).toHaveAttribute('data-checked', 'false');

  await openTask(page, 'WORK_AREA');
  await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
  // A settled country is not re-asked: the picker is drawn only while the
  // server still needs an answer. Its absence IS the screen's account of it.
  await expect(page.getByTestId('market-picker')).toHaveCount(0);
  await expect(page.locator('.pv-service-area-pin')).toBeVisible();

  await openTask(page, 'WORKING_HOURS');
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    await expect(page.getByTestId(`day-toggle-${day}`)).toHaveAttribute(
      'aria-pressed',
      String((DAYS as readonly number[]).includes(day)),
    );
  }
  await expect(page.getByTestId('bulk-start')).toHaveValue(START);
  await expect(page.getByTestId('bulk-end')).toHaveValue(END);

  await openTask(page, 'PORTFOLIO');
  await expect(page.getByTestId('bio-input')).toHaveValue(BIO);
  await openTask(page, 'PORTFOLIO', '#portfolio');
  await expect(page.getByTestId(`portfolio-reorder-${shared.portfolioItemId}`)).toBeVisible();
}

/** The same values, as the API serves them to an independent client. */
async function expectAllFieldsFromApi(account: Account): Promise<DraftView> {
  const view = await draftOf(account);
  expect(view.data).toMatchObject({
    displayName: DISPLAY_NAME,
    phoneNumber: PHONE,
    profileImageUrl: shared.avatarUrl,
    serviceAreaCity: CITY,
    serviceAreaCountryCode: shared.countryCode,
    serviceAreaLat: shared.lat,
    serviceAreaLng: shared.lng,
    serviceAreaRadiusKm: shared.radiusKm,
    timezone: shared.timezone,
    bio: BIO,
    headline: shared.headline,
  });
  expect(new Date(String(view.data.professionSince)).getUTCFullYear()).toBe(
    new Date().getUTCFullYear() - YEARS,
  );
  expect([...(view.data.transportModes as string[])].sort()).toEqual([...TRANSPORT].sort());
  expect(weekOf(view)).toEqual(expectedWeek());
  return view;
}

test.describe.serial('R08 Provider V2 all-field authority — real browser, API and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R08 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    shared.account = await registerProvider();
    context = await browser.newContext();
    await applySession(context, shared.account);
    page = await context.newPage();
    await seedLanguage(page, 'en');
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('the built artifact serves V2 from its build flag, with no browser override', async () => {
    await page.goto(`${BASE_URL}/provider/onboarding`);
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
    await expectBuildFlagOnly(page);

    // The six canonical tasks, in the server's order.
    const hub = await api<{ tasks: Array<{ id: string }> }>(shared.account.jar, HUB);
    expect(hub.body.tasks.map((t) => t.id)).toEqual([
      'BASICS_IDENTITY',
      'SERVICES_EXPERIENCE',
      'WORK_AREA',
      'WORKING_HOURS',
      'PORTFOLIO',
      'REVIEW_SUBMISSION',
    ]);
    for (const id of hub.body.tasks.map((t) => t.id)) {
      await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();
    }
  });

  test('BASICS_IDENTITY: display name, phone and photo', async () => {
    await openTask(page, 'BASICS_IDENTITY');

    const named = await acknowledged(
      page,
      'IDENTITY',
      () => page.getByTestId('field-displayName').fill(DISPLAY_NAME),
      (v) => v.data.displayName === DISPLAY_NAME,
    );
    expect(named.version).toBeGreaterThan(0);

    const phoned = await acknowledged(
      page,
      'IDENTITY',
      () => page.getByTestId('field-phoneNumber').fill(PHONE),
      (v) => v.data.phoneNumber === PHONE,
    );
    // Stored exactly as typed: the server validates the E.164 shape but does
    // not rewrite the provider's formatting.
    expect(phoned.data.phoneNumber).toBe(PHONE);
    expect(phoned.version).toBeGreaterThan(named.version);

    const finalized = page.waitForResponse(
      (r) =>
        r.url() === `${REAL_API}/v1/me/provider/onboarding/avatar` &&
        r.request().method() === 'POST',
    );
    await page.getByTestId('avatar-input-gallery').setInputFiles({
      name: 'me.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#1d4ed8'),
    });
    const avatarResponse = await finalized;
    expect(avatarResponse.status(), await avatarResponse.text()).toBe(200);
    const withAvatar = (await avatarResponse.json()) as DraftView;
    shared.avatarUrl = String(withAvatar.data.profileImageUrl);
    expect(shared.avatarUrl).toMatch(/\/avatars\/[0-9a-f]{24}\//);
    expect(withAvatar.version).toBeGreaterThan(phoned.version);

    await leaveAndReturn(page, 'BASICS_IDENTITY');
    await expect(page.getByTestId('field-displayName')).toHaveValue(DISPLAY_NAME);
    await expect(page.getByTestId('field-phoneNumber')).toHaveValue(PHONE);
    await page.reload();
    await expect(page.getByTestId('field-displayName')).toHaveValue(DISPLAY_NAME);
    await expect(page.getByTestId('field-phoneNumber')).toHaveValue(PHONE);
    await expect(page.getByTestId('avatar-preview-image')).toBeVisible();

    const row = await profileRow(shared.account.profileId);
    expect(row).toMatchObject({
      displayName: DISPLAY_NAME,
      phoneNumber: PHONE,
      profileImageUrl: shared.avatarUrl,
      // Server default, never typed by the provider.
      providerType: 'INDIVIDUAL',
    });
    // The avatar is an owner-bound ledger asset, not a trusted URL.
    const asset = await withDb(async (db) => {
      const result = await db.query(
        `SELECT a."ownerUserId" = p."userId" AS owned, a.visibility, a."uploadCompletedAt", a."deletedAt"
           FROM "MediaAsset" a, "ProviderProfile" p
          WHERE p.id = $1 AND $2 LIKE '%' || a."storageKey"`,
        [shared.account.profileId, shared.avatarUrl],
      );
      return result.rows[0];
    });
    expect(asset).toMatchObject({ owned: true, visibility: 'PUBLIC', deletedAt: null });
    expect(asset.uploadCompletedAt).not.toBeNull();
  });

  test('SERVICES_EXPERIENCE: specialties, years of experience and transport', async () => {
    await openTask(page, 'SERVICES_EXPERIENCE');
    const choices = page.locator('[data-testid^="specialty-choice-"]');
    await expect(choices.first()).toBeVisible();
    const offered = await choices.evaluateAll((nodes) =>
      nodes.map((n) => (n.getAttribute('data-testid') ?? '').replace('specialty-choice-', '')),
    );
    expect(offered.length).toBeGreaterThanOrEqual(2);
    shared.specialtyIds = offered.slice(0, 2);

    const selected = await acknowledged(
      page,
      'SPECIALTIES',
      async () => {
        for (const id of shared.specialtyIds)
          await page.getByTestId(`specialty-choice-${id}`).click();
      },
      (v) =>
        shared.specialtyIds.every((id) => (v.data.pendingSpecialtyIds as string[]).includes(id)),
    );
    // A selection is an APPLICATION. It is acknowledged as pending and grants
    // nothing until an administrator approves it.
    expect(selected.data.specialtyLeafIds).toEqual([]);
    expect(selected.data.primarySpecialtyId).toBe(shared.specialtyIds[0]);

    await openTask(page, 'SERVICES_EXPERIENCE', '#experience');
    const thisYear = new Date().getUTCFullYear();
    const experienced = await acknowledged(
      page,
      'EXPERIENCE',
      async () => {
        for (let i = 0; i < YEARS; i += 1)
          await page.getByTestId('experience-years-increase').click();
      },
      (v) => new Date(String(v.data.professionSince)).getUTCFullYear() === thisYear - YEARS,
    );
    expect(experienced.data.professionSince).toBe(`${thisYear - YEARS}-01-01T00:00:00.000Z`);

    const mobile = await acknowledged(
      page,
      'EXPERIENCE',
      async () => {
        for (const mode of TRANSPORT) await page.getByTestId(`transport-${mode}`).click();
      },
      (v) => TRANSPORT.every((mode) => (v.data.transportModes as string[]).includes(mode)),
    );
    expect([...(mobile.data.transportModes as string[])].sort()).toEqual([...TRANSPORT].sort());

    await leaveAndReturn(page, 'SERVICES_EXPERIENCE', '#experience');
    await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));
    await page.reload();
    await expect(page.getByTestId('experience-years-value')).toHaveText(String(YEARS));
    for (const mode of TRANSPORT) {
      await expect(page.getByTestId(`transport-${mode}`)).toHaveAttribute('data-checked', 'true');
    }

    const row = await profileRow(shared.account.profileId);
    expect(row.professionSinceUtc).toBe(`${thisYear - YEARS}-01-01T00:00:00.000Z`);
    expect([...(row.transportModeList as string[])].sort()).toEqual([...TRANSPORT].sort());
    expect(row.primaryServiceCategoryId).toBe(shared.specialtyIds[0]);
    const applications = await withDb(async (db) => {
      const result = await db.query(
        `SELECT "serviceCategoryId", status FROM "ProviderCategoryApplication" WHERE "providerProfileId" = $1`,
        [shared.account.profileId],
      );
      return result.rows as Array<{ serviceCategoryId: string; status: string }>;
    });
    expect(applications.map((a) => a.serviceCategoryId).sort()).toEqual(
      [...shared.specialtyIds].sort(),
    );
    expect(applications.every((a) => a.status === 'PENDING')).toBe(true);
    // Nothing was granted by selecting.
    const granted = await withDb(async (db) => {
      const result = await db.query(
        `SELECT count(*)::int AS n FROM "ProviderProfileServiceCategory" WHERE "providerProfileId" = $1`,
        [shared.account.profileId],
      );
      return result.rows[0].n as number;
    });
    expect(granted).toBe(0);
  });

  test('WORK_AREA: country, city, map point and the server-derived radius', async () => {
    await openTask(page, 'WORK_AREA');

    const market = page.getByTestId('market-select');
    await expect(market).toBeVisible();
    const located = await acknowledged(
      page,
      'LOCATION',
      () => market.selectOption('SY').then(() => undefined),
      (v) => v.data.serviceAreaCountryCode === 'SY',
    );
    shared.countryCode = String(located.data.serviceAreaCountryCode);

    const citied = await acknowledged(
      page,
      'LOCATION',
      async () => {
        await page.getByTestId('service-area-city').fill(CITY);
        await page.getByTestId('service-area-city').blur();
      },
      (v) => v.data.serviceAreaCity === CITY,
    );
    expect(citied.data.serviceAreaCity).toBe(CITY);

    const surface = page.getByTestId('service-area-map').locator('.leaflet-container');
    await expect(surface).toBeVisible();
    const box = await surface.boundingBox();
    expect(box).not.toBeNull();
    const pinned = await acknowledged(
      page,
      'LOCATION',
      () => page.mouse.click(box!.x + box!.width / 2 + 20, box!.y + box!.height / 2 + 12),
      (v) => typeof v.data.serviceAreaLat === 'number' && typeof v.data.serviceAreaLng === 'number',
    );
    shared.lat = pinned.data.serviceAreaLat as number;
    shared.lng = pinned.data.serviceAreaLng as number;
    // Choosing a point does not silently rewrite the city the provider typed.
    expect(pinned.data.serviceAreaCity).toBe(CITY);

    // The radius has no control on this screen: it is a server policy value.
    await expect
      .poll(async () => (await draftOf(shared.account)).data.serviceAreaRadiusKm)
      .toEqual(expect.any(Number));
    const settled = await draftOf(shared.account);
    shared.radiusKm = settled.data.serviceAreaRadiusKm as number;
    shared.timezone = String(settled.data.timezone ?? '');

    await leaveAndReturn(page, 'WORK_AREA');
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
    await page.reload();
    await expect(page.getByTestId('service-area-city')).toHaveValue(CITY);
    // Settled, so not asked again; the value itself is read from the API and
    // the row below.
    await expect(page.getByTestId('market-picker')).toHaveCount(0);
    expect((await draftOf(shared.account)).data.serviceAreaCountryCode).toBe('SY');
    await expect(page.locator('.pv-service-area-pin')).toBeVisible();

    const row = await profileRow(shared.account.profileId);
    expect(row).toMatchObject({
      serviceAreaCity: CITY,
      // The match key is the documented normalisation: trimmed and lower-cased.
      serviceAreaCityKey: CITY.trim().toLowerCase(),
      serviceAreaCountryCode: 'SY',
      serviceAreaLat: shared.lat,
      serviceAreaLng: shared.lng,
      serviceAreaRadiusKm: shared.radiusKm,
    });
  });

  test('WORKING_HOURS: the weekly schedule and its timezone', async () => {
    await openTask(page, 'WORKING_HOURS');
    await expect(page.getByTestId('availability-task')).toBeVisible();

    const scheduled = await acknowledged(
      page,
      'AVAILABILITY',
      async () => {
        for (const day of DAYS) await page.getByTestId(`day-toggle-${day}`).click();
        await page.getByTestId('bulk-start').fill(START);
        await page.getByTestId('bulk-end').fill(END);
        await page.getByTestId('apply-to-selected').click();
      },
      (v) => (v.data.availability ?? []).length === DAYS.length,
    );
    expect(weekOf(scheduled)).toEqual(expectedWeek());
    shared.timezone = String(scheduled.data.timezone);
    expect(shared.timezone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);

    await leaveAndReturn(page, 'WORKING_HOURS');
    await page.reload();
    await expect(page.getByTestId('task-screen-WORKING_HOURS')).toBeVisible();
    for (const day of DAYS) {
      await expect(page.getByTestId(`day-toggle-${day}`)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByTestId('bulk-start')).toHaveValue(START);
    await expect(page.getByTestId('bulk-end')).toHaveValue(END);

    const rows = await withDb(async (db) => {
      const result = await db.query(
        `SELECT "dayOfWeek", "startMinute", "endMinute", timezone
           FROM "ProviderAvailabilityInterval" WHERE "providerProfileId" = $1 ORDER BY "dayOfWeek"`,
        [shared.account.profileId],
      );
      return result.rows as Array<Record<string, unknown>>;
    });
    expect(rows).toEqual(expectedWeek().map((w) => ({ ...w, timezone: shared.timezone })));
  });

  test('PORTFOLIO: bio, generated title and a portfolio photo', async () => {
    await openTask(page, 'PORTFOLIO');

    const described = await acknowledged(
      page,
      'PROFILE',
      () => page.getByTestId('bio-input').fill(BIO),
      (v) => v.data.bio === BIO,
    );
    expect(described.data.bio).toBe(BIO);
    // The title is generated by the server from the primary specialty.
    shared.headline = String(described.data.headline);
    expect(shared.headline.length).toBeGreaterThanOrEqual(2);

    await openTask(page, 'PORTFOLIO', '#portfolio');
    const created = page.waitForResponse(
      (r) => r.url() === `${REAL_API}/v1/me/provider/portfolio` && r.request().method() === 'POST',
    );
    await page.getByTestId('portfolio-file-input').setInputFiles({
      name: 'job.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(page, '#15803d'),
    });
    const consent = page.getByTestId('portfolio-consent');
    await expect(consent).toBeVisible();
    await consent.getByRole('checkbox').check();
    await page.getByTestId('portfolio-consent-agree').click();
    const createdResponse = await created;
    expect(createdResponse.status(), await createdResponse.text()).toBe(200);
    shared.portfolioItemId = ((await createdResponse.json()) as { id: string }).id;

    await leaveAndReturn(page, 'PORTFOLIO');
    await expect(page.getByTestId('bio-input')).toHaveValue(BIO);
    await page.reload();
    await expect(page.getByTestId('bio-input')).toHaveValue(BIO);
    await openTask(page, 'PORTFOLIO', '#portfolio');
    await expect(page.getByTestId(`portfolio-reorder-${shared.portfolioItemId}`)).toBeVisible();

    const row = await profileRow(shared.account.profileId);
    expect(row).toMatchObject({ bio: BIO, headline: shared.headline });
    const item = await withDb(async (db) => {
      const result = await db.query(
        `SELECT i.position, i."deletedAt", i."publicationRightAckAt", i."moderationState",
                a."ownerUserId" = p."userId" AS owned, a."uploadCompletedAt"
           FROM "ProviderPortfolioItem" i
           JOIN "MediaAsset" a ON a.id = i."mediaAssetId"
           JOIN "ProviderProfile" p ON p.id = i."providerProfileId"
          WHERE i.id = $1 AND i."providerProfileId" = $2`,
        [shared.portfolioItemId, shared.account.profileId],
      );
      return result.rows[0];
    });
    expect(item).toMatchObject({
      position: 0,
      deletedAt: null,
      owned: true,
      moderationState: 'PENDING',
    });
    expect(item.publicationRightAckAt).not.toBeNull();
    expect(item.uploadCompletedAt).not.toBeNull();
  });

  test('every field survives a fresh login in a clean browser, and matches PostgreSQL', async ({
    browser,
  }) => {
    // The server's own account of every field, read by an independent client.
    const before = await expectAllFieldsFromApi(shared.account);

    // A browser that shares nothing with the one that wrote the values.
    const fresh = await (browser as Browser).newContext();
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/provider/onboarding/BASICS_IDENTITY`);
      await expect(freshPage).toHaveURL(/\/login/);
      await loginViaUi(freshPage, shared.account);
      await expect(freshPage).toHaveURL(/\/provider\/onboarding\/BASICS_IDENTITY$/, {
        timeout: 60_000,
      });
      await expectBuildFlagOnly(freshPage);
      await expectAllFieldsOnScreen(freshPage);
      await expectBuildFlagOnly(freshPage);
    } finally {
      await fresh.close();
    }

    // Reading back did not write anything.
    const after = await draftOf(shared.account);
    expect(after.version).toBe(before.version);

    const row = await profileRow(shared.account.profileId);
    expect(row).toMatchObject({
      displayName: DISPLAY_NAME,
      phoneNumber: PHONE,
      profileImageUrl: shared.avatarUrl,
      serviceAreaCity: CITY,
      serviceAreaCountryCode: shared.countryCode,
      serviceAreaLat: shared.lat,
      serviceAreaLng: shared.lng,
      serviceAreaRadiusKm: shared.radiusKm,
      bio: BIO,
      headline: shared.headline,
      primaryServiceCategoryId: shared.specialtyIds[0],
    });
  });

  test('REVIEW_SUBMISSION: consent and submission, which grant no work access', async () => {
    // A different actor: an administrator approves the specialty applications.
    await approveCategoriesFor(shared.account);

    await openTask(page, 'REVIEW_SUBMISSION');
    await expect(page.getByTestId('review-screen')).toBeVisible();
    await page.getByTestId('review-continue-to-consent').click();
    await expect(page.getByTestId('terms-section')).toBeVisible();
    await expect(page.getByTestId('review-submit')).toBeDisabled();

    const consented = page.waitForResponse(isStepWrite('CONSENT'));
    await page.getByTestId('terms-accept').click();
    const consentResponse = await consented;
    expect(consentResponse.status(), await consentResponse.text()).toBe(200);
    const consentView = (await consentResponse.json()) as DraftView;
    shared.consentVersion = String(consentView.data.acceptedConsentVersion);
    expect(shared.consentVersion.length).toBeGreaterThan(0);
    await expect(page.getByTestId('terms-accepted')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('terms-accepted')).toBeVisible();
    const consentRow = await profileRow(shared.account.profileId);
    expect(consentRow.acceptedConsentVersion).toBe(shared.consentVersion);
    expect(consentRow.consentAcceptedAt).not.toBeNull();
    // Consent alone submits nothing.
    expect(consentRow.submittedForReviewAt).toBeNull();

    await expect(page.getByTestId('review-submit')).toBeEnabled({ timeout: 30_000 });
    const submitted = page.waitForResponse(
      (r) =>
        r.url() === `${REAL_API}/v1/me/provider/onboarding/submit` &&
        r.request().method() === 'POST',
    );
    await page.getByTestId('review-submit').click();
    const submitResponse = await submitted;
    expect(submitResponse.status(), await submitResponse.text()).toBe(200);
    const submittedView = (await submitResponse.json()) as DraftView;
    expect(submittedView.editable).toBe(false);

    await page.reload();
    await expect(page.getByTestId('review-submit')).toHaveCount(0);

    const row = await profileRow(shared.account.profileId);
    expect(row.submittedForReviewAt).not.toBeNull();
    expect(row.status).toBe('PENDING_REVIEW');
    expect(row.onboardingState).toBe(submittedView.state);
    const submission = await withDb(async (db) => {
      const result = await db.query(
        `SELECT count(*)::int AS n FROM "ProviderOnboardingSubmission" WHERE "providerProfileId" = $1`,
        [shared.account.profileId],
      );
      return result.rows[0].n as number;
    });
    expect(submission).toBe(1);

    // The submitted values are exactly the ones acknowledged earlier.
    await expectAllFieldsFromApi(shared.account);

    // Onboarding complete is not approval, and approval is not work access.
    expect(row.status).not.toBe('ACTIVE');
    for (const path of ['/v1/provider/available-requests', '/v1/provider/bids']) {
      const denied = await api(shared.account.jar, path);
      expect(denied.status, `${path} must stay closed to a submitted provider`).toBe(403);
    }
    // And a submitted application can no longer be edited.
    const locked = await api(shared.account.jar, '/v1/me/provider/onboarding/steps/PROFILE', {
      method: 'PATCH',
      body: {
        version: submittedView.version,
        bio: 'changed after submission, which is not allowed',
      },
    });
    expect(locked.status).toBe(409);
    expect((await profileRow(shared.account.profileId)).bio).toBe(BIO);
  });
});

// ─── Authority under failure ────────────────────────────────────────────────
//
// The journey above proves the happy path of every field. These prove that the
// server stays the authority when something goes wrong: a stale tab, a dead
// connection, a response that never arrives, a lost session, another account,
// and input at or past a limit. Each test owns its provider.
//
// One test drops a RESPONSE on purpose. The request is forwarded to the real
// API untouched and really commits; only the reply is discarded on its way
// back. No request, response body or flag is ever fabricated.

const STEP_URL = (step: string) => `${REAL_API}/v1/me/provider/onboarding/steps/${step}`;

async function signedInPage(
  browser: Browser,
  account: Account,
  lang: 'en' | 'ar' = 'en',
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await applySession(context, account);
  const page = await context.newPage();
  await seedLanguage(page, lang);
  return { context, page };
}

const saveStatus = (page: Page) => page.getByTestId('task-save-status');

test.describe('R08 Provider V2 field authority under failure — real services', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R08 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  test('a stale second tab cannot overwrite a newer write, and recovers by reloading', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const context = await browser.newContext();
    await applySession(context, account);
    try {
      const tabA = await context.newPage();
      const tabB = await context.newPage();
      await seedLanguage(tabA, 'en');
      await seedLanguage(tabB, 'en');
      // Both tabs load the same revision of the application.
      await openTask(tabA, 'BASICS_IDENTITY');
      await openTask(tabB, 'BASICS_IDENTITY');
      await expect(tabA.getByTestId('field-displayName')).toBeEditable();
      await expect(tabB.getByTestId('field-displayName')).toBeEditable();

      const first = await acknowledged(
        tabA,
        'IDENTITY',
        () => tabA.getByTestId('field-displayName').fill('Written In Tab A'),
        (v) => v.data.displayName === 'Written In Tab A',
      );

      // Tab B still holds the revision from before that write.
      const refused = tabB.waitForResponse(isStepWrite('IDENTITY'));
      await tabB.getByTestId('field-displayName').fill('Stale From Tab B');
      const refusedResponse = await refused;
      expect(refusedResponse.status()).toBe(409);
      const conflict = (await refusedResponse.json()) as {
        error?: {
          code?: string;
          details?: { expectedVersion?: number; receivedVersion?: number };
        };
      };
      expect(conflict.error?.code).toBe('CONFLICT');
      expect(conflict.error?.details?.expectedVersion).toBe(first.version);
      expect(conflict.error?.details?.receivedVersion).toBeLessThan(first.version);

      // The provider is told, in words, and never told "Saved".
      await expect(saveStatus(tabB)).toHaveAttribute('data-status', 'conflict');
      await expect(saveStatus(tabB)).toContainText('changed somewhere else');
      await expect(saveStatus(tabB)).not.toContainText('Saved');

      // The stale edit did not land, and did not advance the revision.
      expect((await profileRow(account.profileId)).displayName).toBe('Written In Tab A');
      expect((await draftOf(account)).version).toBe(first.version);

      // Reloading shows the current answer, and the tab can write again.
      await tabB.reload();
      await expect(tabB.getByTestId('field-displayName')).toHaveValue('Written In Tab A');
      const recovered = await acknowledged(
        tabB,
        'IDENTITY',
        () => tabB.getByTestId('field-displayName').fill('Fresh From Tab B'),
        (v) => v.data.displayName === 'Fresh From Tab B',
      );
      expect(recovered.version).toBeGreaterThan(first.version);
      expect((await profileRow(account.profileId)).displayName).toBe('Fresh From Tab B');
    } finally {
      await context.close();
    }
  });

  test('an offline edit is never called saved, and is written once the connection returns', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openTask(page, 'BASICS_IDENTITY');
      await expect(page.getByTestId('field-displayName')).toBeEditable();
      const before = await draftOf(account);

      await context.setOffline(true);
      await page.getByTestId('field-displayName').fill('Typed While Offline');
      await expect(saveStatus(page)).toHaveAttribute('data-status', 'offline', { timeout: 15_000 });
      await expect(saveStatus(page)).toContainText('Keep this page open');
      // Nothing reached the server.
      expect((await draftOf(account)).version).toBe(before.version);
      expect((await profileRow(account.profileId)).displayName).not.toBe('Typed While Offline');

      const landed = page.waitForResponse(isStepWrite('IDENTITY'));
      await context.setOffline(false);
      const landedResponse = await landed;
      expect(landedResponse.status()).toBe(200);
      await expect(saveStatus(page)).toHaveAttribute('data-status', /saved|persisted/);

      const after = await draftOf(account);
      expect(after.data.displayName).toBe('Typed While Offline');
      // Written exactly once.
      expect(after.version).toBe(before.version + 1);
      expect((await profileRow(account.profileId)).displayName).toBe('Typed While Offline');
    } finally {
      await context.close();
    }
  });

  test('a write whose response is lost is not duplicated and is not misreported', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openTask(page, 'BASICS_IDENTITY');
      await expect(page.getByTestId('field-displayName')).toBeEditable();
      const before = await draftOf(account);

      // The request goes to the real API and commits. Its reply is dropped.
      let dropped = 0;
      await page.route(STEP_URL('IDENTITY'), async (route) => {
        if (route.request().method() !== 'PATCH' || dropped > 0) return route.continue();
        const real = await route.fetch();
        dropped = real.status();
        await route.abort('connectionreset');
      });

      await page.getByTestId('field-displayName').fill('Reply Never Arrived');
      await expect.poll(() => dropped, { timeout: 15_000 }).toBe(200);

      // The server has it; the browser does not know, and must not say "Saved".
      await expect(saveStatus(page)).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
      const committed = await draftOf(account);
      expect(committed.data.displayName).toBe('Reply Never Arrived');
      expect(committed.version).toBe(before.version + 1);

      // Trying again presents the revision the browser still holds. The server
      // refuses it rather than applying the write a second time.
      const retried = page.waitForResponse(isStepWrite('IDENTITY'));
      await page.getByTestId('task-save-retry').click();
      expect((await retried).status()).toBe(409);
      await expect(saveStatus(page)).toHaveAttribute('data-status', 'conflict');
      expect((await draftOf(account)).version).toBe(before.version + 1);

      // Reloading reconciles: the answer is there, once.
      await page.unroute(STEP_URL('IDENTITY'));
      await page.reload();
      await expect(page.getByTestId('field-displayName')).toHaveValue('Reply Never Arrived');
      expect((await profileRow(account.profileId)).displayName).toBe('Reply Never Arrived');
    } finally {
      await context.close();
    }
  });

  test('an edit made after the session is lost is refused and is not written', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openTask(page, 'BASICS_IDENTITY');
      const saved = await acknowledged(
        page,
        'IDENTITY',
        () => page.getByTestId('field-displayName').fill('Before Session Loss'),
        (v) => v.data.displayName === 'Before Session Loss',
      );

      // The session ends: every cookie is gone, as after a sign-out elsewhere.
      await context.clearCookies();
      const refused = page.waitForResponse(isStepWrite('IDENTITY'));
      await page.getByTestId('field-displayName').fill('After Session Loss');
      expect([401, 403]).toContain((await refused).status());

      // The provider is sent to sign in; nothing was written.
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      expect((await profileRow(account.profileId)).displayName).toBe('Before Session Loss');
      expect((await draftOf(account)).version).toBe(saved.version);

      // Signing in again shows the server's answer, not the refused edit.
      await loginViaUi(page, account);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
      await openTask(page, 'BASICS_IDENTITY');
      await expect(page.getByTestId('field-displayName')).toHaveValue('Before Session Loss');
    } finally {
      await context.close();
    }
  });

  test('one provider can neither see nor change the application of another', async ({
    browser,
  }) => {
    const owner = await registerProvider();
    const other = await registerProvider();

    const ownerDraft = await draftOf(owner);
    const written = await api<DraftView>(owner.jar, '/v1/me/provider/onboarding/steps/IDENTITY', {
      method: 'PATCH',
      body: {
        version: ownerDraft.version,
        displayName: 'Owner Only Name',
        phoneNumber: '+963944000111',
      },
    });
    expect(written.status).toBe(200);
    const ownerItemId = await addPortfolioPhoto(owner.jar, 'Owner photo');

    // The other provider's own browser shows their own application.
    const { context, page } = await signedInPage(browser, other);
    try {
      await openTask(page, 'BASICS_IDENTITY');
      await expect(page.getByTestId('field-displayName')).toBeEditable();
      await expect(page.getByTestId('field-displayName')).not.toHaveValue('Owner Only Name');
      await expect(page.getByTestId('field-phoneNumber')).toHaveValue('');
      await openTask(page, 'PORTFOLIO', '#portfolio');
      await expect(page.getByTestId('portfolio-add-photo')).toBeVisible();
      await expect(page.getByTestId(`portfolio-reorder-${ownerItemId}`)).toHaveCount(0);
    } finally {
      await context.close();
    }

    const otherDraft = await draftOf(other);
    expect(otherDraft.data.displayName).not.toBe('Owner Only Name');
    expect(otherDraft.data.phoneNumber ?? null).toBeNull();

    // Addressing the owner's portfolio item by id gets nowhere.
    for (const attempt of [
      { method: 'DELETE', body: undefined },
      { method: 'PATCH', body: { title: 'taken over' } },
    ]) {
      const res = await api(other.jar, `/v1/me/provider/portfolio/${ownerItemId}`, attempt);
      expect([403, 404], `${attempt.method} on another provider's item`).toContain(res.status);
    }
    // Nor can the owner's stored photo be claimed as the other's avatar.
    const ownerKey = await withDb(async (db) => {
      const result = await db.query(
        `SELECT a."storageKey" FROM "ProviderPortfolioItem" i
           JOIN "MediaAsset" a ON a.id = i."mediaAssetId" WHERE i.id = $1`,
        [ownerItemId],
      );
      return result.rows[0].storageKey as string;
    });
    const claimed = await api(other.jar, '/v1/me/provider/onboarding/avatar', {
      method: 'POST',
      body: { key: ownerKey, version: otherDraft.version },
    });
    expect(claimed.status).toBeGreaterThanOrEqual(400);
    expect(claimed.status).toBeLessThan(500);

    // The owner's rows are exactly as the owner left them.
    expect(await profileRow(owner.profileId)).toMatchObject({
      displayName: 'Owner Only Name',
      phoneNumber: '+963944000111',
    });
    const item = await withDb(async (db) => {
      const result = await db.query(
        `SELECT "providerProfileId", "deletedAt", title FROM "ProviderPortfolioItem" WHERE id = $1`,
        [ownerItemId],
      );
      return result.rows[0];
    });
    expect(item).toMatchObject({ providerProfileId: owner.profileId, deletedAt: null });
    expect(item.title).not.toBe('taken over');
    expect((await profileRow(other.profileId)).profileImageUrl).toBeNull();
    expect((await draftOf(other)).version).toBe(otherDraft.version);
  });

  test('Arabic, mixed and limit-length input is stored as documented; over-limit input is refused', async ({
    browser,
  }) => {
    const account = await registerProvider();
    const { context, page } = await signedInPage(browser, account, 'ar');
    try {
      await openTask(page, 'BASICS_IDENTITY');
      await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');

      // Exactly at the 80-character limit, Arabic and Latin mixed.
      const atLimit = ('م. عبد الرحمن Al-Khatib ' + 'ك'.repeat(80)).slice(0, 80);
      expect(atLimit).toHaveLength(80);
      const named = await acknowledged(
        page,
        'IDENTITY',
        // Surrounding whitespace is typed on purpose: the server trims it.
        () => page.getByTestId('field-displayName').fill(`  ${atLimit}  `),
        (v) => v.data.displayName === atLimit,
      );
      expect((await profileRow(account.profileId)).displayName).toBe(atLimit);

      // One character more is refused, said so, and changes nothing.
      const refused = page.waitForResponse(isStepWrite('IDENTITY'));
      await page.getByTestId('field-displayName').fill(`${atLimit}ي`);
      expect((await refused).status()).toBe(400);
      await expect(saveStatus(page)).toHaveAttribute('data-status', 'error');
      expect((await profileRow(account.profileId)).displayName).toBe(atLimit);
      expect((await draftOf(account)).version).toBe(named.version);

      await page.reload();
      await expect(page.getByTestId('field-displayName')).toHaveValue(atLimit);

      // A phone number that is not international is never sent.
      const versionBeforePhone = (await draftOf(account)).version;
      await page.getByTestId('field-phoneNumber').fill('0944 123');
      await page.getByTestId('field-phoneNumber').blur();
      await expect(page.getByText('أدخل رقم هاتف بصيغة دولية تبدأ بعلامة +.')).toBeVisible();
      await expect
        .poll(async () => (await draftOf(account)).version, { timeout: 4_000, intervals: [3_000] })
        .toBe(versionBeforePhone);
      expect((await profileRow(account.profileId)).phoneNumber).toBeNull();

      // The city keeps its spelling; the matching key is trimmed and lower-cased.
      await openTask(page, 'WORK_AREA');
      const typedCity = '  Rif Dimashq – ريف دمشق  ';
      const citied = await acknowledged(
        page,
        'LOCATION',
        async () => {
          await page.getByTestId('service-area-city').fill(typedCity);
          await page.getByTestId('service-area-city').blur();
        },
        (v) => v.data.serviceAreaCity === typedCity.trim(),
      );
      expect(citied.data.serviceAreaCity).toBe(typedCity.trim());
      expect(await profileRow(account.profileId)).toMatchObject({
        serviceAreaCity: typedCity.trim(),
        serviceAreaCityKey: typedCity.trim().toLowerCase(),
      });

      // A 2000-character bio, Arabic and English, a line break included.
      await openTask(page, 'PORTFOLIO');
      const longBio = (
        'خبرة في الصيانة المنزلية.\nHome maintenance, done properly. ' + 'ن'.repeat(2000)
      ).slice(0, 2000);
      const described = await acknowledged(
        page,
        'PROFILE',
        () => page.getByTestId('bio-input').fill(longBio),
        (v) => v.data.bio === longBio,
      );
      expect(described.data.bio).toHaveLength(2000);
      await page.reload();
      await expect(page.getByTestId('bio-input')).toHaveValue(longBio);
      expect((await profileRow(account.profileId)).bio).toBe(longBio);
    } finally {
      await context.close();
    }
  });
});
