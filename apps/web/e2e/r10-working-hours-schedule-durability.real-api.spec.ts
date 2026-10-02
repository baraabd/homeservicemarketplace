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
import { api, loginViaUi, REAL_API, registerProvider, type Account } from './real-api';

// R10 — the provider's weekly working hours, proved in a real browser against
// the real API and PostgreSQL.
//
//   schedule screen -> API validation -> one transaction -> rows -> read model
//
// A week is recurring LOCAL wall-clock minutes in one IANA zone. Nothing here
// is an appointment or an instant.
//
// NOTHING IS STUBBED AND NOTHING IS OVERRIDDEN. The bundle was built with
// VITE_PROVIDER_ONBOARDING_V2=true and the browser flag override is asserted
// absent. No response is fabricated. One test discards a real reply on its way
// back; the request itself reaches the real API and commits.
//
// THE EDITOR IS A BULK EDITOR. The approved screen sets ONE window on each
// selected day. It has no control for a second window on a day, so a split
// day cannot be typed there. Split and touching windows are therefore written
// through the real API with the provider's own session and then read by the
// browser; that is said at each place it happens.

// These tests put real session cookies into the browser. A trace or a video
// would carry them into uploaded evidence, so neither is recorded.
test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const FLAG_OVERRIDE_KEY = 'hsm.ff.providerOnboardingV2';
const DRAFT = '/v1/me/provider/onboarding/draft';
const STEP = (step: string) => `/v1/me/provider/onboarding/steps/${step}`;

interface Interval {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}
interface DraftView {
  version: number;
  editable: boolean;
  data: Record<string, unknown> & {
    timezone?: string | null;
    availability?: Array<Interval & { timezone: string }>;
  };
}
interface StoredInterval extends Interval {
  providerProfileId: string;
  timezone: string;
}

const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const win = (dayOfWeek: number, start: string, end: string): Interval => ({
  dayOfWeek,
  startMinute: at(start),
  endMinute: end === '24:00' ? 1440 : at(end),
});

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R10 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** The stored week, straight from PostgreSQL, in the documented order. */
async function storedWeek(profileId: string): Promise<StoredInterval[]> {
  return withDb(async (db) => {
    const result = await db.query(
      `SELECT "providerProfileId", "dayOfWeek", "startMinute", "endMinute", timezone
         FROM "ProviderAvailabilityInterval"
        WHERE "providerProfileId" = $1
        ORDER BY "dayOfWeek", "startMinute"`,
      [profileId],
    );
    return result.rows as StoredInterval[];
  });
}
const rowsFor = (profileId: string, timezone: string, week: Interval[]): StoredInterval[] =>
  [...week]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute)
    .map((i) => ({ providerProfileId: profileId, ...i, timezone }));

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

async function expectBuildFlagOnly(page: Page): Promise<void> {
  const override = await page.evaluate(
    (key) => window.localStorage.getItem(key),
    FLAG_OVERRIDE_KEY,
  );
  expect(override, 'the browser flag override must be absent').toBeNull();
}

