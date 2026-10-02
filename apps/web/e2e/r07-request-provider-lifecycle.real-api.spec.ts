import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
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
    body: { email, password, firstName: 'R07', lastName: 'Seeker' },
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
  items: Array<{ id: string; status: string }>;
}
interface ProviderBookingsResponse {
  items: Array<{ id: string; bidId: string; status: string }>;
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

      await providerPage.locator('input[type="number"]').last().fill('125');
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

      const bidsLoaded = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bids`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      const bookingsLoaded = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bookings`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      await providerPage.goto(`${BASE_URL}/provider/bids`);
      const bids = (await (await bidsLoaded).json()) as MyBidsResponse;
      const bookings = (await (await bookingsLoaded).json()) as ProviderBookingsResponse;
      expect(bids.items.find((item) => item.id === bid.bid.id)?.status).toBe('ACCEPTED');
      expect(bookings.items.find((item) => item.id === accepted.body.booking.id)).toMatchObject({
        bidId: bid.bid.id,
        status: 'SCHEDULED',
      });
      await expect(providerPage.getByText('Accepted', { exact: true }).first()).toBeVisible();
      await expect(
        providerPage.getByRole('button', { name: 'Start Job', exact: true }),
      ).toBeVisible();

      // Hard reload proves the provider workspace is server-derived, not a
      // mutation cache illusion.
      const bidsAfterReload = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bids`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      const bookingsAfterReload = providerPage.waitForResponse(
        (r) =>
          r.url().startsWith(`${REAL_API}/v1/provider/bookings`) &&
          r.request().method() === 'GET' &&
          r.status() === 200,
      );
      await providerPage.reload();
      expect(
        ((await (await bidsAfterReload).json()) as MyBidsResponse).items.find(
          (item) => item.id === bid.bid.id,
        )?.status,
      ).toBe('ACCEPTED');
      expect(
        ((await (await bookingsAfterReload).json()) as ProviderBookingsResponse).items.find(
          (item) => item.id === accepted.body.booking.id,
        )?.status,
      ).toBe('SCHEDULED');

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
});
