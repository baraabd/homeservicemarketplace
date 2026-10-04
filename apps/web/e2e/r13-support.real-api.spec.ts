import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { adminJar, api, newJar, otpFor, REAL_API, type Account, type Jar } from './real-api';

// ─────────────────────────────────────────────────────────────────────────────
// R13 — durable help and support, through the real stack.
//
// A real browser, the real API with its real guards (JWT, CSRF, roles and
// fresh support permissions), real PostgreSQL. Nothing is stubbed: the
// "lost response" test lets the request reach the server and drops only the
// answer on its way back.
//
// No trace and no video: both would record session cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const TICKETS_URL = `${REAL_API}/v1/me/support/tickets`;

async function withDb<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('R13 real-service acceptance requires DATABASE_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface Seeker extends Account {
  userId: string;
}

async function registerSeeker(tag: string): Promise<Seeker> {
  const jar = newJar();
  const email = `r13-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@itest.local`;
  const password = `R13-${randomUUID()}-Aa1!`;
  const registered = await api<{ challengeId: string }>(jar, '/v1/auth/register', {
    method: 'POST',
    body: { email, password, firstName: 'R13', lastName: 'Seeker' },
  });
  expect(registered.status, 'R13 seeker registration should succeed').toBeLessThan(400);
  const verified = await api(jar, '/v1/auth/verify-otp', {
    method: 'POST',
    body: { challengeId: registered.body.challengeId, code: await otpFor(email) },
  });
  expect(verified.status, 'R13 seeker OTP should verify').toBe(200);
  const userId = await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      email,
    ]);
    return rows[0].id;
  });
  return { email, password, jar, profileId: '', userId };
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

interface TicketRow {
  id: string;
  subject: string;
  status: string;
}

async function ticketsOf(userId: string): Promise<TicketRow[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<TicketRow>(
      'SELECT id, subject, status FROM "SupportTicket" WHERE "requesterUserId" = $1 ORDER BY "createdAt"',
      [userId],
    );
    return rows;
  });
}

async function messagesOf(ticketId: string): Promise<{ authorRole: string; body: string }[]> {
  return withDb(async (db) => {
    const { rows } = await db.query<{ authorRole: string; body: string }>(
      'SELECT "authorRole", body FROM "SupportMessage" WHERE "ticketId" = $1 ORDER BY "createdAt", id',
      [ticketId],
    );
    return rows;
  });
}

const L = {
  en: {
    entry: 'Help & Support',
    subject: 'Subject',
    describe: 'Describe the problem or question',
    create: 'Create ticket',
    send: 'Send',
    open: 'Open',
    closed: 'Closed',
    failed: 'Could not send. The message was not marked as saved.',
  },
  ar: {
    entry: 'المساعدة والدعم',
    subject: 'الموضوع',
    describe: 'صف المشكلة أو السؤال',
    create: 'إرسال الطلب',
    send: 'إرسال',
    open: 'مفتوح',
    closed: 'مغلق',
    failed: 'تعذر الإرسال. رسالتك لم تُسجل كناجحة.',
  },
} as const;

async function openSupport(page: Page, lang: 'en' | 'ar' = 'en'): Promise<void> {
  const listed = page.waitForResponse(
    (r) => r.url() === TICKETS_URL && r.request().method() === 'GET',
  );
  await page.goto(`${BASE_URL}/home/profile`);
  await page.getByRole('button', { name: L[lang].entry }).click();
  expect((await listed).status()).toBe(200);
}

const createPost = (page: Page) =>
  page.waitForResponse((r) => r.url() === TICKETS_URL && r.request().method() === 'POST');