async function openHours(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/provider/onboarding/WORKING_HOURS`);
  await expect(page.getByTestId('task-screen-WORKING_HOURS')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('availability-task')).toBeVisible({ timeout: 30_000 });
  await expectBuildFlagOnly(page);
}

const isHoursWrite = (r: Response) =>
  r.url() === `${REAL_API}${STEP('AVAILABILITY')}` && r.request().method() === 'PATCH';

async function draftOf(account: Account): Promise<DraftView> {
  const res = await api<DraftView>(account.jar, DRAFT);
  expect(res.status).toBe(200);
  return res.body;
}

/** Give the provider a market, the way the work-area step does (R09 proves
 *  that screen). Working hours take their zone from it. */
async function chooseMarket(account: Account, countryCode: string): Promise<void> {
  const res = await api(account.jar, STEP('LOCATION'), {
    method: 'PATCH',
    body: { version: (await draftOf(account)).version, serviceAreaCountryCode: countryCode },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A week written through the real API with the provider's own session. */
async function saveWeekByApi(account: Account, week: Interval[]): Promise<DraftView> {
  const res = await api<DraftView>(account.jar, STEP('AVAILABILITY'), {
    method: 'PATCH',
    body: { version: (await draftOf(account)).version, availability: week },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

const dayToggle = (page: Page, day: number) => page.getByTestId(`day-toggle-${day}`);
const summaryDay = (page: Page, day: number) => page.getByTestId(`availability-summary-day-${day}`);
const feedback = (page: Page) => page.getByTestId('availability-apply-feedback');
const saveStatus = (page: Page) => page.getByTestId('task-save-status');

/** Select exactly these days. */
async function selectDays(page: Page, days: readonly number[], touch = false): Promise<void> {
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const pressed = (await dayToggle(page, day).getAttribute('aria-pressed')) === 'true';
    if (pressed !== days.includes(day)) {
      if (touch) await dayToggle(page, day).tap();
      else await dayToggle(page, day).click();
    }
  }
}

/** Set the hours on the screen and press Apply; return the acknowledgement. */
async function applyHours(
  page: Page,
  days: readonly number[],
  start: string,
  end: string,
  touch = false,
): Promise<DraftView> {
  await selectDays(page, days, touch);
  await page.getByTestId('bulk-start').fill(start);
  await page.getByTestId('bulk-end').fill(end);
  const acknowledged = page.waitForResponse(isHoursWrite);
  if (touch) await page.getByTestId('apply-to-selected').tap();
  else await page.getByTestId('apply-to-selected').click();
  // When Apply would replace hours already on a selected day, the screen asks
  // first. Nothing is sent until the provider says yes.
  const confirm = page.getByTestId('apply-discards-confirm');
  const next = await Promise.race([
    acknowledged.then(() => 'acknowledged' as const),
    confirm.waitFor({ state: 'visible' }).then(() => 'asked' as const),
  ]);
  if (next === 'asked') {
    if (touch) await confirm.tap();
    else await confirm.click();
  }
  const response = await acknowledged;
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as DraftView;
}

/** What the on-screen summary says for each day that has hours. */
async function summaryOf(page: Page): Promise<Record<number, string[]>> {
  const out: Record<number, string[]> = {};
  for (const day of [0, 1, 2, 3, 4, 5, 6]) {
    const ranges = await summaryDay(page, day).locator('bdi').allInnerTexts();
    if (ranges.length > 0) out[day] = ranges.map((r) => r.replace(/\s+/g, ''));
  }
  return out;
}
const fmt = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
/** The summary a stored week must produce. */
function expectedSummary(week: Interval[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const i of [...week].sort(
    (a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute,
  )) {
    (out[i.dayOfWeek] ??= []).push(`${fmt(i.startMinute)}–${fmt(i.endMinute)}`);
  }
  return out;
}

// ─── The week, from the screen to the rows and back ─────────────────────────

test.describe.serial('R10 working hours — real browser, API and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R10 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  let account: Account;
  let context: BrowserContext;
  let page: Page;
  const DAYS = [1, 3, 5] as const;
  const WEEK = DAYS.map((d) => win(d, '08:30', '16:45'));

  test.beforeAll(async ({ browser }) => {
    account = await registerProvider();
    await chooseMarket(account, 'SY');
    ({ context, page } = await signedInPage(browser, account));
  });
  test.afterAll(async () => {
    await context?.close();
  });

  /** Read the stored week back in a browser that shares nothing with this one. */
  async function inAFreshBrowser(browser: Browser, check: (fresh: Page) => Promise<void>) {
    const before = await draftOf(account);
    const fresh = await browser.newContext();
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/provider/onboarding/WORKING_HOURS`);
      await expect(freshPage).toHaveURL(/\/login/);
      await loginViaUi(freshPage, account);
      await expect(freshPage).toHaveURL(/\/provider\/onboarding\/WORKING_HOURS$/, {
        timeout: 60_000,
      });
      await expect(freshPage.getByTestId('availability-task')).toBeVisible({ timeout: 30_000 });
      await expectBuildFlagOnly(freshPage);
      await check(freshPage);
    } finally {
      await fresh.close();
    }
    // Reading back wrote nothing.
    expect((await draftOf(account)).version).toBe(before.version);
  }

  test('a new schedule starts empty: no default hours are stored or implied', async () => {
    await openHours(page);
    expect(await storedWeek(account.profileId)).toEqual([]);
    expect((await draftOf(account)).data.availability).toEqual([]);
    expect(await summaryOf(page)).toEqual({});
    await expect(page.getByTestId('availability-week-summary')).toContainText('No hours set yet.');
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await expect(dayToggle(page, day)).toHaveAttribute('aria-pressed', 'false');
    }
    // Opening the screen wrote nothing.
    expect(await storedWeek(account.profileId)).toEqual([]);
  });

  test('a multi-day week: screen, acknowledgement, rows, summary, reload and fresh login agree', async ({
    browser,
  }) => {
    const acknowledged = await applyHours(page, DAYS, '08:30', '16:45');
    expect(
      acknowledged.data.availability!.map(({ dayOfWeek, startMinute, endMinute }) => ({
        dayOfWeek,
        startMinute,
        endMinute,
      })),
    ).toEqual(WEEK);
    expect(acknowledged.data.timezone).toBe('Asia/Damascus');

    // The rows are exactly the acknowledged week, in the market's zone.
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', WEEK),
    );

    await expect(feedback(page)).toContainText('Working hours applied and saved.');
    expect(await summaryOf(page)).toEqual(expectedSummary(WEEK));
    // Three days of 8 h 15 min.
    await expect(page.getByTestId('availability-week-summary')).toContainText(
      '3 days · 24.75 hours',
    );
    await expect(page.getByTestId('availability-week-summary')).toContainText('Damascus');

    // Leave and come back.
    await page.getByTestId('onboarding-v2-close').click();
    await expect(page.getByTestId('hub-task-list')).toBeVisible({ timeout: 30_000 });
    await openHours(page);
    expect(await summaryOf(page)).toEqual(expectedSummary(WEEK));

    // Hard reload.
    await page.reload();
    await expect(page.getByTestId('availability-task')).toBeVisible();
    expect(await summaryOf(page)).toEqual(expectedSummary(WEEK));
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      await expect(dayToggle(page, day)).toHaveAttribute(
        'aria-pressed',
        String((DAYS as readonly number[]).includes(day)),
      );
    }
    await expect(page.getByTestId('bulk-start')).toHaveValue('08:30');
    await expect(page.getByTestId('bulk-end')).toHaveValue('16:45');

    await inAFreshBrowser(browser, async (fresh) => {
      expect(await summaryOf(fresh)).toEqual(expectedSummary(WEEK));
      await expect(fresh.getByTestId('availability-week-summary')).toContainText(
        '3 days · 24.75 hours',
      );
      await expect(fresh.getByTestId('bulk-start')).toHaveValue('08:30');
    });
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', WEEK),
    );
  });

  test('saving the same week again stores it once', async () => {
    await openHours(page);
    await applyHours(page, DAYS, '08:30', '16:45');
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', WEEK),
    );
  });

  test('hours that end at midnight are stored as 1440 and read back as the end of the day', async () => {
    await openHours(page);
    // "To 00:00" is how the screen says "until the end of the day".
    const acknowledged = await applyHours(page, [5], '22:00', '00:00');
    expect(acknowledged.data.availability).toMatchObject([
      { dayOfWeek: 5, startMinute: 1320, endMinute: 1440 },
    ]);
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', [win(5, '22:00', '24:00')]),
    );
    expect(await summaryOf(page)).toEqual({ 5: ['22:00–24:00'] });

    await page.reload();
    await expect(page.getByTestId('availability-task')).toBeVisible();
    expect(await summaryOf(page)).toEqual({ 5: ['22:00–24:00'] });
    // Not turned into "ends at 00:00 the same day".
    await expect(page.getByTestId('bulk-start')).toHaveValue('22:00');
    await expect(page.getByTestId('bulk-end')).toHaveValue('00:00');
    expect((await storedWeek(account.profileId))[0].endMinute).toBe(1440);
  });

  test('a single window that runs past midnight is refused on the screen and by the server', async () => {
    await openHours(page);
    const before = await storedWeek(account.profileId);
    const version = (await draftOf(account)).version;

    await selectDays(page, [5]);
    await page.getByTestId('bulk-start').fill('22:00');
    await page.getByTestId('bulk-end').fill('02:00');
    await page.getByTestId('apply-to-selected').click();
    await expect(page.getByTestId('availability-rejected')).toContainText(
      'A shift running past midnight is two periods, on two days.',
    );
    // Nothing was sent.
    await expect
      .poll(async () => (await draftOf(account)).version, { timeout: 4_000, intervals: [3_000] })
      .toBe(version);

    // The server refuses the same thing when it is sent directly.
    const direct = await api<{ error?: { details?: { availability?: Array<{ code: string }> } } }>(
      account.jar,
      STEP('AVAILABILITY'),
      {
        method: 'PATCH',
        body: { version, availability: [{ dayOfWeek: 5, startMinute: 1320, endMinute: 120 }] },
      },
    );
    expect(direct.status).toBe(422);
    expect(direct.body.error?.details?.availability?.[0]?.code).toBe('END_NOT_AFTER_START');
    expect(await storedWeek(account.profileId)).toEqual(before);
  });

  test('a split day, touching windows and an off-grid minute are stored and shown exactly', async ({
    browser,
  }) => {
    // The bulk editor cannot enter these, so the provider's own session writes
    // them through the real API; the browser then has to show them truthfully.
    const week = [
      win(1, '09:00', '12:00'),
      win(1, '13:00', '17:00'),
      win(2, '09:00', '12:00'),
      win(2, '12:00', '15:00'),
      win(4, '09:07', '16:53'),
      win(5, '22:00', '24:00'),
      win(6, '00:00', '02:00'),
    ];
    const refused = await api<{ error?: { details?: { availability?: Array<{ code: string }> } } }>(
      account.jar,
      STEP('AVAILABILITY'),
      {
        method: 'PATCH',
        body: {
          version: (await draftOf(account)).version,
          availability: [win(1, '09:00', '13:00'), win(1, '12:00', '15:00')],
        },
      },
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error?.details?.availability?.[0]?.code).toBe('OVERLAP');

    await saveWeekByApi(account, week);
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', week),
    );

    await openHours(page);
    expect(await summaryOf(page)).toEqual(expectedSummary(week));
    // Five days have hours, however many windows each has:
    // 3 + 4 + 3 + 3 + 7.77 + 2 + 2 = 24.77 hours.
    await expect(page.getByTestId('availability-week-summary')).toContainText(
      '5 days · 24.77 hours',
    );

    await page.reload();
    await expect(page.getByTestId('availability-task')).toBeVisible();
    expect(await summaryOf(page)).toEqual(expectedSummary(week));
    await inAFreshBrowser(browser, async (fresh) => {
      expect(await summaryOf(fresh)).toEqual(expectedSummary(week));
    });
    // Reading it did not round 09:07 or merge the touching windows.
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', week),
    );

    // Applying one window over a split day asks first, and "no" writes nothing.
    const version = (await draftOf(account)).version;
    await selectDays(page, [1]);
    await page.getByTestId('bulk-start').fill('10:00');
    await page.getByTestId('bulk-end').fill('11:00');
    await page.getByTestId('apply-to-selected').click();
    await expect(page.getByTestId('apply-discards')).toBeVisible();
    await page.getByTestId('apply-discards-cancel').click();
    await expect(page.getByTestId('apply-discards')).toHaveCount(0);
    await expect
      .poll(async () => (await draftOf(account)).version, { timeout: 4_000, intervals: [3_000] })
      .toBe(version);
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', week),
    );
  });

  test('an empty week is stored as no rows and stays empty after reload and fresh login', async ({
    browser,
  }) => {
    await saveWeekByApi(account, WEEK);
    await openHours(page);
    expect(await summaryOf(page)).toEqual(expectedSummary(WEEK));

    // Mark every working day unavailable.
    await selectDays(page, DAYS);
    await page.getByTestId('mark-unavailable').click();
    const acknowledged = page.waitForResponse(isHoursWrite);
    await page.getByTestId('apply-to-selected').click();
    const response = await acknowledged;
    expect(response.status(), await response.text()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ availability: [] });
    expect(((await response.json()) as DraftView).data.availability).toEqual([]);

    expect(await storedWeek(account.profileId)).toEqual([]);
    expect(await summaryOf(page)).toEqual({});

    await page.reload();
    await expect(page.getByTestId('availability-task')).toBeVisible();
    expect(await summaryOf(page)).toEqual({});
    await expect(page.getByTestId('availability-week-summary')).toContainText('No hours set yet.');
    await inAFreshBrowser(browser, async (fresh) => {
      expect(await summaryOf(fresh)).toEqual({});
    });
    // Nothing put default hours back.
    expect(await storedWeek(account.profileId)).toEqual([]);
    expect((await draftOf(account)).data.availability).toEqual([]);
  });

  test('the hours follow the provider to a new market: same local hours, the new market’s zone', async () => {
    await saveWeekByApi(account, WEEK);
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Asia/Damascus', WEEK),
    );

    await chooseMarket(account, 'SE');
    // No minute moved. Only the wall clock they are read against changed.
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Europe/Stockholm', WEEK),
    );
    expect((await draftOf(account)).data.timezone).toBe('Europe/Stockholm');

    await openHours(page);
    expect(await summaryOf(page)).toEqual(expectedSummary(WEEK));
    await expect(page.getByTestId('availability-week-summary')).toContainText('Stockholm');

    // The provider can still change their hours after moving. Before R10 this
    // write was refused: the screen sent back the old market's zone.
    const next = [win(2, '10:00', '13:00')];
    const acknowledged = await applyHours(page, [2], '10:00', '13:00');
    expect(acknowledged.data.timezone).toBe('Europe/Stockholm');
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Europe/Stockholm', next),
    );

    // A zone from another country is refused by the server, and changes nothing.
    const foreign = await api<{ error?: { details?: { reason?: string } } }>(
      account.jar,
      STEP('AVAILABILITY'),
      {
        method: 'PATCH',
        body: {
          version: (await draftOf(account)).version,
          availability: WEEK,
          timezone: 'Asia/Riyadh',
        },
      },
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.error?.details?.reason).toBe('TIMEZONE_NOT_IN_MARKET');
    expect(await storedWeek(account.profileId)).toEqual(
      rowsFor(account.profileId, 'Europe/Stockholm', next),
    );
  });
});

