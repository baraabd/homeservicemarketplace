import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import {
  adminJar,
  api,
  loginViaUi,
  newJar,
  otpFor,
  REAL_API,
  registerProvider,
  type Account,
  type Jar,
} from './real-api';

// ─────────────────────────────────────────────────────────────────────────────
// R11 — reviews, ratings and reputation, through the real stack.
//
// A real browser, the real API, real PostgreSQL. Nothing here is stubbed: the
// "lost response" test lets the request reach the server and drops only the
// answer on its way back.
//
// The booking under review is real too. A seeker posts a request, a provider
// bids, the seeker accepts, the provider starts and completes the job, each
// through its own guarded endpoint. As in R07, only the provider's admin
// approval (tested elsewhere) is written directly.
//
// No trace and no video: both would record session cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R11 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Seeker extends Account {
  userId: string;
  addressId: string;
}

async function registerSeeker(): Promise<Seeker> {
  const jar = newJar();
  const email = `r11-seeker-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = `R11-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'R11', lastName: 'Seeker' },
  });
  expect(registered.status, 'R11 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R11 seeker OTP should verify').toBe(200);
  const address = await api<{ id: string }>(jar, '/v1/me/addresses', {
    method: 'POST',
    body: {
      label: 'R11 Home',
      type: 'HOME',
      line1: '11 Review Street',
      city: 'Aleppo',
      country: 'Syria',
      isDefault: true,
    },
  });
  expect(address.status, JSON.stringify(address.body)).toBeLessThan(300);
  const userId = await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      email,
    ]);
    return rows[0].id;
  });
  return { email, password, jar, profileId: '', userId, addressId: address.body.id };
}

async function leafCategoryId(): Promise<string> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM "ServiceCategory"
        WHERE "isActive" AND "isLeaf" AND "deletedAt" IS NULL
        ORDER BY "sortOrder", id LIMIT 1`,
    );
    if (!rows[0]) throw new Error('the acceptance database has no selectable category');
    return rows[0].id;
  });
}

/** A provider who may work, in the seeker's city and category. See the note at
 *  the top of the file on why the approval is written rather than performed. */
async function workingProvider(categoryId: string): Promise<Account> {
  const account = await registerProvider();
  await withDb(async (db) => {
    await db.query(
      `UPDATE "ProviderProfile"
          SET status = 'ACTIVE',
              "onboardingState" = 'ACCEPTED',
              "standingState" = 'GOOD',
              "verificationState" = 'VERIFIED',
              verified = TRUE,
              "serviceAreaCity" = 'Aleppo',
              "serviceAreaCityKey" = 'aleppo'
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
       VALUES ($1,$2,'ACTIVE','R11_BROWSER_FIXTURE','VERIFIED_DOCUMENTS',
               NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [`r11grant-${randomUUID()}`, account.profileId],
    );
  });
  return account;
}

/** Request -> bid -> accept, through the real endpoints. Returns the booking. */
async function scheduledBooking(
  seeker: Seeker,
  provider: Account,
  categoryId: string,
): Promise<string> {
  const request = await api<{ id: string }>(seeker.jar, '/v1/me/requests', {
    method: 'POST',
    body: {
      categoryId,
      customServiceText: null,
      description: 'R11 review acceptance job',
      mediaAssetIds: [],
      scheduleType: 'ASAP',
      scheduledAt: null,
      addressId: seeker.addressId,
      manualAddress: null,
    },
  });
  expect(request.status, JSON.stringify(request.body)).toBe(201);
  const bid = await api<{ bid: { id: string } }>(provider.jar, '/v1/provider/bids', {
    method: 'POST',
    body: { requestId: request.body.id, amount: 120, pricingType: 'FIXED' },
  });
  expect(bid.status, JSON.stringify(bid.body)).toBe(201);
  const accepted = await api<{ booking: { id: string } }>(
    seeker.jar,
    `/v1/me/requests/${request.body.id}/bids/${bid.body.bid.id}/accept`,
    { method: 'POST' },
  );
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  return accepted.body.booking.id;
}