test.describe('R13 durable help and support — real browser, API and PostgreSQL', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R13 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  test('a ticket and its conversation are stored, answered by support, and survive reload and closure', async ({
    page,
    context,
  }) => {
    const seeker = await registerSeeker('journey');
    const other = await registerSeeker('other');

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openSupport(page);

    // The static FAQ is not a conversation and no assistant is pretended.
    // Scoped to the support page: the profile screen beneath it carries its
    // own, real network-status card ("Online · Connected & synced").
    const support = page.getByTestId('help-support-page');
    await expect(support.getByText('No support tickets yet.')).toBeVisible();
    await expect(support.getByText(/\bonline\b|under 5 minutes|typing/i)).toHaveCount(0);

    const subject = `Cannot update my phone ${randomUUID().slice(0, 8)}`;
    const body = 'Markup stays text: <b>bold</b> <img src=x onerror="window.__r13=1"> نص عربي';
    await page.getByLabel(L.en.subject).fill(subject);
    await page.getByLabel(L.en.describe).fill(body);
    const created = createPost(page);
    await page.getByRole('button', { name: L.en.create }).click();
    expect((await created).status()).toBe(201);

    const thread = page.getByRole('region', { name: subject });
    await expect(thread).toBeVisible();
    await expect(thread.getByText(body, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as { __r13?: number }).__r13)).toBeUndefined();

    const [ticket] = await ticketsOf(seeker.userId);
    expect(ticket).toMatchObject({ subject, status: 'OPEN' });
    // No fabricated reply arrives, however long the seeker waits for one.
    await page.waitForTimeout(6_000);
    expect(await messagesOf(ticket.id)).toEqual([{ authorRole: 'REQUESTER', body }]);
    await expect(thread.locator('p.whitespace-pre-wrap')).toHaveCount(1);

    // Another person cannot read or write it; a seeker is not support staff.
    expect((await api(other.jar, `/v1/me/support/tickets/${ticket.id}`)).status).toBe(404);
    const intrude = await api(other.jar, `/v1/me/support/tickets/${ticket.id}/messages`, {
      method: 'POST',
      body: { body: 'not mine', idempotencyKey: `r13intrude${randomUUID().replace(/-/g, '')}` },
    });
    expect(intrude.status).toBe(404);
    expect((await api(seeker.jar, '/v1/admin/support/tickets')).status).toBe(403);
    expect(
      (
        await api(seeker.jar, `/v1/admin/support/tickets/${ticket.id}/close`, {
          method: 'POST',
        })
      ).status,
    ).toBe(403);

    // Support answers through the real admin surface.
    const adminPage = await context.browser()!.newPage();
    try {
      await applySession(adminPage.context(), await adminJar());
      await seedLanguage(adminPage, 'en');
      await adminPage.setViewportSize({ width: 1280, height: 900 });
      await adminPage.goto(`${BASE_URL}/admin/support`);
      await adminPage.getByRole('button', { name: new RegExp(subject) }).click();
      await expect(adminPage.getByText(body, { exact: true })).toBeVisible();
      await adminPage.getByLabel('Support reply').fill('Support here: try signing out and in.');
      const replied = adminPage.waitForResponse(
        (r) =>
          r.url() === `${REAL_API}/v1/admin/support/tickets/${ticket.id}/messages` &&
          r.request().method() === 'POST',
      );
      await adminPage.getByRole('button', { name: 'Send reply' }).click();
      expect((await replied).status()).toBe(201);
    } finally {
      await adminPage.context().close();
    }

    // The seeker sees the stored reply after a full reload, and answers it.
    await openSupport(page); // a full navigation: nothing survives from memory
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await expect(thread.getByText('Support here: try signing out and in.')).toBeVisible();
    await page.getByLabel(L.en.describe).fill('That worked, thank you.');
    const sent = page.waitForResponse(
      (r) => r.url() === `${TICKETS_URL}/${ticket.id}/messages` && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: L.en.send }).click();
    expect((await sent).status()).toBe(201);
    await expect(thread.getByText('That worked, thank you.')).toBeVisible();
    expect((await messagesOf(ticket.id)).map((m) => m.authorRole)).toEqual([
      'REQUESTER',
      'SUPPORT',
      'REQUESTER',
    ]);

    // Support closes it; the seeker's thread is read-only after a reload.
    const admin = await adminJar();
    const closed = await api(admin, `/v1/admin/support/tickets/${ticket.id}/close`, {
      method: 'POST',
    });
    expect(closed.status).toBe(200);
    await openSupport(page); // a full navigation: nothing survives from memory
    await page.getByRole('button', { name: new RegExp(subject) }).click();
    await expect(thread.getByText(L.en.closed, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: L.en.send })).toHaveCount(0);
    expect((await ticketsOf(seeker.userId))[0].status).toBe('CLOSED');

    const audit = await withDb(async (db) => {
      const { rows } = await db.query<{ type: string; metadata: unknown }>(
        `SELECT type, metadata FROM "AuditEvent"
          WHERE metadata->>'supportTicketId' = $1 ORDER BY "createdAt"`,
        [ticket.id],
      );
      return rows;
    });
    expect(audit.map((row) => row.type)).toEqual([
      'SUPPORT_TICKET_CREATED',
      'ADMIN_SUPPORT_REPLIED',
      'SUPPORT_MESSAGE_SENT',
      'ADMIN_SUPPORT_CLOSED',
    ]);
    expect(JSON.stringify(audit)).not.toContain('signing out');
    expect(JSON.stringify(audit)).not.toContain('Markup');
  });

  test('an answer lost on the way back does not duplicate the ticket', async ({
    page,
    context,
  }) => {
    const seeker = await registerSeeker('lost');
    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openSupport(page);

    const subject = `Lost answer ${randomUUID().slice(0, 8)}`;
    await page.getByLabel(L.en.subject).fill(subject);
    await page.getByLabel(L.en.describe).fill('One logical ticket.');

    // The request reaches the real server and is handled there. Only the
    // answer is dropped, once.
    let reached = 0;
    await page.route(TICKETS_URL, async (route) => {
      if (route.request().method() !== 'POST' || reached > 0) return route.fallback();
      reached += 1;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: L.en.create }).click();

    // The UI does not claim success it never received.
    await expect(page.getByRole('alert')).toHaveText(L.en.failed);
    expect(reached).toBe(1);
    expect(await ticketsOf(seeker.userId)).toHaveLength(1);

    // Retrying reuses the submission key; the server replays the stored ticket.
    const retried = createPost(page);
    await page.getByRole('button', { name: L.en.create }).click();
    const response = await retried;
    expect(response.status()).toBe(201);
    expect((await response.json()).replayed).toBe(true);
    await expect(page.getByRole('region', { name: subject })).toBeVisible();

    const rows = await ticketsOf(seeker.userId);
    expect(rows).toHaveLength(1);
    expect(await messagesOf(rows[0].id)).toHaveLength(1);
  });

  test('Arabic, right-to-left, at 320 and 430, by keyboard alone', async ({ page, context }) => {
    const seeker = await registerSeeker('rtl');
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'ar');

    for (const width of [320, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await openSupport(page, 'ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(0);
    }

    const subject = `مشكلة في الحساب ${randomUUID().slice(0, 6)}`;
    await page.getByLabel(L.ar.subject).focus();
    await page.keyboard.type(subject);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel(L.ar.describe)).toBeFocused();
    await page.keyboard.type('لا أستطيع تغيير رقم الهاتف.');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: L.ar.create })).toBeFocused();
    const created = createPost(page);
    await page.keyboard.press('Enter');
    expect((await created).status()).toBe(201);
    await expect(page.getByRole('region', { name: subject })).toBeVisible();
    await expect(page.getByText(L.ar.open, { exact: true })).toBeVisible();

    const rows = await ticketsOf(seeker.userId);
    expect(rows).toEqual([expect.objectContaining({ subject, status: 'OPEN' })]);
  });
});
