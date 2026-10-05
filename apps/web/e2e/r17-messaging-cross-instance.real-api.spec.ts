import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { replica, type Replica } from './api-replicas';
import { seedLanguage } from './fixtures';
import { apiAt, REAL_API, type Jar } from './real-api';
import {
  applySession,
  leafCategoryId,
  registerSeeker,
  scheduledBooking,
  withDb,
  workingProvider,
} from './booking-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// R17-A — booking messages across two API instances.
//
// Two real API processes (replica A and replica B) share one PostgreSQL and
// one Redis, as two deployed instances would. Each serves its own copy of the
// built web app: web A talks only to replica A, web B only to replica B. The
// seeker writes from web A; the provider reads and replies from web B. Which
// replica a browser reached is proved from the URLs of the requests that
// browser actually made.
//
// Chat in the product is HTTP plus polling (R12); the realtime gateway is off
// by default and the web app does not subscribe to conversation rooms. That is
// the path tested here. Nothing in this spec enables realtime.
//
// docs/production-readiness/r17/R17_A_MESSAGING.md
//
// Synthetic people and messages only. No trace and no video: both would
// record session cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const WEB_A = process.env.E2E_REPLICA_A_WEB ?? '';
const WEB_B = process.env.E2E_REPLICA_B_WEB ?? '';
const PORT_A = Number(process.env.E2E_REPLICA_A_PORT ?? 4011);
const PORT_B = Number(process.env.E2E_REPLICA_B_PORT ?? 4012);

const cors = [WEB_A, WEB_B].filter(Boolean).join(',');
const A: Replica = replica('A', PORT_A, { CORS_ORIGINS: cors });
const B: Replica = replica('B', PORT_B, { CORS_ORIGINS: cors });

interface Row {
  id: string;
  body: string;
  senderUserId: string;
  senderRole: string;
}
const rowsIn = (conversationId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<Row>(
      `SELECT id, body, "senderUserId", "senderRole" FROM "Message"
        WHERE "conversationId" = $1 ORDER BY "createdAt", id`,
      [conversationId],
    );
    return rows;
  });

/** Every API request a page makes, as `METHOD origin path`. */
function recordApiCalls(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/v1/')) seen.push(`${r.method()} ${url.origin}${url.pathname}`);
  });
  return seen;
}
const origins = (calls: string[]) => new Set(calls.map((c) => new URL(c.split(' ')[1]).origin));

async function openSeekerChat(page: Page, web: string, api: string, bookingId: string) {
  const detail = page.waitForResponse(
    (r) => r.url() === `${api}/v1/me/bookings/${bookingId}` && r.request().method() === 'GET',
  );
  await page.goto(`${web}/home/bookings`);
  await page.getByTestId(`booking-card-${bookingId}`).click();
  expect((await detail).status()).toBe(200);
  const opened = page.waitForResponse(
    (r) => r.url() === `${api}/v1/me/conversations` && r.request().method() === 'POST',
  );
  await page.getByTestId('booking-action-message').click();
  const response = await opened;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  return ((await response.json()) as { conversation: { id: string } }).conversation.id;
}

async function seekerSends(page: Page, api: string, conversationId: string, body: string) {
  const sent = page.waitForResponse(
    (r) =>
      r.url() === `${api}/v1/me/conversations/${conversationId}/messages` &&
      r.request().method() === 'POST',
  );
  await page.getByTestId('chat-input').fill(body);
  await page.getByTestId('chat-send').click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({
    body,
    idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/),
  });
}

const visible = (page: Page, text: string) => page.getByText(text).filter({ visible: true });

