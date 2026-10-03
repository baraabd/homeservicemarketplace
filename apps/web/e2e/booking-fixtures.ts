import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, type BrowserContext } from '@playwright/test';

import {
  api,
  newJar,
  otpFor,
  REAL_API,
  registerProvider,
  type Account,
  type Jar,
} from './real-api';

// Real bookings for real-service specs (R12).
//
// A seeker registers through the public endpoints and posts a request, a
// provider bids, the seeker accepts, each through its own guarded endpoint.
// Only the provider's admin approval, which is accepted elsewhere, is written
// directly, exactly as R07 and R11 do.

export async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface Seeker extends Account {
  userId: string;
  addressId: string;
}

export async function registerSeeker(tag: string): Promise<Seeker> {
  const jar = newJar();
  const email = `${tag}-seeker-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = `${tag.toUpperCase()}-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'Rami', lastName: 'Seeker' },
  });
  expect(registered.status, 'seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'seeker OTP should verify').toBe(200);
  const address = await api<{ id: string }>(jar, '/v1/me/addresses', {
    method: 'POST',
    body: {
      label: 'Home',
      type: 'HOME',
      line1: '12 Message Street',
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

export async function leafCategoryId(): Promise<string> {
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

export async function workingProvider(categoryId: string, tag: string): Promise<Account> {
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
       VALUES ($1,$2,'ACTIVE',$3,'VERIFIED_DOCUMENTS',
               NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 day', NOW(), NOW())`,
      [`${tag}grant-${randomUUID()}`, account.profileId, `${tag.toUpperCase()}_BROWSER_FIXTURE`],
    );
  });
  return account;
}

/** Request -> bid -> accept, through the real endpoints. Returns the booking id. */
export async function scheduledBooking(
  seeker: Seeker,
  provider: Account,
  categoryId: string,
): Promise<string> {
  const request = await api<{ id: string }>(seeker.jar, '/v1/me/requests', {
    method: 'POST',
    body: {
      categoryId,
      customServiceText: null,
      description: 'Booking communication acceptance job',
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

export async function providerMoves(
  provider: Account,
  bookingId: string,
  to: 'start' | 'complete',
): Promise<void> {
  const moved = await api(provider.jar, `/v1/me/provider/bookings/${bookingId}/${to}`, {
    method: 'POST',
  });
  expect(moved.status, `${to}: ${JSON.stringify(moved.body)}`).toBeLessThan(300);
}

export async function applySession(context: BrowserContext, jar: Jar): Promise<void> {
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
