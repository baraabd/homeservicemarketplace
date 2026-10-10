import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { api, loginViaUi, REAL_API, registerProvider, type Account } from './real-api';
import { registerSeeker, withDb, type Seeker } from './booking-fixtures';

// R18 — the primary cross-role journey, end to end in real browsers.
//
// No earlier suite runs it in one flow: R07 accepts the bid over HTTP, R11
// and R12 start from a booking made over HTTP. Here every business step is a
// user action in the real UI against the real API and PostgreSQL:
//
//   seeker signs in → posts a request → an eligible provider (own browser
//   context) signs in, sees it, opens it, bids → the seeker accepts in the
//   UI → exactly one booking, seen by both → they message → the provider
//   starts and completes → the seeker sees completion and reviews once →
//   the provider's reputation counts it → reload and fresh login keep it.
//
// Every transition is checked in the browser, over HTTP and in the database.
// No successful response is intercepted or substituted. The one database
// write is the provider's admin approval outcome (status, category, area and
// work-access grant), which the admin review suites accept separately; the
// approval itself is not under test here (as in R07, R11 and R12).
//
// docs/production-readiness/r18/CROSS_ROLE_ACCEPTANCE.md

test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const CONVERSATIONS = `${REAL_API}/v1/me/conversations`;

const isCall =
  (method: string, url: string) => (r: { url(): string; request(): { method(): string } }) =>
    r.url() === url && r.request().method() === method;

/** Make an already-registered provider able to work in Aleppo in one category:
 *  the outcome an admin approval produces (see header). */
async function approveForWork(account: Account, categoryId: string, city: string): Promise<void> {
  const key = city.toLowerCase();
  await withDb(async (db) => {
    await db.query(
      `UPDATE "ProviderProfile"
          SET status = 'ACTIVE', "onboardingState" = 'ACCEPTED', "standingState" = 'GOOD',
              "verificationState" = 'VERIFIED', verified = TRUE,
              "serviceAreaCity" = $2, "serviceAreaCityKey" = $3
        WHERE id = $1`,
      [account.profileId, city, key],
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
       VALUES ($1,$2,'ACTIVE','R18_BROWSER_FIXTURE','VERIFIED_DOCUMENTS',
               NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [`r18grant-${account.profileId}`, account.profileId],
    );
  });
}

/** Signs in through the real login and OTP screens, then mirrors the session
 *  the app established into the account's HTTP jar for the API checks. */
async function signIn(page: Page, account: Account): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await loginViaUi(page, account);
  await expect(page.getByTestId('otp-input')).toHaveCount(0, { timeout: 30_000 });
  account.jar.clear();
  for (const cookie of await page.context().cookies()) account.jar.set(cookie.name, cookie.value);
}

const notificationTypes = (userId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ type: string }>(
      `SELECT type FROM "Notification" WHERE "userId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt", id`,
      [userId],
    );
    return rows.map((r) => r.type);
  });
const userIdOf = (profileId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ userId: string }>(
      'SELECT "userId" FROM "ProviderProfile" WHERE id = $1',
      [profileId],
    );
    return rows[0].userId;
  });
/** Count of each value, so a duplicated side effect cannot hide in a set. */
const counts = (values: string[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});

