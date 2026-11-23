import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { NotificationListResponse } from '@homeservicemarketplace/contracts';

import { adminNavigation, enterAdmin } from './admin-review-real-api';
import { applySession, registerSeeker, withDb } from './booking-fixtures';
import { seedLanguage } from './fixtures';
import { api, REAL_API, registerProvider, type Account } from './real-api';

// K06 — support is reachable when a capability is denied, and support actions
// reach the requester. Real browser, real API, real PostgreSQL; nothing is
// intercepted or substituted.
//
//   a provider whose profile is suspended opens the status screen → "Contact
//   support" → creates a ticket from the provider app → an administrator
//   replies in the real admin Support screen → the provider's own inbox has
//   one durable notification whose link opens that ticket with the reply →
//   reload keeps it → a customer's ticket closed by the administrator links
//   into the customer app instead.
//
// The one database write is the provider-profile suspension, an operator
// outcome whose own authority the admin suites accept separately.
//
// docs/production-readiness/ksa-launch/k06/

test.use({ trace: 'off', video: 'off' });
test.skip(!REAL_API, 'K06 support operations need E2E_REAL_API');

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const SHOTS = process.env.K06_SCREENSHOT_DIR ?? join('test-results', 'k06-support');
const WIDTHS = [320, 390, 430, 768, 1024, 1440] as const;

async function suspendProviderProfile(account: Account): Promise<void> {
  await withDb((db) =>
    db.query(`UPDATE "ProviderProfile" SET status = 'SUSPENDED' WHERE id = $1`, [
      account.profileId,
    ]),
  );
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal overflow').toBeLessThanOrEqual(0);
}

/** Project usability floor: every visible button is at least 44x44 CSS px. */
async function touchTargetsAtLeast44(page: Page, width: number): Promise<void> {
  const small = await page.$$eval('button', (buttons) =>
    buttons
      .map((button) => {
        const box = button.getBoundingClientRect();
        const label = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '';
        return { label, w: Math.round(box.width), h: Math.round(box.height) };
      })
      .filter((b) => b.w > 0 && b.h > 0 && (b.w < 44 || b.h < 44)),
  );
  expect(small, `buttons under 44x44 at ${width}px`).toEqual([]);
}