async function providerMoves(
  provider: Account,
  bookingId: string,
  to: 'start' | 'complete',
): Promise<void> {
  const moved = await api(provider.jar, `/v1/me/provider/bookings/${bookingId}/${to}`, {
    method: 'POST',
  });
  expect(moved.status, `${to}: ${JSON.stringify(moved.body)}`).toBeLessThan(300);
}

async function completedBooking(
  seeker: Seeker,
  provider: Account,
  categoryId: string,
): Promise<string> {
  const bookingId = await scheduledBooking(seeker, provider, categoryId);
  await providerMoves(provider, bookingId, 'start');
  await providerMoves(provider, bookingId, 'complete');
  return bookingId;
}

interface ReviewRow {
  id: string;
  bookingId: string;
  seekerUserId: string;
  providerId: string;
  rating: number;
  comment: string | null;
  state: string;
}

const reviewsOf = (bookingId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<ReviewRow>(
      `SELECT id, "bookingId", "seekerUserId", "providerId", rating, comment, state
         FROM "BookingReview" WHERE "bookingId" = $1`,
      [bookingId],
    );
    return rows;
  });

const reputationOf = (profileId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{
      ratingAvg: number;
      reviewCount: number;
      completedJobs: number;
    }>(
      `SELECT "ratingAvg"::float8 AS "ratingAvg", "reviewCount", "completedJobs"
         FROM "ProviderProfile" WHERE id = $1`,
      [profileId],
    );
    return rows[0];
  });

async function applySession(context: BrowserContext, jar: Jar): Promise<void> {
  const host = new URL(REAL_API).hostname;
  await context.addCookies(
    [...jar].map(([name, value]) => ({
      name,
      value,
      domain: host,
      path: name === 'hsm_rt' ? '/v1/auth/refresh' : '/',
    })),
  );
}

const reviewUrl = (bookingId: string) => `${REAL_API}/v1/me/bookings/${bookingId}/review`;

/** The job screen of a completed booking, reached the way a seeker reaches it. */
async function openJob(page: Page, bookingId: string, lang: 'en' | 'ar' = 'en'): Promise<void> {
  const statusLoaded = page.waitForResponse(
    (r) => r.url() === reviewUrl(bookingId) && r.request().method() === 'GET',
  );
  await page.goto(`${BASE_URL}/home/profile`);
  await page
    .getByRole('button', { name: lang === 'ar' ? 'الطلبات المكتملة' : 'Completed Posts' })
    .click();
  await page.getByTestId(`completed-post-${bookingId}`).click();
  await statusLoaded;
}

const reviewPost = (page: Page, bookingId: string) =>
  page.waitForResponse((r) => r.url() === reviewUrl(bookingId) && r.request().method() === 'POST');

