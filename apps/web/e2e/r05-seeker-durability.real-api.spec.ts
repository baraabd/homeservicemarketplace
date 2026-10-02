import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { api, loginViaUi, newJar, otpFor, REAL_API, type Account, type Jar } from './real-api';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
async function registerSeeker(): Promise<Account> {
  const jar = newJar();
  const email = `r05-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  // Generated per account so the acceptance fixture carries no reusable
  // credential literal in source or git history. It still exercises the same
  // password policy and fresh-login path as a user-created credential.
  const password = `R05-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'R05', lastName: 'Seeker' },
  });
  expect(registered.status, 'R05 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R05 seeker OTP should verify').toBe(200);
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
  if (!url) throw new Error('R05 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

test.describe('R05 seeker durability — real browser, API and Postgres', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R05 real-service acceptance.');
  test.describe.configure({ timeout: 180_000 });

  test('profile, address and request snapshot survive reload and fresh login', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const account = await registerSeeker();
    await applySession(context, account.jar);
    await seedLanguage(page, 'en');

    await page.goto(`${BASE_URL}/home/profile`);
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    // Assert a unique control that only exists on the opened editor. The copy
    // "Edit Profile" also remains visible in the underlying menu during the
    // animated overlay, so a text locator is intentionally ambiguous.
    const fullName = page.getByLabel('Full Name');
    await expect(fullName).toBeVisible();

    await fullName.fill('براء اختبار R05');
    await page.getByLabel('Phone Number').fill('+963 944 000 000');
    await page.getByLabel('City').fill('حلب');
    await page
      .getByPlaceholder('Write a short bio…')
      .fill('ملف عميل حقيقي محفوظ من Chromium عبر API وقاعدة PostgreSQL.');
    const profileResponse = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/me/profile` && response.request().method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Save Changes' }).click();
    expect((await profileResponse).status()).toBe(200);
    await expect(page.getByText(/Saved successfully/)).toBeVisible();

    await page.reload();
    // Reload intentionally returns to the profile surface, not an open editor.
    // Prove the persisted server projection first, then reopen the editor and
    // verify every editable value rehydrates from GET /v1/me/profile.
    await expect(page.getByText('براء اختبار R05', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit Profile', exact: true }).click();
    await expect(page.getByLabel('Full Name')).toHaveValue('براء اختبار R05');
    await expect(page.getByLabel('Phone Number')).toHaveValue('+963 944 000 000');
    await expect(page.getByLabel('City')).toHaveValue('حلب');
    await expect(page.getByPlaceholder('Write a short bio…')).toHaveValue(
      'ملف عميل حقيقي محفوظ من Chromium عبر API وقاعدة PostgreSQL.',
    );
    await expect(page.getByRole('button', { name: /Change Photo/i })).toHaveCount(0);

    await page.goto(`${BASE_URL}/home/profile`);
    await page.getByRole('button', { name: 'Saved Addresses', exact: true }).click();
    // The underlying Profile menu intentionally remains mounted during the
    // animated sub-page overlay and contains the same "Saved Addresses" copy.
    // Address the heading element itself so strict mode verifies the opened
    // screen instead of matching both the menu button and the page title.
    await expect(page.locator('p').filter({ hasText: /^Saved Addresses$/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add Address', exact: true }).first().click();
    await page.getByPlaceholder('Label (e.g. Home)').fill('R05 Home');
    await page.getByPlaceholder('Full address').fill('10 Old Street, Aleppo, Syria');
    const addressCreate = page.waitForResponse(
      (response) =>
        response.url() === `${REAL_API}/v1/me/addresses` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Save Address', exact: true }).click();
    expect((await addressCreate).status()).toBeLessThan(300);
    await expect(page.getByText('R05 Home', { exact: true })).toBeVisible();
    await expect(page.getByText('Default', { exact: true })).toBeVisible();

    const addresses = await api<{ items: Array<{ id: string; label: string }> }>(
      account.jar,
      '/v1/me/addresses',
    );
    expect(addresses.status).toBe(200);
    const address = addresses.body.items.find((item) => item.label === 'R05 Home');
    expect(address, 'the UI-created address must be readable from the real API').toBeTruthy();

    const profileDb = await withDb(async (client) => {
      const { rows } = await client.query<{
        firstName: string;
        lastName: string;
        phoneNumber: string | null;
        city: string | null;
        bio: string | null;
        addressCount: string;
        defaultCount: string;
      }>(
        `SELECT u."firstName", u."lastName", p."phoneNumber", p."city", p."bio",
                COUNT(a."id")::text AS "addressCount",
                COUNT(a."id") FILTER (WHERE a."isDefault" = TRUE)::text AS "defaultCount"
           FROM "User" u
           LEFT JOIN "UserProfile" p ON p."userId" = u."id"
           LEFT JOIN "Address" a ON a."userId" = u."id" AND a."deletedAt" IS NULL
          WHERE u."email" = $1
          GROUP BY u."id", p."id"`,
        [account.email],
      );
      return rows[0];
    });
    expect(profileDb).toMatchObject({
      firstName: 'براء',
      lastName: 'اختبار R05',
      phoneNumber: '+963 944 000 000',
      city: 'حلب',
      bio: 'ملف عميل حقيقي محفوظ من Chromium عبر API وقاعدة PostgreSQL.',
      addressCount: '1',
      defaultCount: '1',
    });

    const customServiceText = 'خدمة منزلية عربية خاصة لاختبار ثبات البيانات';
    const requestCreate = await api<{ id: string }>(account.jar, '/v1/me/requests', {
      method: 'POST',
      body: {
        categoryId: null,
        customServiceText,
        description: 'R05 historical snapshot proof',
        mediaAssetIds: [],
        scheduleType: 'ASAP',
        scheduledAt: null,
        addressId: address!.id,
        manualAddress: null,
      },
    });
    expect(requestCreate.status).toBe(201);

    const before = await withDb(async (client) => {
      const { rows } = await client.query<{ addressSnapshot: Record<string, unknown> }>(
        'SELECT "addressSnapshot" FROM "ServiceRequest" WHERE "id" = $1',
        [requestCreate.body.id],
      );
      return rows[0]?.addressSnapshot;
    });
    expect(before).toMatchObject({
      label: 'R05 Home',
      line1: '10 Old Street',
      city: 'Aleppo',
      country: 'Syria',
    });

    const changed = await api(account.jar, `/v1/me/addresses/${address!.id}`, {
      method: 'PATCH',
      body: { label: 'R05 Moved', line1: '99 New Street', city: 'Damascus', country: 'Syria' },
    });
    expect(changed.status).toBe(200);

    const detail = await api<{
      addressSnapshot: Record<string, unknown>;
      customServiceText: string | null;
    }>(account.jar, `/v1/me/requests/${requestCreate.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.customServiceText).toBe(customServiceText);
    expect(detail.body.addressSnapshot).toEqual(before);

    const after = await withDb(async (client) => {
      const { rows } = await client.query<{ addressSnapshot: Record<string, unknown> }>(
        'SELECT "addressSnapshot" FROM "ServiceRequest" WHERE "id" = $1',
        [requestCreate.body.id],
      );
      return rows[0]?.addressSnapshot;
    });
    expect(after).toEqual(before);

    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/login?returnTo=%2Fhome%2Fprofile`);
      await loginViaUi(freshPage, account);
      await expect(freshPage).toHaveURL(/\/home\/profile/);

      await freshPage.getByRole('button', { name: 'Edit Profile', exact: true }).click();
      await expect(freshPage.getByLabel('Full Name')).toHaveValue('براء اختبار R05');
      await expect(freshPage.getByLabel('City')).toHaveValue('حلب');

      await freshPage.goto(`${BASE_URL}/home/profile`);
      await freshPage.getByRole('button', { name: 'Saved Addresses', exact: true }).click();
      await expect(freshPage.getByText('R05 Moved', { exact: true })).toBeVisible();
      await expect(freshPage.getByText(/99 New Street, Damascus, Syria/)).toBeVisible();

      await testInfo.attach('r05-fresh-session-profile.png', {
        body: await freshPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await freshContext.close();
    }
  });

  test('active catalog is real data and retired categories cannot create new work', async () => {
    const account = await registerSeeker();
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let categoryId = '';
    try {
      const slug = `r05-browser-${Date.now()}`;
      const inserted = await client.query<{ id: string; labelEn: string; labelAr: string }>(
        `INSERT INTO "ServiceCategory" ("id","slug","labelEn","labelAr","icon","sortOrder","isActive","isLeaf","createdAt","updatedAt")
         VALUES (concat('r05cat-', substr(md5(random()::text),1,16)), $1, 'R05 Browser Service', 'خدمة اختبار R05', 'wrench', 999, TRUE, TRUE, NOW(), NOW())
         RETURNING "id","labelEn","labelAr"`,
        [slug],
      );
      categoryId = inserted.rows[0].id;

      const active = await api<{ items: Array<{ id: string }> }>(account.jar, '/v1/services');
      expect(active.status).toBe(200);
      expect(active.body.items.some((item) => item.id === categoryId)).toBe(true);

      const addresses = await api<{ id: string }>(account.jar, '/v1/me/addresses', {
        method: 'POST',
        body: {
          label: 'Catalog Home',
          type: 'HOME',
          line1: '1 Catalog Street',
          city: 'Aleppo',
          country: 'Syria',
        },
      });
      expect(addresses.status).toBe(201);

      const historical = await api<{ id: string }>(account.jar, '/v1/me/requests', {
        method: 'POST',
        body: {
          categoryId,
          customServiceText: null,
          description: null,
          mediaAssetIds: [],
          scheduleType: 'ASAP',
          scheduledAt: null,
          addressId: addresses.body.id,
          manualAddress: null,
        },
      });
      expect(historical.status).toBe(201);

      await client.query('UPDATE "ServiceCategory" SET "isActive" = FALSE WHERE "id" = $1', [
        categoryId,
      ]);

      const retired = await api<{ items: Array<{ id: string }> }>(account.jar, '/v1/services');
      expect(retired.body.items.some((item) => item.id === categoryId)).toBe(false);

      const refused = await api(account.jar, '/v1/me/requests', {
        method: 'POST',
        body: {
          categoryId,
          scheduleType: 'ASAP',
          addressId: addresses.body.id,
        },
      });
      expect(refused.status).toBe(400);

      const old = await api<{ category: { id: string; labelEn: string; labelAr: string } }>(
        account.jar,
        `/v1/me/requests/${historical.body.id}`,
      );
      expect(old.status).toBe(200);
      expect(old.body.category).toMatchObject({
        id: categoryId,
        labelEn: 'R05 Browser Service',
        labelAr: 'خدمة اختبار R05',
      });
    } finally {
      if (categoryId) {
        await client
          .query('DELETE FROM "ServiceCategory" WHERE "id" = $1', [categoryId])
          .catch(() => undefined);
      }
      await client.end();
    }
  });
});