test.describe.serial('R18 cross-role lifecycle — real browsers, API and PostgreSQL', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R18 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  let seeker: Seeker;
  let provider: Account;
  let outsider: Account;
  let providerUserId = '';
  let seekerContext: BrowserContext;
  let providerContext: BrowserContext;
  let seekerPage: Page;
  let providerPage: Page;
  let requestId = '';
  let categoryId = '';
  let bidId = '';
  let bookingId = '';
  let conversationId = '';

  test.beforeAll(async ({ browser }) => {
    seeker = await registerSeeker('r18');
    provider = await registerProvider();
    outsider = await registerProvider();
    providerUserId = await userIdOf(provider.profileId);
    seekerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    seekerPage = await seekerContext.newPage();
    providerPage = await providerContext.newPage();
    await seedLanguage(seekerPage, 'en');
    await seedLanguage(providerPage, 'en');
  });
  test.afterAll(async () => {
    await seekerContext?.close();
    await providerContext?.close();
  });

  test('1 the seeker signs in and posts a request through the UI; it commits once', async () => {
    await signIn(seekerPage, seeker);
    await seekerPage.goto(`${BASE_URL}/home`);
    await seekerPage.getByTestId('service-categories-grid').getByRole('button').first().click();
    await seekerPage.getByRole('button', { name: /next step/i }).click();
    const created = seekerPage.waitForResponse(isCall('POST', `${REAL_API}/v1/me/requests`));
    await seekerPage.getByRole('button', { name: /confirm job/i }).click();
    const response = await created;
    expect(response.status(), await response.text()).toBe(201);
    requestId = ((await response.json()) as { id: string }).id;
    const row = await withDb(async (db) => {
      const { rows } = await db.query<{ status: string; categoryId: string; seekerUserId: string }>(
        `SELECT status, "categoryId", "seekerUserId" FROM "ServiceRequest" WHERE id = $1`,
        [requestId],
      );
      return rows;
    });
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ status: 'OPEN_FOR_BIDS', seekerUserId: seeker.userId });
    categoryId = row[0].categoryId;
    // Reload: the request is the server's, not a cached optimistic row.
    const listed = seekerPage.waitForResponse(
      (r) => r.url().startsWith(`${REAL_API}/v1/me/requests`) && r.request().method() === 'GET',
    );
    await seekerPage.reload();
    const body = (await (await listed).json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toContain(requestId);
  });

  test('2 an eligible provider signs in, sees the request, opens it and bids; another does not see it', async () => {
    await approveForWork(provider, categoryId, 'Aleppo');
    await approveForWork(outsider, categoryId, 'Damascus');
    const feed = (account: Account) =>
      api<{ items: { id: string }[] }>(account.jar, '/v1/provider/available-requests');
    // Outside the service area: the feed omits it and the detail is 404.
    expect((await feed(outsider)).body.items.map((i) => i.id)).not.toContain(requestId);
    expect((await api(outsider.jar, `/v1/provider/available-requests/${requestId}`)).status).toBe(
      404,
    );

    // One active bid per request; a withdrawn bid does not count. An HTTP
    // bid, a refused duplicate and a withdrawal come first; the replacement
    // is then made in the UI below.
    const first = await api<{ bid: { id: string; status: string } }>(
      provider.jar,
      '/v1/provider/bids',
      {
        method: 'POST',
        body: { requestId, amount: 150, pricingType: 'FIXED', note: 'R18 first offer' },
      },
    );
    expect(first.status).toBe(201);
    const duplicate = await api(provider.jar, '/v1/provider/bids', {
      method: 'POST',
      body: { requestId, amount: 151, pricingType: 'FIXED' },
    });
    expect(duplicate.status).toBe(409);
    const withdrawn = await api<{ bid: { status: string } }>(
      provider.jar,
      `/v1/provider/bids/${first.body.bid.id}/withdraw`,
      { method: 'POST' },
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.bid.status).toBe('WITHDRAWN');
    expect(
      (
        await api(provider.jar, `/v1/provider/bids/${first.body.bid.id}/withdraw`, {
          method: 'POST',
        })
      ).status,
    ).toBe(409);

    await signIn(providerPage, provider);
    const loaded = providerPage.waitForResponse(
      (r) =>
        r.url().startsWith(`${REAL_API}/v1/provider/available-requests`) &&
        r.request().method() === 'GET' &&
        r.status() === 200,
    );
    await providerPage.goto(`${BASE_URL}/provider/jobs`);
    expect(
      ((await (await loaded).json()) as { items: { id: string }[] }).items.map((i) => i.id),
    ).toContain(requestId);
    await providerPage.getByTestId('pull-up-control').click({ force: true });
    await providerPage.getByTestId(`job-card-${requestId}`).click();
    await providerPage.getByTestId('job-detail-place-bid').click();
    await providerPage.locator('input[type="number"]').last().fill('140');
    await providerPage.getByRole('button', { name: '30 min', exact: true }).click();
    await providerPage.locator('textarea').last().fill('R18 cross-role offer');
    const submitted = providerPage.waitForResponse(isCall('POST', `${REAL_API}/v1/provider/bids`));
    await providerPage.getByRole('button', { name: 'Send Offer', exact: true }).click();
    const bidHttp = await submitted;
    expect(bidHttp.status(), await bidHttp.text()).toBe(201);
    bidId = ((await bidHttp.json()) as { bid: { id: string } }).bid.id;
    const bids = await withDb(async (db) => {
      const { rows } = await db.query<{ id: string; status: string }>(
        `SELECT id, status FROM "Bid" WHERE "requestId" = $1 AND "deletedAt" IS NULL
          ORDER BY "createdAt", id`,
        [requestId],
      );
      return rows;
    });
    expect(bids).toEqual([
      { id: first.body.bid.id, status: 'WITHDRAWN' },
      { id: bidId, status: 'PENDING' },
    ]);
    // The seeker was told once per submitted bid; the refused duplicate and
    // the withdrawal told nobody.
    expect(counts(await notificationTypes(seeker.userId))).toMatchObject({ BID_RECEIVED: 2 });
  });

  test('3 the seeker accepts the bid in the UI: exactly one booking, and both roles see it', async () => {
    await seekerPage.goto(`${BASE_URL}/home`);
    const card = seekerPage.getByTestId('lead-card').first();
    await card.click();
    const book = seekerPage.getByRole('button', { name: 'Book Now' });
    await expect(book).toHaveCount(1);
    const accepted = seekerPage.waitForResponse(
      isCall('POST', `${REAL_API}/v1/me/requests/${requestId}/bids/${bidId}/accept`),
    );
    await book.click();
    const acceptHttp = await accepted;
    expect(acceptHttp.status(), await acceptHttp.text()).toBe(200);
    const accept = (await acceptHttp.json()) as {
      bid: { status: string };
      booking: { id: string; bidId: string; status: string };
      requestStatus: string;
    };
    expect(accept.bid.status).toBe('ACCEPTED');
    expect(accept.booking).toMatchObject({ bidId, status: 'SCHEDULED' });
    bookingId = accept.booking.id;
    // The confirmation appears only after the server's answer.
    await expect(seekerPage.getByText('Booking confirmed!')).toBeVisible();

    // A retry after a lost response (same bid) is refused and creates no
    // second booking (the durable check below sees exactly one).
    seeker.jar.clear();
    for (const cookie of await seekerContext.cookies()) seeker.jar.set(cookie.name, cookie.value);
    const retry = await api(seeker.jar, `/v1/me/requests/${requestId}/bids/${bidId}/accept`, {
      method: 'POST',
    });
    expect(retry.status).toBe(409);

    const durable = await withDb(async (db) => {
      const { rows } = await db.query<{ id: string; status: string; request: string; bid: string }>(
        `SELECT bk.id, bk.status, r.status AS request, b.status AS bid
           FROM "Booking" bk JOIN "ServiceRequest" r ON r.id = bk."requestId"
           JOIN "Bid" b ON b.id = bk."bidId"
          WHERE bk."requestId" = $1`,
        [requestId],
      );
      return rows;
    });
    expect(durable).toEqual([
      { id: bookingId, status: 'SCHEDULED', request: 'BID_ACCEPTED', bid: 'ACCEPTED' },
    ]);
    expect(counts(await notificationTypes(providerUserId))).toMatchObject({
      BID_ACCEPTED: 1,
      BOOKING_CREATED: 1,
    });

    // The seeker's bookings list (hard reload) and the provider's My Bids
    // show the same booking.
    await seekerPage.goto(`${BASE_URL}/home/bookings`);
    await seekerPage.reload();
    await expect(seekerPage.getByTestId(`booking-card-${bookingId}`)).toBeVisible();
    const bidsLoaded = providerPage.waitForResponse(
      (r) =>
        r.url().startsWith(`${REAL_API}/v1/provider/bids`) &&
        r.request().method() === 'GET' &&
        r.status() === 200,
    );
    await providerPage.goto(`${BASE_URL}/provider/bids`);
    await bidsLoaded;
    await expect(providerPage.getByTestId(`provider-bid-${bidId}`)).toHaveAttribute(
      'data-status',
      'accepted',
    );
    const providerBookings = await api<{ items: { id: string }[] }>(
      provider.jar,
      '/v1/provider/bookings',
    );
    expect(providerBookings.body.items.map((b) => b.id)).toContain(bookingId);
  });

  test('4 seeker and provider message each other on the booking', async () => {
    const detail = seekerPage.waitForResponse(
      isCall('GET', `${REAL_API}/v1/me/bookings/${bookingId}`),
    );
    await seekerPage.goto(`${BASE_URL}/home/bookings`);
    await seekerPage.getByTestId(`booking-card-${bookingId}`).click();
    expect((await detail).status()).toBe(200);
    const opened = seekerPage.waitForResponse(isCall('POST', CONVERSATIONS));
    await seekerPage.getByTestId('booking-action-message').click();
    const openedHttp = await opened;
    expect(openedHttp.status()).toBe(200);
    conversationId = ((await openedHttp.json()) as { conversation: { id: string } }).conversation
      .id;
    const hello = `R18 hello ${bookingId.slice(-6)}`;
    const sent = seekerPage.waitForResponse(
      isCall('POST', `${CONVERSATIONS}/${conversationId}/messages`),
    );
    await seekerPage.getByTestId('chat-input').fill(hello);
    await seekerPage.getByTestId('chat-send').click();
    expect((await sent).status()).toBe(201);

    await providerPage.goto(`${BASE_URL}/provider/bids`);
    await providerPage.getByTestId(`provider-booking-message-${bookingId}`).click();
    await expect(providerPage.getByText(hello).filter({ visible: true }).first()).toBeVisible();
    const reply = 'R18 reply: on my way';
    const replied = providerPage.waitForResponse(
      (r) => r.url().endsWith(`/messages`) && r.request().method() === 'POST',
    );
    await providerPage.getByLabel('Type a message…').fill(reply);
    await providerPage.getByRole('button', { name: 'Send' }).click();
    expect((await replied).status()).toBe(201);

    const stored = await withDb(async (db) => {
      const { rows } = await db.query<{ body: string }>(
        `SELECT body FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt", id`,
        [conversationId],
      );
      return rows.map((r) => r.body);
    });
    expect(stored).toEqual([hello, reply]);
    await seekerPage.reload();
    await expect(seekerPage.getByText(reply).filter({ visible: true }).first()).toBeVisible();
  });

  test('5 the provider starts and completes the booking in the UI; the seeker sees completion', async () => {
    const page = providerPage;
    await page.goto(`${BASE_URL}/provider/bookings/${bookingId}`);
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'SCHEDULED',
    );
    const started = page.waitForResponse(
      isCall('POST', `${REAL_API}/v1/provider/bookings/${bookingId}/start`),
    );
    await page.getByTestId(`provider-booking-start-${bookingId}`).click();
    expect((await started).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'IN_PROGRESS',
    );
    const completed = page.waitForResponse(
      isCall('POST', `${REAL_API}/v1/provider/bookings/${bookingId}/complete`),
    );
    await page.getByTestId(`provider-booking-complete-${bookingId}`).click();
    expect((await completed).status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId('provider-booking-status')).toHaveAttribute(
      'data-status',
      'COMPLETED',
    );

    const history = await withDb(async (db) => {
      const { rows } = await db.query<{ status: string; events: string }>(
        `SELECT bk.status, (SELECT COUNT(*) FROM "BookingEvent" e WHERE e."bookingId" = bk.id)::text AS events
           FROM "Booking" bk WHERE bk.id = $1`,
        [bookingId],
      );
      return rows[0];
    });
    expect(history).toEqual({ status: 'COMPLETED', events: '3' });
    expect(counts(await notificationTypes(seeker.userId))).toMatchObject({
      BOOKING_IN_PROGRESS: 1,
    });

    // The seeker reaches it from Completed Posts after a reload.
    await seekerPage.goto(`${BASE_URL}/home/profile`);
    await seekerPage.reload();
    await seekerPage.getByRole('button', { name: 'Completed Posts' }).click();
    await expect(seekerPage.getByTestId(`completed-post-${bookingId}`)).toBeVisible();
  });

  test('6 the seeker reviews it once; the reputation counts it; reload and fresh logins keep it all', async ({
    browser,
  }) => {
    const reviewUrl = `${REAL_API}/v1/me/bookings/${bookingId}/review`;
    const status = seekerPage.waitForResponse(isCall('GET', reviewUrl));
    await seekerPage.getByTestId(`completed-post-${bookingId}`).click();
    await status;
    await seekerPage.getByTestId('booking-review-open').click();
    await seekerPage.getByTestId('booking-review-star-5').click();
    await seekerPage.getByTestId('booking-review-comment').fill('R18: punctual and tidy');
    const posted = seekerPage.waitForResponse(isCall('POST', reviewUrl));
    // A double press is one review.
    await seekerPage.getByTestId('booking-review-submit').evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    expect((await posted).status()).toBe(201);
    await expect(seekerPage.getByTestId('booking-review-saved')).toBeVisible();

    const reputation = await withDb(async (db) => {
      const reviews = await db.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM "BookingReview" WHERE "bookingId" = $1`,
        [bookingId],
      );
      const profile = await db.query<{ reviewCount: number; ratingAvg: string }>(
        `SELECT "reviewCount", "ratingAvg"::text FROM "ProviderProfile" WHERE id = $1`,
        [provider.profileId],
      );
      return { reviews: reviews.rows[0].n, ...profile.rows[0] };
    });
    expect(reputation.reviews).toBe('1');
    expect(reputation.reviewCount).toBe(1);
    expect(Number(reputation.ratingAvg)).toBe(5);
    await seekerPage.reload();
    await expect(seekerPage.getByTestId('provider-rating')).toHaveAttribute(
      'data-review-count',
      '1',
    );

    // Fresh browser contexts, fresh real logins: everything is the server's.
    const freshSeeker = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const freshProvider = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const s = await freshSeeker.newPage();
      await seedLanguage(s, 'en');
      await signIn(s, seeker);
      await s.goto(`${BASE_URL}/home/profile`);
      await s.getByRole('button', { name: 'Completed Posts' }).click();
      await s.getByTestId(`completed-post-${bookingId}`).click();
      await expect(s.getByTestId('booking-review-saved-comment')).toHaveText(
        'R18: punctual and tidy',
      );
      await expect(s.getByTestId('booking-review-open')).toHaveCount(0);

      const p = await freshProvider.newPage();
      await seedLanguage(p, 'en');
      await signIn(p, provider);
      await p.goto(`${BASE_URL}/provider/bookings/${bookingId}`);
      await expect(p.getByTestId('provider-booking-status')).toHaveAttribute(
        'data-status',
        'COMPLETED',
      );
    } finally {
      await freshSeeker.close();
      await freshProvider.close();
    }
    // No side effect was duplicated across the whole journey.
    for (const userId of [seeker.userId, providerUserId])
      for (const [type, n] of Object.entries(counts(await notificationTypes(userId))))
        if (type !== 'MESSAGE_RECEIVED') expect(n, `${type} for ${userId}`).toBe(1);
  });

  test('7 another seeker in the same browser sees none of it, and every foreign resource is refused', async () => {
    const other = await registerSeeker('r18-other');
    // Positive control first: the owner can read each resource.
    expect((await api(seeker.jar, `/v1/me/requests/${requestId}`)).status).toBe(200);
    expect((await api(seeker.jar, `/v1/me/bookings/${bookingId}`)).status).toBe(200);
    expect(
      (await api(seeker.jar, `${CONVERSATIONS.replace(REAL_API, '')}/${conversationId}/messages`))
        .status,
    ).toBe(200);

    // UI: sign out through Settings, sign in as the other seeker.
    await seekerPage.goto(`${BASE_URL}/home/profile`);
    await seekerPage.getByRole('button', { name: 'Settings' }).click();
    await seekerPage.getByRole('button', { name: 'Sign Out' }).first().click();
    const loggedOut = seekerPage.waitForResponse(isCall('POST', `${REAL_API}/v1/auth/logout`));
    await seekerPage.getByRole('button', { name: 'Sign Out' }).last().click();
    expect((await loggedOut).status()).toBe(204);
    await expect(seekerPage).toHaveURL(/\/(login|select)/);
    await signIn(seekerPage, other);
    await seekerPage.goto(`${BASE_URL}/home/bookings`);
    await seekerPage.reload();
    await expect(seekerPage.getByTestId(`booking-card-${bookingId}`)).toHaveCount(0);
    await seekerPage.goto(`${BASE_URL}/home`);
    await expect(seekerPage.getByTestId('lead-card')).toHaveCount(0);
    await seekerPage.goto(`${BASE_URL}/home/messages`);
    await expect(seekerPage.getByText('R18 reply: on my way')).toHaveCount(0);

    // HTTP: a foreign request, booking, bid and conversation are refused, and
    // the refusal names nothing of the owner's.
    const refusals = [
      await api(other.jar, `/v1/me/requests/${requestId}`),
      await api(other.jar, `/v1/me/bookings/${bookingId}`),
      await api(other.jar, `/v1/me/requests/${requestId}/bids`),
      await api(other.jar, `/v1/me/requests/${requestId}/bids/${bidId}/accept`, { method: 'POST' }),
      await api(other.jar, `${CONVERSATIONS.replace(REAL_API, '')}/${conversationId}/messages`),
      await api(outsider.jar, `/v1/provider/bookings/${bookingId}`),
    ];
    for (const r of refusals) {
      expect([403, 404]).toContain(r.status);
      expect(JSON.stringify(r.body)).not.toContain(seeker.email);
      expect(JSON.stringify(r.body)).not.toContain('R18 hello');
    }
    // Unauthenticated: 401, nothing else.
    const anonymous = await api(new Map(), `/v1/me/bookings/${bookingId}`);
    expect(anonymous.status).toBe(401);
  });
});