// ─── Authority under failure ────────────────────────────────────────────────

test.describe('R10 working hours — stale tab, lost reply, offline, lost session, isolation', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R10 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  const WEEK_A = [win(1, '09:00', '17:00'), win(2, '09:00', '17:00')];

  async function provider(): Promise<Account> {
    const account = await registerProvider();
    await chooseMarket(account, 'SY');
    return account;
  }

  test('a stale second tab cannot replace the week; after a reload it sees the newer one and can save', async ({
    browser,
  }) => {
    const account = await provider();
    const context = await browser.newContext();
    await applySession(context, account);
    try {
      const tabA = await context.newPage();
      const tabB = await context.newPage();
      await seedLanguage(tabA, 'en');
      await seedLanguage(tabB, 'en');
      await openHours(tabA);
      await openHours(tabB);

      const first = await applyHours(tabA, [1, 2], '09:00', '17:00');

      // Tab B still holds the revision from before that write.
      await selectDays(tabB, [4, 5]);
      await tabB.getByTestId('bulk-start').fill('06:00');
      await tabB.getByTestId('bulk-end').fill('10:00');
      const refused = tabB.waitForResponse(isHoursWrite);
      await tabB.getByTestId('apply-to-selected').click();
      expect((await refused).status()).toBe(409);
      await expect(saveStatus(tabB)).toHaveAttribute('data-status', 'conflict');
      await expect(feedback(tabB)).not.toContainText('applied and saved');

      // Exactly tab A's week: no row of tab B's, no mixture.
      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', WEEK_A),
      );
      expect((await draftOf(account)).version).toBe(first.version);

      await tabB.reload();
      await expect(tabB.getByTestId('availability-task')).toBeVisible();
      expect(await summaryOf(tabB)).toEqual(expectedSummary(WEEK_A));

      // With the current revision the losing tab saves normally.
      await applyHours(tabB, [4, 5], '06:00', '10:00');
      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', [
          win(4, '06:00', '10:00'),
          win(5, '06:00', '10:00'),
        ]),
      );
    } finally {
      await context.close();
    }
  });

  test('a week whose acknowledgement is lost is stored once, never called saved, and found after a reload', async ({
    browser,
  }) => {
    const account = await provider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openHours(page);
      const before = await draftOf(account);

      // The request goes to the real API and commits. Its reply is dropped.
      let droppedStatus = 0;
      await page.route(`${REAL_API}${STEP('AVAILABILITY')}`, async (route) => {
        if (route.request().method() !== 'PATCH' || droppedStatus > 0) return route.continue();
        const real = await route.fetch();
        droppedStatus = real.status();
        await route.abort('connectionreset');
      });

      await selectDays(page, [1, 2]);
      await page.getByTestId('bulk-start').fill('09:00');
      await page.getByTestId('bulk-end').fill('17:00');
      await page.getByTestId('apply-to-selected').click();
      await expect.poll(() => droppedStatus, { timeout: 15_000 }).toBe(200);

      // The server has it. The browser does not know, and does not say "saved".
      await expect(feedback(page)).toContainText('These working hours have not been saved.', {
        timeout: 15_000,
      });
      await expect(feedback(page)).not.toContainText('applied and saved');
      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', WEEK_A),
      );
      expect((await draftOf(account)).version).toBe(before.version + 1);

      // Trying again presents the old revision: refused, not applied twice.
      const retried = page.waitForResponse(isHoursWrite);
      await page.getByTestId('availability-apply-retry').click();
      expect((await retried).status()).toBe(409);
      expect((await draftOf(account)).version).toBe(before.version + 1);
      expect(await storedWeek(account.profileId)).toHaveLength(WEEK_A.length);

      await page.unroute(`${REAL_API}${STEP('AVAILABILITY')}`);
      await page.reload();
      await expect(page.getByTestId('availability-task')).toBeVisible();
      expect(await summaryOf(page)).toEqual(expectedSummary(WEEK_A));
    } finally {
      await context.close();
    }
  });

  test('an offline week is never called saved, and is written once when the connection returns', async ({
    browser,
  }) => {
    const account = await provider();
    const { context, page } = await signedInPage(browser, account);
    try {
      await openHours(page);
      const before = await draftOf(account);

      await context.setOffline(true);
      await selectDays(page, [1, 2]);
      await page.getByTestId('bulk-start').fill('09:00');
      await page.getByTestId('bulk-end').fill('17:00');
      await page.getByTestId('apply-to-selected').click();
      await expect(feedback(page)).toContainText('Offline', { timeout: 15_000 });
      await expect(feedback(page)).not.toContainText('applied and saved');
      // Nothing reached the server.
      expect((await draftOf(account)).version).toBe(before.version);
      expect(await storedWeek(account.profileId)).toEqual([]);

      const landed = page.waitForResponse(isHoursWrite);
      await context.setOffline(false);
      expect((await landed).status()).toBe(200);
      await expect(feedback(page)).toContainText('Working hours applied and saved.');

      // Written exactly once.
      expect((await draftOf(account)).version).toBe(before.version + 1);
      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', WEEK_A),
      );
    } finally {
      await context.close();
    }
  });

  test('hours applied after the session is lost are refused; after signing in the stored week is shown', async ({
    browser,
  }) => {
    const account = await provider();
    await saveWeekByApi(account, WEEK_A);
    const saved = await draftOf(account);
    const { context, page } = await signedInPage(browser, account);
    try {
      await openHours(page);
      expect(await summaryOf(page)).toEqual(expectedSummary(WEEK_A));

      // Every cookie is gone, as after a sign-out elsewhere.
      await context.clearCookies();
      await selectDays(page, [4]);
      await page.getByTestId('bulk-start').fill('06:00');
      await page.getByTestId('bulk-end').fill('07:00');
      const refused = page.waitForResponse(isHoursWrite);
      await page.getByTestId('apply-to-selected').click();
      expect([401, 403]).toContain((await refused).status());
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });

      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', WEEK_A),
      );
      expect((await draftOf(account)).version).toBe(saved.version);

      await loginViaUi(page, account);
      await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
      await openHours(page);
      expect(await summaryOf(page)).toEqual(expectedSummary(WEEK_A));
    } finally {
      await context.close();
    }
  });

  test('one provider can neither see nor replace the working hours of another', async ({
    browser,
  }) => {
    const owner = await provider();
    const other = await provider();
    await saveWeekByApi(owner, WEEK_A);
    const ownerRows = await storedWeek(owner.profileId);
    const ownerVersion = (await draftOf(owner)).version;

    const { context, page } = await signedInPage(browser, other);
    try {
      await openHours(page);
      // The other provider's screen is their own, and empty.
      expect(await summaryOf(page)).toEqual({});
      // Whatever they apply lands on their own profile.
      await applyHours(page, [6], '10:00', '11:00');
    } finally {
      await context.close();
    }
    expect((await draftOf(other)).data.availability).toHaveLength(1);
    expect(await storedWeek(other.profileId)).toEqual(
      rowsFor(other.profileId, 'Asia/Damascus', [win(6, '10:00', '11:00')]),
    );

    // The owner's version number is no key to anything, and clearing their own
    // week does not touch the owner's.
    const withOwnersVersion = await api(other.jar, STEP('AVAILABILITY'), {
      method: 'PATCH',
      body: { version: ownerVersion, availability: [] },
    });
    expect([200, 409]).toContain(withOwnersVersion.status);
    await api(other.jar, STEP('AVAILABILITY'), {
      method: 'PATCH',
      body: { version: (await draftOf(other)).version, availability: [] },
    });

    expect(await storedWeek(owner.profileId)).toEqual(ownerRows);
    expect((await draftOf(owner)).version).toBe(ownerVersion);
    expect(JSON.stringify(await draftOf(other))).not.toContain(owner.profileId);
  });
});