test.describe('R17-A messaging across two API instances — real API, PostgreSQL and Redis', () => {
  test.skip(
    !REAL_API || !WEB_A || !WEB_B,
    'E2E_REAL_API, E2E_REPLICA_A_WEB and E2E_REPLICA_B_WEB are required for R17-A.',
  );
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  test.beforeAll(async () => {
    // The shared fixtures address E2E_REAL_API; it must be replica A itself.
    expect(REAL_API).toBe(A.url);
    await A.start();
    await B.start();
    expect(A.pid()).not.toBe(B.pid());
  });
  test.afterAll(async () => {
    await Promise.allSettled([A.stop(), B.stop()]);
  });

  test('seeker on A and provider on B share one durable conversation, through a restart', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17a');
    const provider = await workingProvider(categoryId, 'r17a');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const providerUserId = await withDb(async (db) => {
      const { rows } = await db.query<{ userId: string }>(
        'SELECT "userId" FROM "ProviderProfile" WHERE id = $1',
        [provider.profileId],
      );
      return rows[0].userId;
    });

    // ── 1. the seeker writes through web A, which reaches replica A only ────
    await page.setViewportSize({ width: 390, height: 844 });
    const seekerCalls = recordApiCalls(page);
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    const conversationId = await openSeekerChat(page, WEB_A, A.url, bookingId);
    const first = 'R17 hello from the seeker, sent through replica A.';
    await seekerSends(page, A.url, conversationId, first);
    await expect(visible(page, first).first()).toBeVisible();
    expect(await rowsIn(conversationId)).toEqual([
      expect.objectContaining({ body: first, senderUserId: seeker.userId, senderRole: 'SEEKER' }),
    ]);
    expect([...origins(seekerCalls)]).toEqual([A.url]);

    // ── 2. the provider reads and replies through web B: replica B only ────
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    let providerPage: Page;
    try {
      await applySession(providerContext, provider.jar);
      providerPage = await providerContext.newPage();
      const providerCalls = recordApiCalls(providerPage);
      await seedLanguage(providerPage, 'en');
      await providerPage.goto(`${WEB_B}/provider/bids`);
      const opened = providerPage.waitForResponse(
        (r) => r.url() === `${B.url}/v1/provider/conversations` && r.request().method() === 'POST',
      );
      await providerPage.getByTestId(`provider-booking-message-${bookingId}`).click();
      expect((await opened).status()).toBe(200);
      await providerPage.waitForURL(`**/provider/messages/${conversationId}`);
      await expect(visible(providerPage, first).first()).toBeVisible();

      const reply = 'R17 reply from the provider, sent through replica B.';
      const replied = providerPage.waitForResponse(
        (r) =>
          r.url() === `${B.url}/v1/provider/conversations/${conversationId}/messages` &&
          r.request().method() === 'POST',
      );
      await providerPage.getByLabel('Type a message…').fill(reply);
      await providerPage.getByRole('button', { name: 'Send' }).click();
      expect((await replied).status()).toBe(201);
      expect([...origins(providerCalls)]).toEqual([B.url]);

      // ── 3. the reply reaches the seeker's open chat on A by its own reads ──
      await expect(visible(page, reply)).toHaveCount(1, { timeout: 20_000 });
      expect([...origins(seekerCalls)]).toEqual([A.url]);
      // The seeker's open chat read up to the reply it was shown, on replica A.
      await expect
        .poll(async () =>
          withDb(async (db) => {
            const { rows } = await db.query<{ read: boolean }>(
              `SELECT p."lastReadAt" >= m."createdAt" AS read
                 FROM "ConversationParticipant" p, "Message" m
                WHERE p."conversationId" = $1 AND p."userId" = $2 AND m.body = $3`,
              [conversationId, seeker.userId, reply],
            );
            return rows[0]?.read ?? false;
          }),
        )
        .toBe(true);
      await testInfo.attach('r17a-seeker-on-A-390.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      // ── 4. the seeker continues on the other replica with the same session ─
      const onB = await context.newPage();
      const onBCalls = recordApiCalls(onB);
      expect(await openSeekerChat(onB, WEB_B, B.url, bookingId)).toBe(conversationId);
      await expect(visible(onB, first).first()).toBeVisible();
      await expect(visible(onB, reply).first()).toBeVisible();
      expect([...origins(onBCalls)]).toEqual([B.url]);

      // ── 5. replica A goes down; the conversation carries on through B ──────
      const pidBefore = A.pid();
      await A.stop();
      await expect(fetch(`${A.url}/health/live`)).rejects.toThrow();
      const duringRestart = 'R17 written through replica B while replica A was down.';
      await seekerSends(onB, B.url, conversationId, duringRestart);
      await onB.close();

      // ── 6. replica A comes back as a new process with the full history ─────
      await A.start();
      expect(A.pid()).not.toBe(pidBefore);
      await page.reload();
      await openSeekerChat(page, WEB_A, A.url, bookingId);
      for (const body of [first, reply, duringRestart]) {
        await expect(visible(page, body)).toHaveCount(1);
      }
      await providerPage.reload();
      for (const body of [first, reply, duringRestart]) {
        await expect(visible(providerPage, body)).toHaveCount(1);
      }
      await testInfo.attach('r17a-provider-on-B-after-restart-390.png', {
        body: await providerPage.screenshot(),
        contentType: 'image/png',
      });

      // ── 7. committed history: complete, ordered, no duplicate ─────────────
      const rows = await rowsIn(conversationId);
      expect(rows.map((r) => [r.body, r.senderRole])).toEqual([
        [first, 'SEEKER'],
        [reply, 'PROVIDER'],
        [duringRestart, 'SEEKER'],
      ]);
      expect(rows.map((r) => r.senderUserId)).toEqual([
        seeker.userId,
        providerUserId,
        seeker.userId,
      ]);
      expect(new Set(rows.map((r) => r.id)).size).toBe(3);
      for (const r of [A, B]) {
        const read = await apiAt<{ items: { id: string }[] }>(
          r.url,
          seeker.jar,
          `/v1/me/conversations/${conversationId}/messages`,
        );
        expect(read.status).toBe(200);
        expect(read.body.items.map((m) => m.id)).toEqual(rows.map((m) => m.id));
      }

      // ── 8. unread is server truth on either replica ───────────────────────
      await page.goto(`${WEB_A}/home/bookings`); // the seeker's chat is closed
      const late = await apiAt<{ message: { id: string } }>(
        B.url,
        provider.jar,
        `/v1/provider/conversations/${conversationId}/messages`,
        { method: 'POST', body: { body: 'R17 sent while the seeker was away.' } },
      );
      expect(late.status).toBe(201);
      for (const r of [A, B]) {
        const list = await apiAt<{ items: { id: string; unreadCount: number }[] }>(
          r.url,
          seeker.jar,
          '/v1/me/conversations',
        );
        expect(list.body.items.find((c) => c.id === conversationId)?.unreadCount).toBe(1);
      }
    } finally {
      await providerContext.close();
    }
  });

  test('a send retried on the other replica is stored once; a changed retry is refused', async () => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17b');
    const provider = await workingProvider(categoryId, 'r17b');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const conv = await apiAt<{ conversation: { id: string } }>(
      A.url,
      seeker.jar,
      '/v1/me/conversations',
      { method: 'POST', body: { bookingId } },
    );
    const conversationId = conv.body.conversation.id;
    const path = `/v1/me/conversations/${conversationId}/messages`;
    const send = { body: 'R17 one logical send.', idempotencyKey: `r17-${crypto.randomUUID()}` };

    // The reply from A is lost to the client; it retries the same command on B.
    const onA = await apiAt<{ message: { id: string } }>(A.url, seeker.jar, path, {
      method: 'POST',
      body: send,
    });
    expect(onA.status).toBe(201);
    const onB = await apiAt<{ message: { id: string }; replayed?: boolean }>(
      B.url,
      seeker.jar,
      path,
      { method: 'POST', body: send },
    );
    expect(onB.status).toBe(201);
    expect(onB.body).toMatchObject({ message: { id: onA.body.message.id }, replayed: true });
    const changed = await apiAt(B.url, seeker.jar, path, {
      method: 'POST',
      body: { ...send, body: 'R17 a different message under the same key.' },
    });
    expect(changed.status).toBe(409);
    // Two intentional identical messages, each with its own key, are two.
    for (const r of [A, B]) {
      const twin = await apiAt(r.url, seeker.jar, path, {
        method: 'POST',
        body: { body: 'R17 same words.', idempotencyKey: `r17-${crypto.randomUUID()}` },
      });
      expect(twin.status).toBe(201);
    }
    expect((await rowsIn(conversationId)).map((r) => r.body)).toEqual([
      'R17 one logical send.',
      'R17 same words.',
      'R17 same words.',
    ]);
  });

  test('history paged on one replica stays complete while the other replica writes', async () => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17c');
    const provider = await workingProvider(categoryId, 'r17c');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const conversationId = (
      await apiAt<{ conversation: { id: string } }>(A.url, seeker.jar, '/v1/me/conversations', {
        method: 'POST',
        body: { bookingId },
      })
    ).body.conversation.id;
    const write = (r: Replica, jar: Jar, base: string, body: string) =>
      apiAt(r.url, jar, `${base}/${conversationId}/messages`, { method: 'POST', body: { body } });
    for (let i = 0; i < 7; i += 1) {
      const res =
        i % 2 === 0
          ? await write(A, seeker.jar, '/v1/me/conversations', `R17 page ${i}`)
          : await write(B, provider.jar, '/v1/provider/conversations', `R17 page ${i}`);
      expect(res.status).toBe(201);
    }

    // Page backwards through replica B, three at a time, while replica A keeps
    // writing between the page reads.
    type Page_ = { items: { id: string; body: string }[]; nextCursor: string | null };
    const seen: string[] = [];
    let cursor: string | null = null;
    let interleaved = 0;
    do {
      const query: string = `limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await apiAt<Page_>(
        B.url,
        seeker.jar,
        `/v1/me/conversations/${conversationId}/messages?${query}`,
      );
      expect(res.status).toBe(200);
      seen.unshift(...res.body.items.map((m) => m.id));
      cursor = res.body.nextCursor;
      expect(
        (await write(A, seeker.jar, '/v1/me/conversations', `R17 new ${interleaved}`)).status,
      ).toBe(201);
      interleaved += 1;
    } while (cursor);

    // Catch-up: the newest page read again from A returns what arrived meanwhile.
    const newest = await apiAt<Page_>(
      A.url,
      seeker.jar,
      `/v1/me/conversations/${conversationId}/messages?limit=100`,
    );
    const stored = (await rowsIn(conversationId)).map((r) => r.id);
    expect(newest.body.items.map((m) => m.id)).toEqual(stored);
    // The paged walk saw every message that existed before it started, once,
    // in stored order, and nothing twice.
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(stored.slice(0, 7));
    expect(stored).toHaveLength(7 + interleaved);
  });

  test('a session ended on one replica is refused on the other; strangers learn nothing', async ({
    browser,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17d');
    const provider = await workingProvider(categoryId, 'r17d');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const conversationId = (
      await apiAt<{ conversation: { id: string } }>(A.url, seeker.jar, '/v1/me/conversations', {
        method: 'POST',
        body: { bookingId },
      })
    ).body.conversation.id;
    const path = `/v1/me/conversations/${conversationId}/messages`;
    await apiAt(A.url, seeker.jar, path, { method: 'POST', body: { body: 'R17 private words.' } });

    const stranger = await registerSeeker('r17x');
    for (const r of [A, B]) {
      const res = await apiAt(r.url, stranger.jar, path);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('private words');
      expect(
        (await apiAt(r.url, stranger.jar, path, { method: 'POST', body: { body: 'hi' } })).status,
      ).toBe(404);
    }
    const anonymous = await fetch(`${B.url}${path}`);
    expect(anonymous.status).toBe(401);

    // Keep a copy of the session cookies, end the session through replica A,
    // then present the old cookies to replica B.
    const old: Jar = new Map(seeker.jar);
    expect(
      (await apiAt(A.url, seeker.jar, '/v1/auth/logout', { method: 'POST' })).status,
    ).toBeLessThan(300);
    expect((await apiAt(B.url, old, path)).status).toBe(401);
    expect(
      (await apiAt(B.url, old, path, { method: 'POST', body: { body: 'after logout' } })).status,
    ).toBe(401);

    // And in a browser on web B with those old cookies: no history is shown.
    const ctx: BrowserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await applySession(ctx, old);
      const p = await ctx.newPage();
      const refused: number[] = [];
      p.on('response', (r) => {
        if (r.url().startsWith(`${B.url}/v1/`) && r.status() === 401) refused.push(r.status());
      });
      await seedLanguage(p, 'en');
      await p.goto(`${WEB_B}/home/messages`);
      await p.waitForURL(/\/login/, { timeout: 20_000 });
      expect(refused.length).toBeGreaterThan(0);
      await expect(visible(p, 'R17 private words.')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
    expect((await rowsIn(conversationId)).map((r) => r.body)).toEqual(['R17 private words.']);
  });
});
