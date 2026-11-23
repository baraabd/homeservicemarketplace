import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { LEGAL_ACCEPTANCE } from './legal-acceptance';
import {
  api,
  newJar,
  otpFor,
  REAL_API,
  registerProvider,
  type Account,
  type Jar,
} from './real-api';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

async function registerSeeker(): Promise<Account> {
  const jar = newJar();
  const email = `r07-seeker-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = `R07-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: {
      email,
      password,
      firstName: 'R07',
      lastName: 'Seeker',
      legalAcceptance: LEGAL_ACCEPTANCE,
    },
  });
  expect(registered.status, 'R07 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R07 seeker OTP should verify').toBe(200);
  return { email, password, jar, profileId: '' };
}

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

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R07 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * R07 is not an onboarding acceptance suite. Accounts and provider roles are
 * created through public endpoints; only the already-tested admin decision /
 * work-access outcome is seeded so this test can exercise the marketplace
 * lifecycle itself through real guarded routes.
 */
async function makeWorkingProvider(
  account: Account,
  categoryId: string,
  city: string,
  cityKey: string,
): Promise<void> {
  await withDb(async (db) => {
    await db.query(
      `UPDATE "ProviderProfile"
          SET status = 'ACTIVE',
              "onboardingState" = 'ACCEPTED',
              "standingState" = 'GOOD',
              "verificationState" = 'VERIFIED',
              verified = TRUE,
              "serviceAreaCity" = $2,
              "serviceAreaCityKey" = $3
        WHERE id = $1`,
      [account.profileId, city, cityKey],
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
       VALUES ($1,$2,'ACTIVE','R07_BROWSER_FIXTURE','VERIFIED_DOCUMENTS',
               NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [`r07grant-${randomUUID()}`, account.profileId],
    );
  });
}

interface FeedItem {
  id: string;
}
interface FeedResponse {
  items: FeedItem[];
}
interface BidResponse {
  // MyBidSummary nests the request; there is no flat `requestId` on the wire.
  bid: { id: string; status: string; request: { id: string } };
}
interface AcceptResponse {
  bid: { id: string; status: string };
  booking: { id: string; bidId: string; status: string };
  requestStatus: string;
}
interface MyBidsResponse {
  items: Array<{
    id: string;
    status: string;
    booking: { id: string; status: string } | null;
  }>;
}

async function feedLoadedByApp(page: Page, action: () => Promise<unknown>): Promise<FeedResponse> {
  const response = page.waitForResponse(
    (r) =>
      r.url().startsWith(`${REAL_API}/v1/provider/available-requests`) &&
      r.request().method() === 'GET' &&
      r.status() === 200,
  );
  await action();
  return (await (await response).json()) as FeedResponse;
}

test.describe('R07 request-to-provider lifecycle — real browsers, API and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R07 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  test('seeker creates -> only eligible provider sees -> bid -> accept -> booking survives reload', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const seeker = await registerSeeker();
    const address = await api<{ id: string }>(seeker.jar, '/v1/me/addresses', {
      method: 'POST',
      body: {
        label: 'R07 Home',
        type: 'HOME',
        line1: '7 Lifecycle Street',
        city: 'Aleppo',
        country: 'Syria',
        isDefault: true,
      },
    });
    expect(address.status).toBeLessThan(300);

    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await page.goto(`${BASE_URL}/home`);
    await page.getByTestId('service-categories-grid').getByRole('button').first().click();
    await page.getByRole('button', { name: /next step/i }).click();
    const confirm = page.getByRole('button', { name: /confirm job/i });
    await expect(confirm).toBeVisible();

    const createdResponse = page.waitForResponse(
      (r) => r.url() === `${REAL_API}/v1/me/requests` && r.request().method() === 'POST',
    );
    await confirm.click();
    const createdHttp = await createdResponse;
    expect(createdHttp.status(), await createdHttp.text()).toBe(201);

    const sent = createdHttp.request().postDataJSON() as Record<string, unknown>;
    expect(sent.idempotencyKey).toEqual(expect.any(String));
    expect((sent.idempotencyKey as string).length).toBeGreaterThanOrEqual(16);

    const created = (await createdHttp.json()) as { id: string };
    const requestRow = await withDb(async (db) => {
      const result = await db.query<{ categoryId: string; cityKey: string | null }>(
        `SELECT "categoryId", "locationCityKey" AS "cityKey"
           FROM "ServiceRequest"
          WHERE id = $1`,
        [created.id],
      );
      return result.rows[0];
    });
    expect(requestRow?.categoryId).toBeTruthy();
    expect(requestRow?.cityKey).toBe('aleppo');

    const eligible = await registerProvider();
    const ineligible = await registerProvider();
    await makeWorkingProvider(eligible, requestRow.categoryId, 'Aleppo', 'aleppo');
    await makeWorkingProvider(ineligible, requestRow.categoryId, 'Damascus', 'damascus');

    // An ineligible provider is fully work-authorised, but this request is
    // outside their service area. The APP's own feed fetch must omit it.
    const ineligibleContext = await browser.newContext();
    try {
      await applySession(ineligibleContext, ineligible.jar);
      const ineligiblePage = await ineligibleContext.newPage();
      await seedLanguage(ineligiblePage, 'en');
      const hidden = await feedLoadedByApp(ineligiblePage, () =>
        ineligiblePage.goto(`${BASE_URL}/provider/jobs`),
      );
      expect(hidden.items.some((item) => item.id === created.id)).toBe(false);
      await ineligiblePage.getByTestId('pull-up-control').click({ force: true });
      await expect(ineligiblePage.getByTestId(`job-card-${created.id}`)).toHaveCount(0);
    } finally {
      await ineligibleContext.close();
    }

    // Declared out here: the database assertions after the provider context
    // closes need the bid that was accepted inside it.
    let acceptedBidId = '';
    const providerContext = await browser.newContext();
    try {
      await applySession(providerContext, eligible.jar);
      const providerPage = await providerContext.newPage();
      await seedLanguage(providerPage, 'en');

      const firstFeed = await feedLoadedByApp(providerPage, () =>
        providerPage.goto(`${BASE_URL}/provider/jobs`),
      );
      expect(firstFeed.items.some((item) => item.id === created.id)).toBe(true);

      const reloadedFeed = await feedLoadedByApp(providerPage, () => providerPage.reload());
      expect(reloadedFeed.items.some((item) => item.id === created.id)).toBe(true);

      await providerPage.getByTestId('pull-up-control').click({ force: true });
      const card = providerPage.getByTestId(`job-card-${created.id}`);
      await expect(card).toBeVisible();
      await card.click();
      await providerPage.getByTestId('job-detail-place-bid').click();

      await providerPage.locator('#bid-price-input').fill('125');
      await providerPage.getByRole('button', { name: '30 min', exact: true }).click();
      await providerPage.locator('textarea').last().fill('R07 real-browser lifecycle offer');

      const bidResponse = providerPage.waitForResponse(
        (r) => r.url() === `${REAL_API}/v1/provider/bids` && r.request().method() === 'POST',
      );
      await providerPage.getByRole('button', { name: 'Send Offer', exact: true }).click();
      const bidHttp = await bidResponse;
      expect(bidHttp.status(), await bidHttp.text()).toBe(201);
      const bid = (await bidHttp.json()) as BidResponse;
      expect(bid.bid.request.id).toBe(created.id);
      acceptedBidId = bid.bid.id;

      // The seeker accepts through the real ownership + CSRF guarded command.
      const accepted = await api<AcceptResponse>(
        seeker.jar,
        `/v1/me/requests/${created.id}/bids/${bid.bid.id}/accept`,
        { method: 'POST' },
      );
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
      expect(accepted.body.bid.status).toBe('ACCEPTED');
      expect(accepted.body.requestStatus).toBe('BID_ACCEPTED');
      expect(accepted.body.booking.bidId).toBe(bid.bid.id);

      // My Bids now carries the authoritative booking projection with every
      // accepted bid. It deliberately no longer reads the bookings-list API,
      // so waiting for that old request would hang until this test timed out.
      const bidsLoaded = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bids`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      await providerPage.goto(`${BASE_URL}/provider/bids`);
      const bids = (await (await bidsLoaded).json()) as MyBidsResponse;
      const acceptedBid = bids.items.find((item) => item.id === bid.bid.id);
      expect(acceptedBid).toMatchObject({
        status: 'ACCEPTED',
        booking: { id: accepted.body.booking.id, status: 'SCHEDULED' },
      });
      await expect(providerPage.getByText('Accepted', { exact: true }).first()).toBeVisible();
      await expect(
        providerPage.getByRole('button', { name: 'Start Job', exact: true }),
      ).toBeVisible();

      // Hard reload proves the provider workspace is server-derived, not a
      // mutation cache illusion. The same bid projection must still point to
      // the same persisted booking after a fresh HTTP read.
      const bidsAfterReload = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bids`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      await providerPage.reload();
      const reloadedBid = ((await (await bidsAfterReload).json()) as MyBidsResponse).items.find(
        (item) => item.id === bid.bid.id,
      );
      expect(reloadedBid).toMatchObject({
        status: 'ACCEPTED',
        booking: { id: accepted.body.booking.id, status: 'SCHEDULED' },
      });

      await testInfo.attach('r07-provider-booking-after-reload.png', {
        body: await providerPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await providerContext.close();
    }

    const durable = await withDb(async (db) => {
      const result = await db.query<{
        requestStatus: string;
        bidStatus: string;
        bookingStatus: string;
        idempotencyKey: string | null;
      }>(
        `SELECT r.status AS "requestStatus",
                r."idempotencyKey",
                b.status AS "bidStatus",
                bk.status AS "bookingStatus"
           FROM "ServiceRequest" r
           JOIN "Bid" b ON b."requestId" = r.id
           JOIN "Booking" bk ON bk."bidId" = b.id
          WHERE r.id = $1 AND b.id = $2`,
        [created.id, acceptedBidId],
      );
      return result.rows[0];
    });
    expect(durable).toMatchObject({
      requestStatus: 'BID_ACCEPTED',
      bidStatus: 'ACCEPTED',
      bookingStatus: 'SCHEDULED',
      idempotencyKey: sent.idempotencyKey,
    });
  });

  // K04 — one customer and two providers through the real guarded routes.
  //
  // The race itself is pinned with barriers in r07-marketplace-races; this
  // proves the same rule at the HTTP boundary the customer actually uses: an
  // accepted request can no longer be edited, the refusal is a safe 409 that
  // changes nothing, and seeker, provider and database agree on the booking.
  test('K04: two providers bid, one is booked, and the booked request is frozen for every actor', async () => {
    const seeker = await registerSeeker();
    const stranger = await registerSeeker();
    const address = await api<{ id: string }>(seeker.jar, '/v1/me/addresses', {
      method: 'POST',
      body: {
        label: 'K04 Home',
        type: 'HOME',
        line1: '4 Lifecycle Street',
        city: 'Aleppo',
        country: 'Syria',
        isDefault: true,
      },
    });
    expect(address.status).toBeLessThan(300);

    const categoryId = await withDb(async (db) => {
      const result = await db.query<{ id: string }>(
        `SELECT id FROM "ServiceCategory" WHERE "isActive" AND "isLeaf" ORDER BY id LIMIT 1`,
      );
      return result.rows[0]?.id;
    });
    expect(categoryId, 'a seeded active leaf category is required').toBeTruthy();

    const scheduledAt = new Date(Date.now() + 48 * 3_600_000).toISOString();
    const created = await api<{ id: string; scheduledAt: string; description: string }>(
      seeker.jar,
      '/v1/me/requests',
      {
        method: 'POST',
        body: {
          categoryId,
          description: 'K04 original description',
          scheduleType: 'LATER',
          scheduledAt,
          addressId: address.body.id,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const requestId = created.body.id;

    const first = await registerProvider();
    const second = await registerProvider();
    await makeWorkingProvider(first, categoryId!, 'Aleppo', 'aleppo');
    await makeWorkingProvider(second, categoryId!, 'Aleppo', 'aleppo');

    const offer = (account: Account, amountDecimal: string) =>
      api<BidResponse>(account.jar, '/v1/provider/bids', {
        method: 'POST',
        body: {
          requestId,
          amountDecimal,
          currency: 'SAR',
          pricingType: 'FIXED',
          note: 'K04 offer',
        },
      });
    const offerA = await offer(first, '125.00');
    const offerB = await offer(second, '90.00');
    expect(offerA.status, JSON.stringify(offerA.body)).toBe(201);
    expect(offerB.status, JSON.stringify(offerB.body)).toBe(201);

    // Comparison: the seeker sees both offers on their own request.
    const compared = await api<{ items: Array<{ id: string; status: string }> }>(
      seeker.jar,
      `/v1/me/requests/${requestId}/bids`,
    );
    expect(compared.status).toBe(200);
    expect(compared.body.items.map((b) => b.id).sort()).toEqual(
      [offerA.body.bid.id, offerB.body.bid.id].sort(),
    );

    // While open, the owner may edit.
    const openEdit = await api<{ description: string }>(
      seeker.jar,
      `/v1/me/requests/${requestId}`,
      {
        method: 'PATCH',
        body: { description: 'K04 edited while open' },
      },
    );
    expect(openEdit.status, JSON.stringify(openEdit.body)).toBe(200);
    expect(openEdit.body.description).toBe('K04 edited while open');

    const accepted = await api<AcceptResponse>(
      seeker.jar,
      `/v1/me/requests/${requestId}/bids/${offerA.body.bid.id}/accept`,
      { method: 'POST' },
    );
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    const bookingId = accepted.body.booking.id;

    // A second acceptance (lost response retried, or the other offer) is refused.
    const again = await api(
      seeker.jar,
      `/v1/me/requests/${requestId}/bids/${offerB.body.bid.id}/accept`,
      { method: 'POST' },
    );
    expect(again.status).toBe(409);

    // The booked request is frozen: the owner's edit is a safe conflict.
    const lateEdit = await api<Record<string, unknown>>(
      seeker.jar,
      `/v1/me/requests/${requestId}`,
      {
        method: 'PATCH',
        body: {
          description: 'K04 edit after booking',
          scheduledAt: new Date(Date.now() + 96 * 3_600_000).toISOString(),
        },
      },
    );
    expect(lateEdit.status).toBe(409);
    const leaked = JSON.stringify(lateEdit.body);
    expect(leaked).not.toMatch(/prisma|P20\d\d|stack|SELECT|FOR UPDATE/i);

    // Another customer cannot touch, or learn about, this request or booking.
    for (const [method, path, body] of [
      ['PATCH', `/v1/me/requests/${requestId}`, { description: 'hijack' }],
      ['POST', `/v1/me/requests/${requestId}/cancel`, undefined],
      ['GET', `/v1/me/requests/${requestId}/bids`, undefined],
      ['GET', `/v1/me/bookings/${bookingId}`, undefined],
    ] as const) {
      const attempt = await api(stranger.jar, path, { method, body });
      expect(attempt.status, `${method} ${path}`).toBe(404);
    }
    // The provider who was not booked cannot open the booking.
    const rivalRead = await api(second.jar, `/v1/provider/bookings/${bookingId}`);
    expect(rivalRead.status).toBe(404);

    // Seeker, booked provider and the database agree on what was booked.
    const seekerView = await api<{
      status: string;
      priceAmount: number;
      currency: string;
      scheduledAt: string | null;
    }>(seeker.jar, `/v1/me/bookings/${bookingId}`);
    const providerView = await api<{
      status: string;
      priceAmount: number;
      currency: string;
      scheduledAt: string | null;
    }>(first.jar, `/v1/provider/bookings/${bookingId}`);
    expect(seekerView.status).toBe(200);
    expect(providerView.status).toBe(200);
    expect(seekerView.body).toMatchObject({ priceAmount: 12500, currency: 'SAR', amountScale: 2 });
    expect(providerView.body).toMatchObject({
      priceAmount: 12500,
      currency: 'SAR',
      amountScale: 2,
    });
    for (const key of ['status', 'priceAmount', 'currency', 'scheduledAt'] as const) {
      expect(providerView.body[key], key).toEqual(seekerView.body[key]);
    }

    const durable = await withDb(async (db) => {
      const result = await db.query<{
        requestStatus: string;
        description: string;
        sameTime: boolean;
        bookingAtUtc: string | null;
        priceAmount: number;
        currency: string;
        rivalStatus: string;
      }>(
        // Compared and rendered in SQL: the columns are timestamp without time
        // zone holding UTC, and node-pg would parse them in the host's zone.
        `SELECT r.status AS "requestStatus", r.description,
                r."scheduledAt" IS NOT DISTINCT FROM bk."scheduledAt" AS "sameTime",
                to_char(bk."scheduledAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "bookingAtUtc",
                bk."priceAmount", bk.currency,
                (SELECT status FROM "Bid" WHERE id = $3) AS "rivalStatus"
           FROM "ServiceRequest" r
           JOIN "Booking" bk ON bk."requestId" = r.id
          WHERE r.id = $1 AND bk.id = $2`,
        [requestId, bookingId, offerB.body.bid.id],
      );
      return result.rows[0];
    });
    expect(durable).toMatchObject({
      requestStatus: 'BID_ACCEPTED',
      description: 'K04 edited while open',
      rivalStatus: 'REJECTED',
      currency: seekerView.body.currency,
    });
    expect(Number(durable.priceAmount)).toBe(seekerView.body.priceAmount);
    // The booked time is the request's time, and what both parties are shown.
    expect(durable.sameTime).toBe(true);
    expect(durable.bookingAtUtc).toBe(seekerView.body.scheduledAt);
  });
});
