import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { api, loginViaUi, newJar, otpFor, REAL_API, type Account, type Jar } from './real-api';

// R06 — request media authority, through the real browser, API, storage and
// Postgres. Nothing here is stubbed: the wizard uploads real bytes to the real
// signed-upload route, the API verifies what was stored, and the assertions
// read the database directly.
//
// The matching-provider and booking projections are proved against real
// Postgres in apps/api/test/integration/r06-request-media.integration.spec.ts;
// activating a provider end to end needs the evidence pipeline, which this job
// does not run.

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';

/** A real 1x1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==',
  'base64',
);
/** The same length as PNG, but an HTML document. */
const NOT_AN_IMAGE = Buffer.from(
  '<!doctype html><script>alert(1)</script>'.padEnd(PNG.byteLength, ' '),
).subarray(0, PNG.byteLength);

interface Reservation {
  assetId: string;
  uploadUrl: string;
  fileUrl: string;
}

async function registerSeeker(label: string): Promise<Account> {
  const jar = newJar();
  const email = `r06-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  // Generated per account so the fixture carries no reusable credential.
  const password = `R06-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'R06', lastName: label },
  });
  expect(registered.status, 'R06 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R06 seeker OTP should verify').toBe(200);
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
  if (!url) throw new Error('R06 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function reserve(jar: Jar, sizeBytes = PNG.byteLength): Promise<Reservation> {
  const presigned = await api<{ items: Reservation[] }>(jar, '/v1/media/presigned-url', {
    method: 'POST',
    body: { items: [{ contentType: 'image/png', sizeBytes }] },
  });
  expect(presigned.status, 'a request-attachment presign should be granted').toBe(200);
  return presigned.body.items[0];
}

async function put(uploadUrl: string, body: Buffer, contentType = 'image/png'): Promise<number> {
  const target = uploadUrl.startsWith('http') ? uploadUrl : `${REAL_API}${uploadUrl}`;
  const response = await fetch(target, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    // Copied into a plain ArrayBuffer-backed view: that is what `fetch`
    // accepts as a body, and a Buffer slice may sit on a shared pool.
    body: new Uint8Array(body),
  });
  return response.status;
}

const finalize = (jar: Jar, assetIds: string[]) =>
  api<{
    items?: Array<{ assetId: string; fileUrl: string }>;
    error?: { details?: { reason?: string } };
  }>(jar, '/v1/media/request-attachments/finalize', { method: 'POST', body: { assetIds } });

async function readyAsset(jar: Jar): Promise<Reservation> {
  const reservation = await reserve(jar);
  expect(await put(reservation.uploadUrl, PNG)).toBeLessThan(300);
  expect((await finalize(jar, [reservation.assetId])).status).toBe(200);
  return reservation;
}

const requestBody = (extra: Record<string, unknown>) => ({
  categoryId: null,
  customServiceText: 'R06 attachment acceptance',
  description: null,
  scheduleType: 'ASAP',
  scheduledAt: null,
  addressId: null,
  manualAddress: { line1: '1 Test Street', city: 'Aleppo', country: 'Syria' },
  ...extra,
});

const createRequest = (jar: Jar, extra: Record<string, unknown>) =>
  api<{ id: string; mediaUrls: string[] }>(jar, '/v1/me/requests', {
    method: 'POST',
    body: requestBody(extra),
  });

interface SeenRequest {
  id: string;
  mediaUrls: string[];
}

/**
 * Load the seeker's home in the browser and return what the APP ITSELF fetched.
 *
 * Not an API call made by the test: this waits for the request list the page
 * requests on load, so it is the browser session's own view of server state.
 */
async function requestsSeenByTheApp(page: Page): Promise<SeenRequest[]> {
  const listed = page.waitForResponse(
    (r) =>
      r.url().startsWith(`${REAL_API}/v1/me/requests`) &&
      r.request().method() === 'GET' &&
      r.status() === 200,
  );
  await page.goto(`${BASE_URL}/home`);
  return ((await (await listed).json()) as { items: SeenRequest[] }).items;
}

