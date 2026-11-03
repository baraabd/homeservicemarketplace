import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { Client } from 'pg';
import { CURRENT_LEGAL_DOCUMENTS } from '@homeservicemarketplace/contracts';

import { LEGAL_ACCEPTANCE } from './legal-acceptance';
import { api, newJar, otpFor, REAL_API, type Jar } from './real-api';

// K02 — Saudi launch rules in a real browser against a real API.
//
// Nothing is stubbed: the SPA is the production build, the API is real, OTPs
// come from the mail catcher, and database reads are READ-ONLY evidence that
// the server persisted what the UI showed (the phase5-db-read precedent).
//
// Required env: E2E_REAL_API, E2E_BASE_URL, E2E_MAILPIT, E2E_DATABASE_URL.
// The API must run with the dev seed (provider1@provider.com is an ACTIVE
// Riyadh plumbing provider) and NODE_ENV != production so DRAFT policy text
// can be accepted. See docs/production-readiness/ksa-launch/K02/EVIDENCE.md.

const DB = process.env.E2E_DATABASE_URL ?? '';
const EVIDENCE = join(process.cwd(), 'test-results', 'k02-evidence');
mkdirSync(EVIDENCE, { recursive: true });
const WIDTHS = [320, 390, 430, 768, 1024, 1440] as const;
const LANGS = ['en', 'ar'] as const;
// Generated per run: no credential-shaped literal in source.
const PASSWORD = `K02-${randomUUID()}-Aa1!`;

async function db<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: DB });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows as T[];
  } finally {
    await client.end();
  }
}

async function noHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(scroll, 'no page-level horizontal overflow').toBeLessThanOrEqual(inner);
}

async function setLang(page: Page, lang: 'en' | 'ar') {
  await page.addInitScript((l) => window.localStorage.setItem('hsm.lang', l), lang);
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true });
}

/** A verified customer account through the public endpoints. */
async function customer(): Promise<{ email: string; jar: Jar }> {
  const jar = newJar();
  const email = `k02-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const reg = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: {
      email,
      password: PASSWORD,
      firstName: 'Noura',
      lastName: 'K02',
      legalAcceptance: LEGAL_ACCEPTANCE,
    },
  });
  expect(reg.status).toBe(202);
  const ok = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: reg.body.challengeId, code: await otpFor(email) },
  });
  expect(ok.status).toBe(200);
  return { email, jar };
}

async function signIn(jar: Jar, email: string, password: string) {
  const start = await api<{ challengeId: string }>(jar, '/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  expect(start.status).toBe(200);
  const ok = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: start.body.challengeId, code: await otpFor(email) },
  });
  expect(ok.status).toBe(200);
}

async function browserLogin(page: Page, email: string, password: string) {
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: /^(log in|دخول)$/i }).click();
  const otp = page.getByTestId('otp-input');
  await expect(otp).toBeVisible();
  await otp.fill(await otpFor(email));
  await page.getByRole('button', { name: /^(confirm|تأكيد)$/i }).click();
}

test.describe.configure({ mode: 'serial' });
test.skip(!REAL_API || !DB, 'needs E2E_REAL_API and E2E_DATABASE_URL');

test('V01 public selector, legal pages and consent dialog: 6 widths × EN/AR, no overflow, no internal labels', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        locale: lang === 'ar' ? 'ar-SA' : 'en-US',
        // Evidence shows the settled layout; the selector honours reduced motion.
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await setLang(page, lang);

      await page.goto('/select');
      await expect(page.getByTestId('selector-brand')).toHaveText(
        lang === 'ar' ? 'فيكس ناو' : 'FixNow',
      );
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      expect(text).not.toMatch(/430px|1440px|Mobile PWA|Map-Centric|Maharah/);
      await expect(page.getByTestId('lang-toggle')).toBeVisible();
      await expect(page.getByTestId('lang-toggle')).toHaveAttribute('data-lang', lang);
      // The highlighted option is the active language in both directions.
      const pill = await page.getByTestId('lang-toggle').locator('div').first().boundingBox();
      const active = await page
        .getByTestId('lang-toggle')
        .locator('span', { hasText: lang === 'ar' ? 'ع' : 'EN' })
        .boundingBox();
      expect(Math.abs(pill!.x + pill!.width / 2 - (active!.x + active!.width / 2))).toBeLessThan(
        active!.width,
      );
      const toggleBox = await page.getByTestId('lang-toggle').boundingBox();
      expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
      await noHorizontalOverflow(page);
      await shot(page, `select-${lang}-${width}`);

      for (const id of ['terms', 'privacy', 'operator'] as const) {
        await page.goto(`/legal/${id}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByTestId('legal-draft-banner')).toBeVisible();
        await noHorizontalOverflow(page);
        if (id !== 'operator') {
          await expect(page.getByTestId('legal-version')).toHaveText(
            id === 'terms'
              ? CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version
              : CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version,
          );
        }
        if (width === 390 || width === 1440) await shot(page, `legal-${id}-${lang}-${width}`);
      }

      // Signup step 2 with the policy dialog open.
      await page.goto('/signup');
      await page.locator('input').first().fill('Noura Alharbi');
      await page.getByRole('button', { name: /next|التالي/i }).click();
      await page.locator('input[type="email"]').fill('visual@itest.local');
      await page.locator('input[type="password"]').fill(PASSWORD);
      const consent = page.getByRole('checkbox');
      await expect(consent).toBeEnabled();
      await noHorizontalOverflow(page);
      await shot(page, `signup-consent-${lang}-${width}`);
      await page
        .getByRole('link', {
          name: lang === 'ar' ? 'قراءة شروط الخدمة' : 'Read the Terms of Service',
        })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await shot(page, `signup-dialog-${lang}-${width}`);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(consent).not.toBeChecked();
      await context.close();
    }
  }
});

