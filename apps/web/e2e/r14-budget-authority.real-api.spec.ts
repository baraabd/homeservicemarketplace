import { expect, test, type Page } from '@playwright/test';

import {
  applySession,
  leafCategoryId,
  registerSeeker,
  withDb,
  workingProvider,
  type Seeker,
} from './booking-fixtures';
import { seedLanguage } from './fixtures';
import { api, REAL_API } from './real-api';

// ─────────────────────────────────────────────────────────────────────────────
// R14 — budget / quote intent authority, through the real stack.
//
// No seeker budget authority exists, so the approved fallback applies: the
// provider sees no budget anywhere (feed wire, job card, detail overlay, map
// popup, offer form), and the API refuses a client-sent budget rather than
// storing a number the product never asked the seeker for.
//
// No trace and no video: both would record session cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const FEED_URL = `${REAL_API}/v1/provider/available-requests`;
const BUDGET_TEXT = /budget|الميزانية|ميزانية/i;

async function createRequest(seeker: Seeker, categoryId: string, extra: object = {}) {
  return api<{ id: string }>(seeker.jar, '/v1/me/requests', {
    method: 'POST',
    body: {
      categoryId,
      customServiceText: null,
      description: 'R14 budget authority acceptance job',
      mediaAssetIds: [],
      scheduleType: 'ASAP',
      scheduledAt: null,
      addressId: seeker.addressId,
      manualAddress: null,
      ...extra,
    },
  });
}

async function feedFromApp(page: Page, navigate: () => Promise<unknown>) {
  const response = page.waitForResponse(
    (r) => r.url().startsWith(FEED_URL) && r.request().method() === 'GET' && r.status() === 200,
  );
  await navigate();
  return (await (await response).json()) as { items: Array<Record<string, unknown>> };
}

test.describe('R14 budget authority — real browser, API and PostgreSQL', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R14 real-service acceptance.');
  test.describe.configure({ timeout: 240_000 });

  test('the server refuses a client-sent budget and stores nothing', async () => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r14refuse');

    for (const budget of [
      { budget: { amountMin: 100, amountMax: 200, currency: 'USD' } },
      { budgetMinMinor: 1000 },
      { budgetCurrency: 'USD' },
    ]) {
      const refused = await createRequest(seeker, categoryId, budget);
      expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    }
    const count = await withDb(async (db) => {
      const { rows } = await db.query<{ n: string }>(
        'SELECT COUNT(*)::text AS n FROM "ServiceRequest" WHERE "seekerUserId" = $1',
        [seeker.userId],
      );
      return Number(rows[0].n);
    });
    expect(count).toBe(0);

    // The same request without a budget is accepted: the API stays compatible.
    const accepted = await createRequest(seeker, categoryId);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  });

  for (const lang of ['en', 'ar'] as const) {
    test(`the provider never sees a budget — wire, card, detail and offer form (${lang})`, async ({
      browser,
    }) => {
      const categoryId = await leafCategoryId();
      const seeker = await registerSeeker(`r14${lang}`);
      const created = await createRequest(seeker, categoryId);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const provider = await workingProvider(categoryId, `r14${lang}`);

      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await applySession(context, provider.jar);
        const page = await context.newPage();
        await seedLanguage(page, lang);

        const feed = await feedFromApp(page, () => page.goto(`${BASE_URL}/provider/jobs`));
        const item = feed.items.find((row) => row.id === created.body.id);
        expect(item, 'the eligible provider receives the request').toBeTruthy();
        expect(item).not.toHaveProperty('budget');
        expect(JSON.stringify(item)).not.toMatch(/budget|amountMin|amountMax/i);

        // A full reload changes nothing: the absence is server truth.
        const reloaded = await feedFromApp(page, () => page.reload());
        expect(reloaded.items.find((row) => row.id === created.body.id)).not.toHaveProperty(
          'budget',
        );

        await page.getByTestId('pull-up-control').click({ force: true });
        const card = page.getByTestId(`job-card-${created.body.id}`);
        await expect(card).toBeVisible();
        await expect(card).not.toContainText(BUDGET_TEXT);
        await expect(card).not.toContainText('$');

        await card.click();
        const overlay = page.getByTestId('job-detail-overlay');
        await expect(overlay).toBeVisible();
        await expect(overlay).not.toContainText(BUDGET_TEXT);

        await page.getByTestId('job-detail-place-bid').click();
        await expect(
          page.getByText(lang === 'ar' ? 'تقديم عرض' : 'Submit Offer', { exact: true }),
        ).toBeVisible();
        expect(await page.locator('body').innerText()).not.toMatch(BUDGET_TEXT);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'no horizontal overflow at 390px').toBeLessThanOrEqual(0);
      } finally {
        await context.close();
      }
    });
  }
});