test.describe('R11 reviews and reputation — real browser, API and PostgreSQL', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R11 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  test('a completed booking is reviewed once, read back everywhere, and counted exactly', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker();
    const provider = await workingProvider(categoryId);

    // A provider with no history has no reputation.
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 0,
      reviewCount: 0,
      completedJobs: 0,
    });

    // ── before completion the server refuses, at each stage ────────────────
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const early = await api<{ error?: unknown }>(
      seeker.jar,
      `/v1/me/bookings/${bookingId}/review`,
      {
        method: 'POST',
        body: { rating: 5 },
      },
    );
    expect(early.status, 'a scheduled booking cannot be reviewed').toBe(409);
    await providerMoves(provider, bookingId, 'start');
    const during = await api(seeker.jar, `/v1/me/bookings/${bookingId}/review`, {
      method: 'POST',
      body: { rating: 5 },
    });
    expect(during.status, 'a booking in progress cannot be reviewed').toBe(409);
    await providerMoves(provider, bookingId, 'complete');
    expect(await reviewsOf(bookingId)).toHaveLength(0);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 0,
      reviewCount: 0,
      completedJobs: 1,
    });

    // ── the seeker reviews it in the browser ───────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openJob(page, bookingId);

    await expect(page.getByTestId('provider-rating-none')).toHaveText('No reviews yet');
    const prompt = page.getByTestId('booking-review-open');
    await expect(prompt).toBeVisible();
    await prompt.click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('booking-review-submit')).toBeDisabled();

    // Markup in a comment is text. It is stored as written and shown as written.
    const comment = 'On time. <img src=x onerror="window.__r11=1"> <b>tidy</b> عمل ممتاز';
    await page.getByTestId('booking-review-star-4').click();
    await page.getByTestId('booking-review-comment').fill(comment);

    const posted = reviewPost(page, bookingId);
    await page.getByTestId('booking-review-submit').click();
    const response = await posted;
    expect(response.status(), await response.text()).toBe(201);

    // What the browser sent: a rating and a comment, to this booking's URL.
    expect(response.request().postDataJSON()).toEqual({ rating: 4, comment });
    const acknowledged = (await response.json()) as {
      review: { id: string; bookingId: string; rating: number; comment: string; state: string };
      replayed: boolean;
    };
    expect(acknowledged.replayed).toBe(false);
    expect(acknowledged.review).toMatchObject({
      bookingId,
      rating: 4,
      comment,
      state: 'PUBLISHED',
    });

    const savedCard = page.getByTestId('booking-review-saved');
    await expect(savedCard).toBeVisible();
    await expect(page.getByTestId('booking-review-saved-rating')).toHaveAttribute(
      'data-rating',
      '4',
    );
    await expect(page.getByTestId('booking-review-saved-comment')).toHaveText(comment);
    await expect(page.getByTestId('booking-review-saved-comment').locator('img, b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __r11?: number }).__r11)).toBe(
      undefined,
    );
    await expect(sheet).toHaveCount(0);
    await expect(prompt).toHaveCount(0);
    await testInfo.attach('r11-review-saved-390.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // ── what PostgreSQL holds ──────────────────────────────────────────────
    const rows = await reviewsOf(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: acknowledged.review.id,
      bookingId,
      seekerUserId: seeker.userId,
      providerId: provider.profileId,
      rating: 4,
      comment,
      state: 'PUBLISHED',
    });
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 4,
      reviewCount: 1,
      completedJobs: 1,
    });
    const audits = await withDb(async (db) => {
      const { rows: found } = await db.query<{ userId: string }>(
        `SELECT "userId" FROM "AuditEvent"
          WHERE type = 'BOOKING_REVIEW_SUBMITTED' AND metadata->>'reviewId' = $1`,
        [acknowledged.review.id],
      );
      return found;
    });
    expect(audits).toEqual([{ userId: seeker.userId }]);

    // ── reload: the screen is rebuilt from the server ──────────────────────
    await openJob(page, bookingId);
    await expect(page.getByTestId('booking-review-saved-comment')).toHaveText(comment);
    await expect(page.getByTestId('booking-review-open')).toHaveCount(0);
    // Not announced again as just saved.
    await expect(page.getByTestId('booking-review-thanks')).toHaveCount(0);
    // The provider's card now carries the rating derived from this review.
    await expect(page.getByTestId('provider-rating')).toHaveAttribute('data-review-count', '1');
    await expect(page.getByTestId('provider-rating')).toContainText('4.0');

    // ── a fresh browser and a fresh sign-in ────────────────────────────────
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/login`);
      await loginViaUi(freshPage, seeker);
      await freshPage.waitForURL(/\/home/);
      await openJob(freshPage, bookingId);
      await expect(freshPage.getByTestId('booking-review-saved-comment')).toHaveText(comment);
      await expect(freshPage.getByTestId('booking-review-saved-rating')).toHaveAttribute(
        'data-rating',
        '4',
      );
      await expect(freshPage.getByTestId('booking-review-open')).toHaveCount(0);
    } finally {
      await fresh.close();
    }

    // ── sending it again ───────────────────────────────────────────────────
    const again = await api<{ replayed: boolean; review: { id: string } }>(
      seeker.jar,
      `/v1/me/bookings/${bookingId}/review`,
      { method: 'POST', body: { rating: 4, comment } },
    );
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replayed: true, review: { id: acknowledged.review.id } });
    const changed = await api(seeker.jar, `/v1/me/bookings/${bookingId}/review`, {
      method: 'POST',
      body: { rating: 1, comment: 'changed my mind' },
    });
    expect(changed.status, 'a review is final').toBe(409);
    // Fields a client has no say in are not accepted alongside a review.
    const forged = await api(seeker.jar, `/v1/me/bookings/${bookingId}/review`, {
      method: 'POST',
      body: { rating: 4, comment, providerId: 'someone-else', state: 'HIDDEN' },
    });
    expect(forged.status).toBe(400);

    // ── people who may not ─────────────────────────────────────────────────
    const stranger = await registerSeeker();
    const peek = await api(stranger.jar, `/v1/me/bookings/${bookingId}/review`);
    expect(peek.status, "another seeker cannot read this booking's review").toBe(404);
    const intrude = await api(stranger.jar, `/v1/me/bookings/${bookingId}/review`, {
      method: 'POST',
      body: { rating: 1 },
    });
    expect(intrude.status).toBe(404);
    // The provider is not the seeker of their own booking.
    const selfPraise = await api(provider.jar, `/v1/me/bookings/${bookingId}/review`, {
      method: 'POST',
      body: { rating: 5 },
    });
    expect(selfPraise.status).toBe(404);
    const anonymous = await fetch(reviewUrl(bookingId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5 }),
    });
    expect(anonymous.status).toBe(401);
    const withoutCsrf = await fetch(reviewUrl(bookingId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: [...seeker.jar].map(([k, v]) => `${k}=${v}`).join('; '),
      },
      body: JSON.stringify({ rating: 4, comment }),
    });
    expect(withoutCsrf.status).toBe(403);

    // None of that changed what is stored.
    expect(await reviewsOf(bookingId)).toEqual(rows);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 4,
      reviewCount: 1,
      completedJobs: 1,
    });

    // ── moderation: hidden reviews stop counting, restored ones count again ─
    const admin = await adminJar();
    const reason = 'R11 acceptance: hidden to verify recount';
    const refusedHide = await api(seeker.jar, `/v1/admin/reviews/${rows[0].id}/hide`, {
      method: 'POST',
      body: { reason },
    });
    expect(refusedHide.status, 'a seeker cannot moderate').toBe(403);
    const providerHide = await api(provider.jar, `/v1/admin/reviews/${rows[0].id}/hide`, {
      method: 'POST',
      body: { reason },
    });
    expect(providerHide.status, 'a provider cannot hide their own review').toBe(403);

    const hidden = await api(admin, `/v1/admin/reviews/${rows[0].id}/hide`, {
      method: 'POST',
      body: { reason },
    });
    expect(hidden.status, JSON.stringify(hidden.body)).toBeLessThan(300);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 0,
      reviewCount: 0,
      completedJobs: 1,
    });
    await openJob(page, bookingId);
    await expect(page.getByTestId('booking-review-hidden')).toBeVisible();
    await expect(page.getByTestId('provider-rating-none')).toBeVisible();
    // The moderator's reason is not the seeker's to read.
    await expect(page.getByText(reason)).toHaveCount(0);
    // Hidden is not deleted: the booking still cannot be reviewed again.
    await expect(page.getByTestId('booking-review-open')).toHaveCount(0);

    const restored = await api(admin, `/v1/admin/reviews/${rows[0].id}/restore`, {
      method: 'POST',
      body: { reason: 'R11 acceptance: restored to verify recount' },
    });
    expect(restored.status, JSON.stringify(restored.body)).toBeLessThan(300);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 4,
      reviewCount: 1,
      completedJobs: 1,
    });
  });

  test('the mean is exact across several real bookings', async () => {
    const categoryId = await leafCategoryId();
    const provider = await workingProvider(categoryId);
    const ratings = [5, 4, 4];
    for (const rating of ratings) {
      const seeker = await registerSeeker();
      const bookingId = await completedBooking(seeker, provider, categoryId);
      const sent = await api(seeker.jar, `/v1/me/bookings/${bookingId}/review`, {
        method: 'POST',
        body: { rating },
      });
      expect(sent.status).toBe(201);
    }
    const reputation = await reputationOf(provider.profileId);
    expect(reputation.reviewCount).toBe(3);
    expect(reputation.completedJobs).toBe(3);
    expect(reputation.ratingAvg).toBeCloseTo(13 / 3, 10);
  });

  test('an answer lost on the way back does not lose or duplicate the review', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker();
    const provider = await workingProvider(categoryId);
    const bookingId = await completedBooking(seeker, provider, categoryId);

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openJob(page, bookingId);
    await page.getByTestId('booking-review-open').click();
    await page.getByTestId('booking-review-star-5').click();
    await page.getByTestId('booking-review-comment').fill('Lost answer');

    // The request reaches the real server and is handled there. Only the
    // answer is dropped, once.
    let reached = 0;
    await page.route(reviewUrl(bookingId), async (route) => {
      if (route.request().method() !== 'POST' || reached > 0) return route.fallback();
      reached += 1;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByTestId('booking-review-submit').click();

    // The app does not guess. It asks the server, and shows what is there.
    await expect(page.getByTestId('booking-review-saved')).toBeVisible();
    await expect(page.getByTestId('booking-review-saved-comment')).toHaveText('Lost answer');
    await expect(page.getByTestId('booking-review-open')).toHaveCount(0);
    expect(reached).toBe(1);

    const rows = await reviewsOf(bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 5, comment: 'Lost answer' });
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 5,
      reviewCount: 1,
      completedJobs: 1,
    });
  });

  test('offline keeps the draft and saves nothing; a lost session saves nothing', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker();
    const provider = await workingProvider(categoryId);
    const first = await completedBooking(seeker, provider, categoryId);
    const second = await completedBooking(seeker, provider, categoryId);

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');

    // ── offline ────────────────────────────────────────────────────────────
    await openJob(page, first);
    await page.getByTestId('booking-review-open').click();
    await page.getByTestId('booking-review-star-3').click();
    await page.getByTestId('booking-review-comment').fill('Typed while offline');
    await context.setOffline(true);
    await page.getByTestId('booking-review-submit').click();
    await expect(page.getByTestId('booking-review-error')).toHaveAttribute('data-error', 'NETWORK');
    await expect(page.getByTestId('booking-review-saved')).toHaveCount(0);
    await expect(page.getByTestId('booking-review-star-3')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('booking-review-comment')).toHaveValue('Typed while offline');
    expect(await reviewsOf(first)).toHaveLength(0);

    await context.setOffline(false);
    const posted = reviewPost(page, first);
    await page.getByTestId('booking-review-submit').click();
    expect((await posted).status()).toBe(201);
    await expect(page.getByTestId('booking-review-saved-comment')).toHaveText(
      'Typed while offline',
    );
    expect(await reviewsOf(first)).toHaveLength(1);

    // ── the session ends before Submit ─────────────────────────────────────
    await openJob(page, second);
    await page.getByTestId('booking-review-open').click();
    await page.getByTestId('booking-review-star-2').click();
    await context.clearCookies();
    const refused = reviewPost(page, second);
    await page.getByTestId('booking-review-submit').click();
    expect([401, 403]).toContain((await refused).status());
    await expect(page.getByTestId('booking-review-saved')).toHaveCount(0);
    await expect(page.getByTestId('booking-review-thanks')).toHaveCount(0);
    expect(await reviewsOf(second)).toHaveLength(0);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 3,
      reviewCount: 1,
      completedJobs: 2,
    });
  });

  test('Arabic, right-to-left, at 360, 390 and 430, by keyboard alone', async ({
    page,
    context,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker();
    const provider = await workingProvider(categoryId);
    const bookingId = await completedBooking(seeker, provider, categoryId);

    await applySession(context, seeker.jar);
    await seedLanguage(page, 'ar');

    const sizes = [
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 640 },
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      await openJob(page, bookingId, 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('provider-rating-none')).toHaveText('لا توجد تقييمات بعد');

      const prompt = page.getByTestId('booking-review-open');
      // Focused the way the Tab key focuses it: the browser brings it into
      // view by the smallest scroll that does.
      await prompt.focus();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAccessibleName(/كيف كانت تجربتك مع/);
      // Focus arrives inside the sheet.
      expect(
        await sheet.evaluate((node) => node.contains(document.activeElement)),
        `focus inside the sheet at ${size.width}`,
      ).toBe(true);

      const layout = await page.evaluate(() => {
        const box = (testId: string) => {
          const rect = document.querySelector(`[data-testid="${testId}"]`)!.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          };
        };
        const textarea = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="booking-review-comment"]',
        )!;
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          stars: [1, 2, 3, 4, 5].map((n) => box(`booking-review-star-${n}`)),
          submit: box('booking-review-submit'),
          close: box('booking-review-close'),
          sheet: box('booking-review-sheet'),
          commentFont: parseFloat(getComputedStyle(textarea).fontSize),
          // Anything the sheet sits inside that has been scrolled would push
          // the sheet partly off screen.
          scrolledAncestors: (() => {
            const found: string[] = [];
            let node = document.querySelector(
              '[data-testid="booking-review-sheet"]',
            )!.parentElement;
            while (node) {
              if (node.scrollTop !== 0 || node.scrollLeft !== 0) {
                found.push(
                  `${node.tagName}.${node.className.toString().slice(0, 60)} top=${node.scrollTop} left=${node.scrollLeft}`,
                );
              }
              node = node.parentElement;
            }
            return found;
          })(),
        };
      });
      expect(layout.overflow, `no horizontal overflow at ${size.width}`).toBeLessThanOrEqual(0);
      for (const target of [...layout.stars, layout.submit, layout.close]) {
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expect(target.left).toBeGreaterThanOrEqual(0);
        expect(target.right).toBeLessThanOrEqual(layout.viewport.width);
      }
      // Right-to-left: the first star is the rightmost.
      expect(layout.stars[0].left).toBeGreaterThan(layout.stars[4].left);
      // The whole sheet, and its action, are on screen.
      expect(
        layout.scrolledAncestors,
        `nothing behind the sheet scrolled at ${size.width}`,
      ).toEqual([]);
      expect(layout.sheet.top).toBeGreaterThanOrEqual(0);
      expect(layout.submit.bottom).toBeLessThanOrEqual(layout.viewport.height);
      expect(layout.commentFont).toBeGreaterThanOrEqual(16);

      await testInfo.attach(`r11-review-sheet-ar-${size.width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      if (size.width !== 360) {
        // Escape closes the sheet and hands focus back to the prompt.
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await expect(prompt).toBeFocused();
        continue;
      }

      // At the narrowest width the review is written and sent without a pointer.
      // In a right-to-left row "next" is the left arrow: none -> 2 -> 3.
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await expect(page.getByTestId('booking-review-star-3')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(page.getByTestId('booking-review-star-3')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('booking-review-comment')).toBeFocused();
      await page.keyboard.type('خدمة جيدة ووصل في الموعد');
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('booking-review-close')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByTestId('booking-review-submit')).toBeFocused();
      // Focus does not leave the sheet.
      await page.keyboard.press('Tab');
      expect(await sheet.evaluate((node) => node.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Shift+Tab');
      await expect(page.getByTestId('booking-review-submit')).toBeFocused();

      const posted = reviewPost(page, bookingId);
      await page.keyboard.press('Enter');
      const response = await posted;
      expect(response.status()).toBe(201);
      expect(response.request().postDataJSON()).toEqual({
        rating: 3,
        comment: 'خدمة جيدة ووصل في الموعد',
      });
      await expect(page.getByTestId('booking-review-saved-comment')).toHaveText(
        'خدمة جيدة ووصل في الموعد',
      );
      await expect(page.getByTestId('booking-review-thanks')).toHaveText('تم حفظ تقييمك.');
      await testInfo.attach('r11-review-saved-ar-360.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }

    expect(await reviewsOf(bookingId)).toHaveLength(1);
    expect(await reputationOf(provider.profileId)).toEqual({
      ratingAvg: 3,
      reviewCount: 1,
      completedJobs: 1,
    });
  });
});