test('V02 200% zoom: legal page and signup stay usable at 390 CSS px', async ({ browser }) => {
  // 780 device px at deviceScaleFactor 2 ≈ a 390px phone at 200% text zoom
  // is approximated by a 195 CSS px layout viewport.
  const context = await browser.newContext({
    viewport: { width: 195, height: 422 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto('/legal/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await noHorizontalOverflow(page);
  await shot(page, 'zoom200-privacy-en');
  await page.goto('/signup');
  await expect(page.locator('input').first()).toBeVisible();
  await noHorizontalOverflow(page);
  // The language control stays fully inside the viewport at 200%.
  const toggle = (await page.getByTestId('lang-toggle').boundingBox())!;
  expect(toggle.x + toggle.width).toBeLessThanOrEqual(195);
  expect(toggle.x).toBeGreaterThanOrEqual(0);
  await shot(page, 'zoom200-signup-en');
  await context.close();
});

test('C01 consent journey: policy links never toggle consent; values and returnTo survive; server stores exact versions with its own time', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const email = `k02-consent-${Date.now()}@itest.local`;
  // A protected deep link: RequireAuth sends the visitor to /login with returnTo.
  await page.goto('/provider/wallet');
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.locator('input').first().fill('Noura Alharbi');
  await page.getByRole('button', { name: /next/i }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  const consent = page.getByRole('checkbox', { name: /Terms of Service and the Privacy Notice/ });
  await expect(consent).toBeEnabled();
  // While the modal is open the page behind it is aria-hidden (correct modal
  // behaviour), so the box is read by id there and by role afterwards.
  const consentBox = page.locator('#signup-consent');

  // Pointer.
  const terms = page.getByRole('link', { name: 'Read the Terms of Service' });
  await terms.click();
  await expect(page.getByRole('dialog', { name: 'Terms of Service' })).toBeVisible();
  await expect(consentBox).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(terms).toBeFocused(); // focus returns to the opener
  // Keyboard.
  const privacy = page.getByRole('link', { name: 'Read the Privacy Notice' });
  await privacy.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Privacy Notice' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(consent).not.toBeChecked();
  // Values survived.
  await expect(page.locator('input[type="email"]')).toHaveValue(email);
  await expect(page.locator('input[type="password"]')).toHaveValue(PASSWORD);
  // The full page opens in a new tab without disturbing this one.
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    terms.click({ modifiers: ['Control'] }),
  ]);
  await popup.waitForLoadState();
  await expect(popup).toHaveURL(/\/legal\/terms$/);
  await expect(popup.getByRole('heading', { level: 1 })).toHaveText('Terms of Service');
  await popup.close();
  await expect(consent).not.toBeChecked();

  // Tick with the keyboard, submit, verify.
  await consent.focus();
  await page.keyboard.press('Space');
  await expect(consent).toBeChecked();
  const before = Date.now();
  await page.getByRole('button', { name: /create/i }).click();
  const otp = page.getByTestId('otp-input');
  await expect(otp).toBeVisible();
  const after = Date.now();
  await otp.fill(await otpFor(email));
  await page.getByRole('button', { name: /^confirm$/i }).click();
  // The validated internal returnTo survived the policy reading.
  await expect(page).toHaveURL(/\/provider/, { timeout: 30_000 });

  const rows = await db<{
    documentKind: string;
    version: string;
    locale: string;
    acceptedAt: string;
  }>(
    `SELECT a."documentKind", a.version, a.locale, a."acceptedAt"::text AS "acceptedAt"
       FROM "UserLegalAcceptance" a JOIN "User" u ON u.id = a."userId"
      WHERE u.email = $1 ORDER BY a."documentKind"`,
    [email],
  );
  expect(rows.map((r) => [r.documentKind, r.version, r.locale])).toEqual([
    ['TERMS_OF_SERVICE', CURRENT_LEGAL_DOCUMENTS.TERMS_OF_SERVICE.version, 'en'],
    ['PRIVACY_NOTICE', CURRENT_LEGAL_DOCUMENTS.PRIVACY_NOTICE.version, 'en'],
  ]);
  for (const r of rows) {
    // Prisma stores UTC in a timestamp-without-time-zone column; read it as
    // text and parse it as UTC (node-postgres would apply the host zone).
    // It is the SERVER's time of the register request: between the moment
    // Create was pressed and the OTP screen appearing (+ Docker VM skew).
    const t = Date.parse(r.acceptedAt.replace(' ', 'T') + 'Z');
    expect(t).toBeGreaterThanOrEqual(before - 5_000);
    expect(t).toBeLessThanOrEqual(after + 5_000);
  }
});

test('A01 Arabic stays selected across a full reload and an authentication return', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { email } = await customer();
  await page.goto('/select');
  await page.getByTestId('lang-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.goto('/home');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await browserLogin(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/home/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await shot(page, 'arabic-after-auth-return-390');
});

test('M01 100.25 SAR typed in the bid form → 10025 halalas → SAR 100.25 for seeker, provider wallet and Admin', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const seeker = await customer();
  const services = await api<{
    items?: Array<{ id: string; slug: string }>;
    categories?: Array<{ id: string; slug: string }>;
  }>(newJar(), '/v1/services');
  const list = services.body.items ?? services.body.categories ?? [];
  const plumbing = list.find((c) => c.slug === 'plumbing');
  expect(plumbing, 'seeded plumbing category').toBeDefined();
  const created = await api<{ id: string }>(seeker.jar, '/v1/me/requests', {
    method: 'POST',
    body: {
      categoryId: plumbing!.id,
      description: `K02 e2e ${Date.now()}`,
      scheduleType: 'ASAP',
      manualAddress: {
        line1: 'Olaya St 1',
        city: 'Riyadh',
        country: 'SA',
        lat: 24.7136,
        lng: 46.6753,
      },
    },
  });
  expect(created.status).toBe(201);
  const requestId = created.body.id;

  // Provider bids through the REAL bid form.
  const pctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  });
  const ppage = await pctx.newPage();
  await ppage.goto('/provider/jobs');
  await browserLogin(ppage, 'provider1@provider.com', 'DevProvider123!');
  await expect(ppage).toHaveURL(/\/provider/, { timeout: 30_000 });
  await ppage.goto('/provider/jobs');
  // The live-jobs map keeps the list in a bottom sheet. Its handle animates
  // continuously and ignores prefers-reduced-motion (pre-existing; recorded
  // in K02 RISKS), so it is never "stable" for a pointer click. Keyboard
  // activation is a real user path and does not depend on it.
  const handle = ppage.getByRole('button', { name: /Pull up to see requests/ });
  await expect(handle).toBeVisible({ timeout: 30_000 });
  await handle.focus();
  await ppage.keyboard.press('Enter');
  // Exactly this run's request, by its server id.
  const card = ppage.getByTestId(`job-card-${requestId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.focus();
  await ppage.keyboard.press('Enter');
  await expect(ppage.getByText(/K02 e2e/).first()).toBeVisible();
  const placeBid = ppage.getByTestId('job-detail-place-bid');
  await expect(placeBid).toBeVisible();
  await placeBid.focus();
  await ppage.keyboard.press('Enter');
  await expect(ppage.getByRole('radio', { name: 'Fixed price' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  const price = ppage.getByLabel('Your total price for the job (SAR)');
  await price.fill('100.255');
  await price.blur();
  await expect(ppage.getByRole('alert')).toContainText('at most 2 decimal places');
  await price.fill('١٠٠٫٢٥'); // Arabic-Indic digits, Arabic decimal separator
  await ppage.getByRole('button', { name: '1 hour' }).click();
  await shot(ppage, 'bid-form-390');
  await ppage.getByRole('button', { name: 'Send Offer' }).click();
  await expect(ppage.getByText('Offer sent!')).toBeVisible();

  const [bid] = await db<{ id: string; amount: number; currency: string; amountScale: number }>(
    `SELECT id, amount, currency, "amountScale" FROM "Bid" WHERE "requestId" = $1`,
    [requestId],
  );
  expect(bid).toEqual(expect.objectContaining({ amount: 10025, currency: 'SAR', amountScale: 2 }));

  // Seeker sees exactly what was typed, accepts it.
  const accepted = await api(seeker.jar, `/v1/me/requests/${requestId}/bids/${bid!.id}/accept`, {
    method: 'POST',
  });
  expect([200, 201]).toContain(accepted.status);
  const [booking] = await db<{
    id: string;
    priceAmount: number;
    currency: string;
    amountScale: number;
  }>(`SELECT id, "priceAmount", currency, "amountScale" FROM "Booking" WHERE "requestId" = $1`, [
    requestId,
  ]);
  expect(booking).toEqual(
    expect.objectContaining({ priceAmount: 10025, currency: 'SAR', amountScale: 2 }),
  );
  const providerJar = newJar();
  await signIn(providerJar, 'provider1@provider.com', 'DevProvider123!');
  for (const step of ['start', 'complete'])
    expect([200, 201]).toContain(
      (await api(providerJar, `/v1/provider/bookings/${booking!.id}/${step}`, { method: 'POST' }))
        .status,
    );

  // Provider wallet.
  await ppage.goto('/provider/wallet');
  await expect(ppage.getByText(/SAR\s100\.25/).first()).toBeVisible({ timeout: 30_000 });
  await expect(ppage.locator('body')).not.toContainText('$');
  // The headline card shows all of its content (it used to shrink and clip).
  const headline = ppage.getByTestId('wallet-headline-card');
  const cardBox = (await headline.boundingBox())!;
  const lastRow = (await headline.getByText('Jobs Done').boundingBox())!;
  expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  await shot(ppage, 'wallet-sar-390');
  await pctx.close();

  // Admin financials.
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const apage = await actx.newPage();
  await apage.goto('/admin');
  await browserLogin(apage, 'admin@admin.com', 'DevAdmin123!');
  await expect(apage).toHaveURL(/\/admin/, { timeout: 30_000 });
  await apage.getByRole('button', { name: /^Financials/ }).click();
  await expect(apage.getByText(/SAR\s100\.25/).first()).toBeVisible({ timeout: 30_000 });
  await shot(apage, 'admin-financials-sar-1440');
  await actx.close();
});
