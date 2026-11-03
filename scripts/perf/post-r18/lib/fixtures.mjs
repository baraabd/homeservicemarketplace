// R27 — measurement fixtures created through the real API.
//
// Accounts register and verify by OTP, seekers post requests, providers bid
// and seekers accept, each through its guarded endpoint. Only the provider's
// admin approval and work-access grant are written directly, exactly as the
// R07/R12 real-API suites do, because those workflows are accepted elsewhere.

import { randomUUID } from 'node:crypto';

import { api, expectStatus, newJar, otpFor } from './http.mjs';

const tag = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// K02 — R27 measures a baseline build (develop before K02) and the
// candidate with the SAME harness, so the API generation is detected, not
// assumed: a K02 API publishes GET /v1/legal/documents (signup must name the
// exact versions; bids are decimal SAR), a pre-K02 API answers 404 (signup
// has no consent field; bids are the integer `amount`). Any other answer
// fails loudly.
let generation;
async function apiGeneration(jar) {
  if (generation) return generation;
  const result = await api(jar, '/v1/legal/documents');
  if (result.status === 404) {
    generation = { k02: false, legalAcceptance: null };
    return generation;
  }
  const docs = expectStatus(result, [200], 'legal documents').body;
  const v = (kind) => docs.documents.find((d) => d.kind === kind).version;
  generation = {
    k02: true,
    legalAcceptance: {
      termsVersion: v('TERMS_OF_SERVICE'),
      privacyVersion: v('PRIVACY_NOTICE'),
      locale: 'en',
    },
  };
  return generation;
}

async function verifiedAccount(role) {
  const jar = newJar();
  const email = `r27-${role}-${tag()}@perf.local`;
  const password = `R27-${randomUUID()}-Aa1!`;
  const registered = expectStatus(
    await api(jar, '/v1/auth/register', {
      method: 'POST',
      body: {
        email,
        password,
        firstName: 'Perf',
        lastName: role,
        ...((await apiGeneration(jar)).legalAcceptance
          ? { legalAcceptance: generation.legalAcceptance }
          : {}),
      },
    }),
    [200, 201, 202],
    `${role} register`,
  );
  expectStatus(
    await api(jar, '/v1/auth/verify-otp', {
      method: 'POST',
      body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
    }),
    200,
    `${role} verify-otp`,
  );
  return { email, jar };
}

export async function registerSeeker() {
  const account = await verifiedAccount('seeker');
  const address = expectStatus(
    await api(account.jar, '/v1/me/addresses', {
      method: 'POST',
      body: {
        label: 'Home',
        type: 'HOME',
        line1: '12 Measurement Street',
        city: 'Aleppo',
        country: 'Syria',
        isDefault: true,
      },
    }),
    [200, 201],
    'seeker address',
  );
  return { ...account, addressId: address.body.id };
}

export async function leafCategoryId(db) {
  const { rows } = await db.query(
    `SELECT id FROM "ServiceCategory"
      WHERE "isActive" AND "isLeaf" AND "deletedAt" IS NULL
      ORDER BY "sortOrder", id LIMIT 1`,
  );
  if (!rows[0]) throw new Error('the lane database has no selectable category (seed it first)');
  return rows[0].id;
}

/** A provider able to take work: real account, fixture approval and grant. */
export async function workingProvider(db, categoryId) {
  const account = await verifiedAccount('provider');
  const upgraded = expectStatus(
    await api(account.jar, '/v1/me/provider/upgrade', { method: 'POST', body: {} }),
    200,
    'provider upgrade',
  );
  // The access token minted at verify-otp predates the role grant.
  await api(account.jar, '/v1/auth/refresh', { method: 'POST' });
  const profileId = upgraded.body.profile.id;
  await db.query(
    `UPDATE "ProviderProfile"
        SET status = 'ACTIVE', "onboardingState" = 'ACCEPTED', "standingState" = 'GOOD',
            "verificationState" = 'VERIFIED', verified = TRUE,
            "serviceAreaCity" = 'Aleppo', "serviceAreaCityKey" = 'aleppo'
      WHERE id = $1`,
    [profileId],
  );
  await db.query('DELETE FROM "ProviderProfileServiceCategory" WHERE "providerProfileId" = $1', [
    profileId,
  ]);
  await db.query(
    `INSERT INTO "ProviderProfileServiceCategory" ("providerProfileId","serviceCategoryId","createdAt")
     VALUES ($1,$2,NOW())`,
    [profileId, categoryId],
  );
  await db.query(
    `INSERT INTO "ProviderWorkAccessGrant"
       ("id","providerProfileId","status","reason","source","grantedAt","expiresAt","createdAt","updatedAt")
     VALUES ($1,$2,'ACTIVE','R27_PERF_FIXTURE','VERIFIED_DOCUMENTS',
             NOW() - INTERVAL '1 minute', NOW() + INTERVAL '2 days', NOW(), NOW())`,
    [`r27grant-${randomUUID()}`, profileId],
  );
  return { ...account, profileId };
}

export async function postRequest(seeker, categoryId) {
  const created = expectStatus(
    await api(seeker.jar, '/v1/me/requests', {
      method: 'POST',
      body: {
        categoryId,
        customServiceText: null,
        description: 'R27 measurement request',
        mediaAssetIds: [],
        scheduleType: 'ASAP',
        scheduledAt: null,
        addressId: seeker.addressId,
        manualAddress: null,
      },
    }),
    201,
    'post request',
  );
  return created.body.id;
}

// K02 — `amount` is a whole number of SAR; the API takes the decimal string
// and stores halalas (e.g. 105 → "105" → 10500 at scale 2).
export async function submitBid(provider, requestId, amount) {
  const bid = expectStatus(
    await api(provider.jar, '/v1/provider/bids', {
      method: 'POST',
      body: (await apiGeneration(provider.jar)).k02
        ? { requestId, amountDecimal: String(amount), currency: 'SAR', pricingType: 'FIXED' }
        : { requestId, amount, pricingType: 'FIXED' },
    }),
    201,
    'submit bid',
  );
  return bid.body.bid.id;
}

export async function acceptBid(seeker, requestId, bidId) {
  const accepted = expectStatus(
    await api(seeker.jar, `/v1/me/requests/${requestId}/bids/${bidId}/accept`, { method: 'POST' }),
    200,
    'accept bid',
  );
  return accepted.body.booking.id;
}

/** The seeded development admin, signed in by password + OTP. */
export async function adminSession() {
  const jar = newJar();
  const email = 'test1@admin.com';
  const login = expectStatus(
    await api(jar, '/v1/auth/login', {
      method: 'POST',
      // Development seed credential printed by `database seed`; lane-only DB.
      body: { email, password: 'DevAdmin123!' },
    }),
    200,
    'admin login',
  );
  if (login.body?.otpRequired) {
    expectStatus(
      await api(jar, '/v1/auth/verify-otp', {
        method: 'POST',
        body: { challengeId: login.body.challengeId, code: await otpFor(email) },
      }),
      200,
      'admin verify-otp',
    );
  }
  return { email, jar };
}