/**
 * The browser session retrieves the stored object and decodes it as an image.
 *
 * A CORS fetch plus `createImageBitmap`, not an `<img>` element: in this job's
 * split-port topology the local-disk file route's
 * `Cross-Origin-Resource-Policy: same-site` header blocks `<img>` embedding
 * (net::ERR_BLOCKED_BY_RESPONSE.NotSameSite). That header and route are
 * unchanged by R06 and are recorded as a finding in
 * docs/production-readiness/r06/IMPLEMENTATION.md; production serves media from
 * object storage, not from this route.
 */
async function expectImageDecodes(page: Page, url: string): Promise<void> {
  const decoded = await page.evaluate(async (src) => {
    const response = await fetch(src, { mode: 'cors', credentials: 'omit' });
    if (!response.ok) return { status: response.status };
    const bitmap = await createImageBitmap(await response.blob());
    return { status: response.status, width: bitmap.width, height: bitmap.height };
  }, url);
  expect(decoded, 'the stored attachment should decode as an image in the browser').toEqual({
    status: 200,
    width: 1,
    height: 1,
  });
}

test.describe('R06 request media authority — real browser, API, storage and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R06 real-service acceptance.');
  test.describe.configure({ timeout: 180_000 });

  test('the wizard attaches a verified upload; it survives reload and a fresh login', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const account = await registerSeeker('wizard');
    const address = await api<{ id: string }>(account.jar, '/v1/me/addresses', {
      method: 'POST',
      body: {
        label: 'Home',
        type: 'HOME',
        line1: '10 Citadel Street',
        city: 'Aleppo',
        country: 'Syria',
        isDefault: true,
      },
    });
    expect(address.status, 'the seeker needs a saved address for the wizard').toBeLessThan(300);

    await applySession(context, account.jar);
    await seedLanguage(page, 'en');
    await page.goto(`${BASE_URL}/home`);

    await page.getByTestId('service-categories-grid').getByRole('button').first().click();
    await page.getByTestId('job-wizard-media-input').setInputFiles({
      name: 'leak.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.getByRole('button', { name: /next step/i }).click();
    const confirm = page.getByRole('button', { name: /confirm job/i });
    await expect(confirm).toBeVisible();
    // The saved default address is loaded from the server into the form.
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('input, textarea')].some((el) =>
            (el as HTMLInputElement).value.includes('10 Citadel Street'),
          ),
        ),
      )
      .toBe(true);

    const finalized = page.waitForResponse(
      (r) =>
        r.url() === `${REAL_API}/v1/media/request-attachments/finalize` &&
        r.request().method() === 'POST',
    );
    const created = page.waitForResponse(
      (r) => r.url() === `${REAL_API}/v1/me/requests` && r.request().method() === 'POST',
    );
    await confirm.click();

    const finalizeResponse = await finalized;
    expect(finalizeResponse.status()).toBe(200);
    const createResponse = await created;
    expect(createResponse.status(), await createResponse.text()).toBeLessThan(300);

    // What the browser SENT: asset ids, and no URL of any kind.
    const sent = createResponse.request().postDataJSON() as Record<string, unknown>;
    expect(sent).not.toHaveProperty('mediaUrls');
    expect(JSON.stringify(sent)).not.toMatch(/https?:\/\//);
    const sentIds = sent.mediaAssetIds as string[];
    expect(sentIds).toHaveLength(1);

    // What the server STORED, derived from its own records.
    const request = (await createResponse.json()) as { id: string; mediaUrls: string[] };
    expect(request.mediaUrls).toHaveLength(1);
    expect(request.mediaUrls[0]).toMatch(
      /\/v1\/media\/files\/requests\/[0-9a-f]{24}\/[0-9a-f-]{36}\.png$/,
    );

    const row = await withDb(async (db) => {
      const result = await db.query(
        `SELECT a."ownerUserId", a.purpose, a.visibility, a."serviceRequestId", a."requestAttachmentPosition",
                a."declaredMimeType", a."detectedMimeType", a."sizeBytes", a."uploadCompletedAt", a."requestClaimedAt",
                a."storageKey", u.email, r."mediaUrls"
           FROM "MediaAsset" a
           JOIN "User" u ON u.id = a."ownerUserId"
           JOIN "ServiceRequest" r ON r.id = a."serviceRequestId"
          WHERE a.id = $1`,
        [sentIds[0]],
      );
      return result.rows[0];
    });
    expect(row).toMatchObject({
      email: account.email,
      purpose: 'REQUEST_ATTACHMENT',
      visibility: 'PUBLIC',
      serviceRequestId: request.id,
      requestAttachmentPosition: 0,
      declaredMimeType: 'image/png',
      detectedMimeType: 'image/png',
      sizeBytes: PNG.byteLength,
      mediaUrls: request.mediaUrls,
    });
    expect(row.uploadCompletedAt).not.toBeNull();
    expect(row.requestClaimedAt).not.toBeNull();
    expect(request.mediaUrls[0].endsWith(row.storageKey)).toBe(true);
    // The key does not publish the internal user id.
    expect(row.storageKey).not.toContain(row.ownerUserId);

    // The stored object is exactly what was uploaded.
    const served = await fetch(request.mediaUrls[0]);
    expect(served.status).toBe(200);
    expect(Buffer.from(await served.arrayBuffer()).equals(PNG)).toBe(true);

    // Hard reload: a full navigation discards every in-memory cache, and the app
    // re-reads the request, with its media, from the server.
    //
    // The rendered gallery component is covered by its own unit tests
    // (JobDetailView.test.tsx, RequestMediaGallery). What is asserted here is
    // what only a real stack can show: the persisted projection reaches the
    // browser, and the stored object decodes as an image there.
    const afterReload = await requestsSeenByTheApp(page);
    expect(afterReload.find((r) => r.id === request.id)?.mediaUrls).toEqual(request.mediaUrls);
    await expectImageDecodes(page, request.mediaUrls[0]);
    const shot = testInfo.outputPath('r06-seeker-home-after-reload.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('r06-seeker-home-after-reload', { path: shot, contentType: 'image/png' });

    // Fresh login in a clean browser context: nothing carried over.
    const fresh = await browser.newContext();
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/login`);
      await loginViaUi(freshPage, account);
      await freshPage.waitForURL(/\/home/);
      const afterLogin = await requestsSeenByTheApp(freshPage);
      expect(afterLogin.find((r) => r.id === request.id)?.mediaUrls).toEqual(request.mediaUrls);
      await expectImageDecodes(freshPage, request.mediaUrls[0]);
      const freshShot = testInfo.outputPath('r06-seeker-home-fresh-login.png');
      await freshPage.screenshot({ path: freshShot, fullPage: true });
      await testInfo.attach('r06-seeker-home-fresh-login', {
        path: freshShot,
        contentType: 'image/png',
      });
    } finally {
      await fresh.close();
    }
  });

  test('the real API refuses URLs, foreign assets, replays and unverified uploads', async () => {
    const owner = await registerSeeker('owner');
    const intruder = await registerSeeker('intruder');
    const count = (email: string) =>
      withDb(async (db) => {
        const result = await db.query(
          `SELECT count(*)::int AS n FROM "ServiceRequest" r JOIN "User" u ON u.id = r."seekerUserId" WHERE u.email = $1`,
          [email],
        );
        return result.rows[0].n as number;
      });

    // URL injection through the legacy field: any element is refused, whether
    // it points elsewhere or imitates a URL this server would issue.
    for (const mediaUrls of [
      ['https://evil.example/tracker.gif'],
      [`${REAL_API}/v1/media/files/requests/${'a'.repeat(24)}/${randomUUID()}.png`],
    ]) {
      const injected = await createRequest(owner.jar, { mediaUrls });
      expect(injected.status, 'a URL must never be accepted').toBe(400);
    }
    // A URL in place of an asset id.
    expect(
      (await createRequest(owner.jar, { mediaAssetIds: ['https://evil.example/x.png'] })).status,
    ).toBe(400);
    expect(await count(owner.email)).toBe(0);

    // Rollout compatibility: a bundle built before R06 sends an EMPTY legacy
    // list on every request. It still posts, and stores no media.
    const legacy = await createRequest(owner.jar, { mediaUrls: [] });
    expect(legacy.status, JSON.stringify(legacy.body)).toBeLessThan(300);
    expect(legacy.body.mediaUrls).toEqual([]);
    expect(await count(owner.email)).toBe(1);

    // Another user's finalized asset: same answer as an id that does not exist.
    const asset = await readyAsset(owner.jar);
    const foreign = await createRequest(intruder.jar, { mediaAssetIds: [asset.assetId] });
    const unknown = await createRequest(intruder.jar, {
      mediaAssetIds: ['cldoesnotexist0000000000000'],
    });
    expect(foreign.status).toBe(409);
    expect(unknown.status).toBe(409);
    // Identical apart from the per-request correlation id.
    const withoutCorrelationId = (body: unknown) =>
      JSON.stringify(body).replace(/"requestId":"[^"]+"/, '');
    expect(withoutCorrelationId(foreign.body)).toBe(withoutCorrelationId(unknown.body));
    expect((await finalize(intruder.jar, [asset.assetId])).status).toBe(409);
    expect(await count(intruder.email)).toBe(0);

    // The owner can still use it — once.
    const first = await createRequest(owner.jar, { mediaAssetIds: [asset.assetId] });
    expect(first.status, JSON.stringify(first.body)).toBeLessThan(300);
    expect(first.body.mediaUrls).toEqual([asset.fileUrl]);
    const replay = await createRequest(owner.jar, { mediaAssetIds: [asset.assetId] });
    expect(replay.status).toBe(409);
    expect(await count(owner.email)).toBe(2);

    // Reserved but never uploaded.
    const empty = await reserve(owner.jar);
    const missing = await finalize(owner.jar, [empty.assetId]);
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain('FILE_MISSING');
    expect((await createRequest(owner.jar, { mediaAssetIds: [empty.assetId] })).status).toBe(409);

    // Uploaded but not verified.
    const unverified = await reserve(owner.jar);
    expect(await put(unverified.uploadUrl, PNG)).toBeLessThan(300);
    expect((await createRequest(owner.jar, { mediaAssetIds: [unverified.assetId] })).status).toBe(
      409,
    );

    // A partial object never lands: the signed upload rejects the short body.
    const partial = await reserve(owner.jar);
    expect(await put(partial.uploadUrl, PNG.subarray(0, 10))).toBe(400);
    expect(JSON.stringify((await finalize(owner.jar, [partial.assetId])).body)).toContain(
      'FILE_MISSING',
    );

    // The right size and transport type, but not an image.
    const disguised = await reserve(owner.jar);
    expect(await put(disguised.uploadUrl, NOT_AN_IMAGE)).toBeLessThan(300);
    const rejected = await finalize(owner.jar, [disguised.assetId]);
    expect(rejected.status).toBe(400);
    expect(JSON.stringify(rejected.body)).toContain('CONTENT_MISMATCH');

    // Verified bytes cannot be replaced through the still-valid signed URL.
    const fixed = await readyAsset(owner.jar);
    expect(await put(fixed.uploadUrl, NOT_AN_IMAGE)).toBe(409);
    const stillPng = await fetch(fixed.fileUrl);
    expect(Buffer.from(await stillPng.arrayBuffer()).equals(PNG)).toBe(true);

    // Anonymous callers get nothing.
    const anonymous = newJar();
    expect((await finalize(anonymous, [fixed.assetId])).status).toBe(401);

    // Nothing above left a second request or a stray claim behind.
    expect(await count(owner.email)).toBe(2);
    const claims = await withDb(async (db) => {
      const result = await db.query(
        `SELECT count(*) FILTER (WHERE a."serviceRequestId" IS NOT NULL)::int AS claimed, count(*)::int AS total
           FROM "MediaAsset" a JOIN "User" u ON u.id = a."ownerUserId" WHERE u.email = $1`,
        [owner.email],
      );
      return result.rows[0];
    });
    expect(claims).toEqual({ claimed: 1, total: 6 });
  });
});