// ─── Language, touch and keyboard ───────────────────────────────────────────

test.describe('R10 working hours — Arabic, mobile widths and the keyboard', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R10 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  for (const width of [360, 390, 430]) {
    test(`Arabic, right-to-left, ${width}px wide, by touch`, async ({ browser }) => {
      const account = await registerProvider();
      await chooseMarket(account, 'SY');
      const { context, page } = await signedInPage(
        browser,
        account,
        { viewport: { width, height: 844 }, hasTouch: true, isMobile: true },
        'ar',
      );
      try {
        await openHours(page);
        await expect(page.getByTestId('onboarding-v2-shell')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('availability-week-summary')).toContainText(
          'لم تُحدَّد أي ساعات بعد.',
        );

        // No sideways scroll, in Arabic, at this width.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);

        // Every control is inside the viewport's width and big enough to hit.
        const targets = [
          ...[0, 1, 2, 3, 4, 5, 6].map((d) => `day-toggle-${d}`),
          'bulk-start',
          'bulk-end',
          'apply-to-selected',
        ];
        for (const id of targets) {
          const target = page.getByTestId(id);
          await target.scrollIntoViewIfNeeded();
          const box = await target.boundingBox();
          expect(box, id).not.toBeNull();
          expect([id, box!.x >= 0 && box!.x + box!.width <= width]).toEqual([id, true]);
          expect([id, box!.height >= 44]).toEqual([id, true]);
        }
        // Each day says its full name to assistive technology, in Arabic.
        await expect(dayToggle(page, 1)).toHaveAttribute('aria-label', /الاثنين/);

        // A refusal is said in Arabic, and nothing is stored.
        await selectDays(page, [0, 1], true);
        await page.getByTestId('bulk-start').fill('22:00');
        await page.getByTestId('bulk-end').fill('02:00');
        await page.getByTestId('apply-to-selected').tap();
        await expect(page.getByTestId('availability-rejected')).toBeVisible();
        await expect(page.getByTestId('availability-rejected')).toContainText(/منتصف الليل/);
        expect(await storedWeek(account.profileId)).toEqual([]);

        const week = [win(0, '09:00', '17:00'), win(1, '09:00', '17:00')];
        await applyHours(page, [0, 1], '09:00', '17:00', true);
        await expect(feedback(page)).toContainText('تم تطبيق ساعات العمل وحفظها.');
        expect(await storedWeek(account.profileId)).toEqual(
          rowsFor(account.profileId, 'Asia/Damascus', week),
        );
        // Times read left to right inside a right-to-left page.
        await expect(summaryDay(page, 0).locator('bdi')).toHaveAttribute('dir', 'ltr');
        expect(await summaryOf(page)).toEqual(expectedSummary(week));
        await expect(page.getByTestId('availability-week-summary')).toContainText('16');

        // The page's own action stays reachable.
        await expect(page.getByTestId('task-save-and-continue')).toBeInViewport();

        await page.reload();
        await expect(page.getByTestId('availability-task')).toBeVisible();
        expect(await summaryOf(page)).toEqual(expectedSummary(week));
      } finally {
        await context.close();
      }
    });
  }

  test('the week can be set with the keyboard alone', async ({ browser }) => {
    const account = await registerProvider();
    await chooseMarket(account, 'SY');
    const { context, page } = await signedInPage(browser, account);
    try {
      await openHours(page);

      // The controls have programmatic names.
      await expect(page.getByRole('group', { name: /days/i })).toBeVisible();
      await expect(page.getByLabel('From', { exact: true })).toBeVisible();
      await expect(page.getByLabel('To', { exact: true })).toBeVisible();

      // Tab walks the days, the two times and Apply, and does not get stuck.
      await dayToggle(page, 0).focus();
      const visited: string[] = [];
      for (let i = 0; i < 16; i += 1) {
        visited.push(
          await page.evaluate(
            () => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? '',
          ),
        );
        await page.keyboard.press('Tab');
      }
      for (const id of ['day-toggle-0', 'day-toggle-6', 'bulk-start', 'bulk-end']) {
        expect(visited).toContain(id);
      }
      expect(visited.indexOf('day-toggle-0')).toBeLessThan(visited.indexOf('bulk-start'));
      expect(visited.indexOf('bulk-start')).toBeLessThan(visited.indexOf('bulk-end'));

      // Space toggles a day; focus stays visible on it.
      await dayToggle(page, 1).focus();
      await expect(dayToggle(page, 1)).toBeFocused();
      await page.keyboard.press('Space');
      await expect(dayToggle(page, 1)).toHaveAttribute('aria-pressed', 'true');
      await dayToggle(page, 3).focus();
      await page.keyboard.press('Enter');
      await expect(dayToggle(page, 3)).toHaveAttribute('aria-pressed', 'true');
      // ...and toggles it off again.
      await page.keyboard.press('Space');
      await expect(dayToggle(page, 3)).toHaveAttribute('aria-pressed', 'false');

      // The times are typed, and Apply is pressed with Enter.
      await page.getByTestId('bulk-start').focus();
      await page.getByTestId('bulk-start').fill('07:15');
      await page.getByTestId('bulk-end').focus();
      await page.getByTestId('bulk-end').fill('15:45');
      await page.getByTestId('apply-to-selected').focus();
      await expect(page.getByTestId('apply-to-selected')).toBeFocused();
      const acknowledged = page.waitForResponse(isHoursWrite);
      await page.keyboard.press('Enter');
      expect((await acknowledged).status()).toBe(200);

      // The result is announced, and it is what the rows hold.
      await expect(feedback(page)).toContainText('Working hours applied and saved.');
      expect(await storedWeek(account.profileId)).toEqual(
        rowsFor(account.profileId, 'Asia/Damascus', [win(1, '07:15', '15:45')]),
      );
    } finally {
      await context.close();
    }
  });
});