/** Capture one screen across the required widths in one language. */
async function captureMatrix(page: Page, name: string, lang: 'en' | 'ar'): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    await noHorizontalOverflow(page);
    await touchTargetsAtLeast44(page, width);
    await page.screenshot({ path: join(SHOTS, `${name}-${lang}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

for (const lang of ['en', 'ar'] as const) {
  test(`K06 (${lang}): a suspended provider reaches support and is notified of the reply`, async ({
    browser,
  }) => {
    const provider = await registerProvider();
    await suspendProviderProfile(provider);

    const context = await browser.newContext({ baseURL: BASE_URL });
    await seedLanguage(context, lang);
    await applySession(context, provider.jar);
    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });

    // ── denied state → support ──────────────────────────────────────────
    await page.goto('/provider');
    await expect(page.getByTestId('provider-status-suspended')).toBeVisible();
    await captureMatrix(page, 'provider-status-suspended', lang);
    const contact = page.getByTestId('provider-status-support');
    await contact.focus();
    await expect(contact).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/provider\/support$/);
    await expect(page.getByTestId('help-support-page')).toBeVisible();
    await captureMatrix(page, 'provider-support-home', lang);

    // ── create a ticket through the UI ──────────────────────────────────
    const subject =
      lang === 'ar' ? 'الحساب موقوف — طلب توضيح' : 'Account suspended - please explain';
    const created = page.waitForResponse(
      (r) => r.url() === `${REAL_API}/v1/me/support/tickets` && r.request().method() === 'POST',
    );
    await page.getByLabel(lang === 'ar' ? 'الموضوع' : 'Subject').fill(subject);
    await page
      .getByLabel(lang === 'ar' ? 'صف المشكلة أو السؤال' : 'Describe the problem or question')
      .first()
      .fill(lang === 'ar' ? 'لماذا تم إيقاف حسابي؟' : 'Why was my provider account suspended?');
    await page
      .getByRole('button', { name: lang === 'ar' ? 'إرسال الطلب' : 'Create ticket' })
      .click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    expect(createdResponse.request().postDataJSON()).toMatchObject({ experience: 'provider' });
    const ticketId = (await createdResponse.json()).ticket.id as string;
    const stored = await withDb((db) =>
      db.query<{ experience: string }>('SELECT experience FROM "SupportTicket" WHERE id = $1', [
        ticketId,
      ]),
    );
    expect(stored.rows[0].experience).toBe('PROVIDER');

    // ── administrator replies in the real admin UI ──────────────────────
    const adminContext = await browser.newContext({ baseURL: BASE_URL });
    const admin = await adminContext.newPage();
    await enterAdmin(admin);
    await adminNavigation(admin, 'support');
    await admin
      .getByRole('button', { name: new RegExp(subject.slice(0, 12)) })
      .first()
      .click();
    await admin.getByLabel('Support reply').fill('K06: we are reviewing your account.');
    const replied = admin.waitForResponse(
      (r) =>
        r.url() === `${REAL_API}/v1/admin/support/tickets/${ticketId}/messages` &&
        r.request().method() === 'POST',
    );
    await admin.getByRole('button', { name: 'Send reply' }).click();
    expect((await replied).status()).toBe(201);
    await adminContext.close();

    // ── the provider's own inbox, provider experience only ──────────────
    const inbox = await api<NotificationListResponse>(
      provider.jar,
      '/v1/me/notifications?experience=provider',
    );
    expect(inbox.status).toBe(200);
    const notes = inbox.body.items.filter(
      (item) =>
        (item.metadata as { supportTicketId?: string } | null)?.supportTicketId === ticketId,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'SYSTEM',
      deepLink: `/provider/support?ticket=${ticketId}`,
      readAt: null,
    });
    expect(JSON.stringify(notes[0])).not.toContain('reviewing your account');
    const seekerInbox = await api<NotificationListResponse>(
      provider.jar,
      '/v1/me/notifications?experience=seeker',
    );
    expect(
      seekerInbox.body.items.some(
        (item) =>
          (item.metadata as { supportTicketId?: string } | null)?.supportTicketId === ticketId,
      ),
    ).toBe(false);

    // ── the deep link opens that ticket with the reply, and survives reload ─
    await page.goto(notes[0].deepLink!);
    await expect(page.getByText('K06: we are reviewing your account.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('K06: we are reviewing your account.')).toBeVisible();
    await expect(page.getByRole('heading', { name: subject })).toBeVisible();
    await captureMatrix(page, 'provider-support-ticket', lang);

    // ── 200% zoom at the typical mobile width keeps the composer usable ──
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await page.screenshot({ path: join(SHOTS, `provider-support-ticket-${lang}-zoom200.png`) });
    await page.evaluate(() => {
      document.documentElement.style.zoom = '';
    });

    await context.close();
  });
}

test('K06: a customer ticket closed by an administrator links into the customer app', async ({
  browser,
}) => {
  const seeker = await registerSeeker('k06support');
  const context = await browser.newContext({ baseURL: BASE_URL });
  await seedLanguage(context, 'en');
  await applySession(context, seeker.jar);
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/home/support');
  await expect(page.getByTestId('help-support-page')).toBeVisible();
  const created = page.waitForResponse(
    (r) => r.url() === `${REAL_API}/v1/me/support/tickets` && r.request().method() === 'POST',
  );
  await page.getByLabel('Subject').fill('K06 customer question');
  await page
    .getByLabel('Describe the problem or question')
    .first()
    .fill('How do I change my address?');
  await page.getByRole('button', { name: 'Create ticket' }).click();
  const response = await created;
  expect(response.request().postDataJSON()).toMatchObject({ experience: 'seeker' });
  const ticketId = (await response.json()).ticket.id as string;

  const adminContext = await browser.newContext({ baseURL: BASE_URL });
  const admin = await adminContext.newPage();
  await enterAdmin(admin);
  await adminNavigation(admin, 'support');
  await admin
    .getByRole('button', { name: /K06 customer question/ })
    .first()
    .click();
  const closed = admin.waitForResponse(
    (r) => r.url() === `${REAL_API}/v1/admin/support/tickets/${ticketId}/close`,
  );
  await admin.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await closed).status()).toBe(200);
  await adminContext.close();

  const inbox = await api<NotificationListResponse>(
    seeker.jar,
    '/v1/me/notifications?experience=seeker',
  );
  const note = inbox.body.items.find(
    (item) => (item.metadata as { supportTicketId?: string } | null)?.supportTicketId === ticketId,
  );
  expect(note).toMatchObject({ deepLink: `/home/support?ticket=${ticketId}` });
  expect((note!.metadata as { event: string }).event).toBe('SUPPORT_CLOSED');

  await page.goto(note!.deepLink!);
  await expect(page.getByRole('heading', { name: 'K06 customer question' })).toBeVisible();
  await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  // A closed ticket offers no composer: the server would refuse the message.
  await expect(page.getByRole('button', { name: 'Send' })).toHaveCount(0);
  await captureMatrix(page, 'customer-support-closed', 'en');
  await context.close();
});
