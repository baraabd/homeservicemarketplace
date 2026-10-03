import { expect, test, type Page } from '@playwright/test';

import { seedLanguage } from './fixtures';
import { api, loginViaUi, REAL_API, type Account } from './real-api';
import {
  applySession,
  leafCategoryId,
  providerMoves,
  registerSeeker,
  scheduledBooking,
  withDb,
  workingProvider,
  type Seeker,
} from './booking-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// R12 — booking communication and job actions, through the real stack.
//
// Two people in two browsers: a seeker on the job screen and a provider in the
// provider workspace. They talk through the conversation the server keeps for
// their booking. The real API and real PostgreSQL are used throughout.
//
// What is under test is reached by clicking: the Message button, the chat
// input, the provider's Message action and thread. Only the provider's admin
// approval is arranged directly, and that is labelled where it happens.
//
// Synthetic people and synthetic messages only. No trace and no video: both
// would record session cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const CONVERSATIONS = `${REAL_API}/v1/me/conversations`;

const conversationsOf = (bookingId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM "Conversation" WHERE "bookingId" = $1',
      [bookingId],
    );
    return rows.map((r) => r.id);
  });

const messagesIn = (conversationId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ body: string; senderUserId: string; senderRole: string }>(
      `SELECT body, "senderUserId", "senderRole" FROM "Message"
        WHERE "conversationId" = $1 ORDER BY "createdAt", id`,
      [conversationId],
    );
    return rows;
  });

const providerUserId = (account: Account) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ userId: string }>(
      'SELECT "userId" FROM "ProviderProfile" WHERE id = $1',
      [account.profileId],
    );
    return rows[0].userId;
  });

/** The seeker's job screen for a booking, reached from the Bookings tab. */
async function openBooking(page: Page, bookingId: string): Promise<void> {
  const detail = page.waitForResponse(
    (r) => r.url() === `${REAL_API}/v1/me/bookings/${bookingId}` && r.request().method() === 'GET',
  );
  await page.goto(`${BASE_URL}/home/bookings`);
  await page.getByTestId(`booking-card-${bookingId}`).click();
  expect((await detail).status()).toBe(200);
  await expect(page.getByTestId('booking-action-message')).toBeVisible();
}

/** Press Message and return the conversation the server answered with. */
async function pressMessage(page: Page, bookingId: string): Promise<string> {
  const opened = page.waitForResponse(
    (r) => r.url() === CONVERSATIONS && r.request().method() === 'POST',
  );
  await page.getByTestId('booking-action-message').click();
  const response = await opened;
  expect(response.status(), await response.text()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ bookingId });
  const { conversation } = (await response.json()) as { conversation: { id: string } };
  await expect(page.getByTestId('chat-input')).toBeVisible();
  return conversation.id;
}

async function seekerSends(page: Page, conversationId: string, body: string): Promise<void> {
  const sent = page.waitForResponse(
    (r) =>
      r.url() === `${CONVERSATIONS}/${conversationId}/messages` && r.request().method() === 'POST',
  );
  await page.getByTestId('chat-input').fill(body);
  await page.getByTestId('chat-send').click();
  const response = await sent;
  expect(response.status(), await response.text()).toBe(201);
  // One logical send: the text and a key naming it (R12).
  expect(response.request().postDataJSON()).toEqual({
    body,
    idempotencyKey: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/),
  });
}

test.describe('R12 booking communication — two browsers, real API and PostgreSQL', () => {
  test.skip(!REAL_API, 'E2E_REAL_API is required for R12 real-service acceptance.');
  test.describe.configure({ timeout: 300_000 });

  test('seeker and provider talk through their booking’s one conversation', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r12');
    const provider = await workingProvider(categoryId, 'r12');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const providerUser = await providerUserId(provider);
    expect(await conversationsOf(bookingId)).toEqual([]);

    // ── the seeker presses Message ─────────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });
    // Every request the seeker's browser makes to open a conversation.
    let seekerOpens = 0;
    page.on('request', (r) => {
      if (r.url() === CONVERSATIONS && r.method() === 'POST') seekerOpens += 1;
    });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openBooking(page, bookingId);

    // Call is not available and says so; nothing offers a number.
    await expect(page.getByTestId('booking-action-call')).toBeDisabled();
    await expect(page.getByTestId('booking-action-call-note')).toHaveText(
      'Calls aren’t available in the app. Use Message to reach your pro.',
    );
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    await expect(page.getByText(/coming soon/i)).toHaveCount(0);
    // Progress tells the truth about a booking that has not started.
    await page.getByTestId('booking-action-progress').click();
    await expect(page.getByTestId('booking-progress')).toBeFocused();
    await expect(page.getByTestId('progress-step-2')).toHaveAttribute('data-current', 'true');
    await expect(page.getByTestId('progress-step-3')).toHaveAttribute('data-done', 'false');

    const conversationId = await pressMessage(page, bookingId);
    expect(await conversationsOf(bookingId)).toEqual([conversationId]);
    // The chat claims no presence and offers no call.
    await expect(page.getByText(/online/i)).toHaveCount(0);
    await expect(page.getByTestId('chat-call-unavailable')).toBeDisabled();

    const first = 'Hello, is ten tomorrow still good for you?';
    await seekerSends(page, conversationId, first);
    await expect(page.getByText(first).filter({ visible: true }).first()).toBeVisible();
    expect(await messagesIn(conversationId)).toEqual([
      { body: first, senderUserId: seeker.userId, senderRole: 'SEEKER' },
    ]);
    await testInfo.attach('r12-seeker-chat-390.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // ── the provider, in their own browser ─────────────────────────────────
    const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await applySession(providerContext, provider.jar);
      const providerPage = await providerContext.newPage();
      await seedLanguage(providerPage, 'en');
      await providerPage.goto(`${BASE_URL}/provider/bids`);
      const opened = providerPage.waitForResponse(
        (r) =>
          r.url() === `${REAL_API}/v1/provider/conversations` && r.request().method() === 'POST',
      );
      await providerPage.getByTestId(`provider-booking-message-${bookingId}`).click();
      const openedResponse = await opened;
      expect(openedResponse.status()).toBe(200);
      expect(openedResponse.request().postDataJSON()).toEqual({ bookingId });
      // The same conversation, not a second one.
      await providerPage.waitForURL(`**/provider/messages/${conversationId}`);
      await expect(providerPage.getByText(first).filter({ visible: true }).first()).toBeVisible();

      const reply = 'Yes, ten works. I will bring the parts.';
      const replied = providerPage.waitForResponse(
        (r) =>
          r.url() === `${REAL_API}/v1/provider/conversations/${conversationId}/messages` &&
          r.request().method() === 'POST',
      );
      await providerPage.getByLabel('Type a message…').fill(reply);
      await providerPage.getByRole('button', { name: 'Send' }).click();
      expect((await replied).status()).toBe(201);
      await expect(providerPage.getByText(reply).filter({ visible: true }).first()).toBeVisible();
      expect(await messagesIn(conversationId)).toEqual([
        { body: first, senderUserId: seeker.userId, senderRole: 'SEEKER' },
        { body: reply, senderUserId: providerUser, senderRole: 'PROVIDER' },
      ]);
      await testInfo.attach('r12-provider-thread-390.png', {
        body: await providerPage.screenshot(),
        contentType: 'image/png',
      });

      // ── the reply reaches the seeker's chat while it is open ───────────
      // Nothing is reopened or reloaded on the seeker's side: the open chat
      // reads the conversation again while it is on screen.
      const opensBefore = seekerOpens;
      await expect(page.getByTestId('chat-input')).toBeVisible();
      await expect(page.getByText(reply).filter({ visible: true })).toHaveCount(1, {
        timeout: 15_000,
      });
      expect(seekerOpens).toBe(opensBefore);
      await testInfo.attach('r12-seeker-reply-live-390.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      // ── the seeker reads the reply after a reload ──────────────────────
      await openBooking(page, bookingId);
      expect(await pressMessage(page, bookingId)).toBe(conversationId);
      await expect(page.getByText(first).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(reply).filter({ visible: true }).first()).toBeVisible();

      // The provider's history survives a reload too.
      await providerPage.reload();
      await expect(providerPage.getByText(reply).filter({ visible: true }).first()).toBeVisible();
      await expect(providerPage.getByText(first).filter({ visible: true }).first()).toBeVisible();
    } finally {
      await providerContext.close();
    }

    // ── a fresh browser and a fresh sign-in ────────────────────────────────
    const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const freshPage = await fresh.newPage();
      await seedLanguage(freshPage, 'en');
      await freshPage.goto(`${BASE_URL}/login`);
      await loginViaUi(freshPage, seeker);
      await freshPage.waitForURL(/\/home/);
      await openBooking(freshPage, bookingId);
      expect(await pressMessage(freshPage, bookingId)).toBe(conversationId);
      await expect(
        freshPage
          .getByText('Yes, ten works. I will bring the parts.')
          .filter({ visible: true })
          .first(),
      ).toBeVisible();
    } finally {
      await fresh.close();
    }

    // ── pressing Message twice in the same moment ──────────────────────────
    // Two real clicks dispatched in one task, before the app can re-render
    // and disable the button: the app sends one request, and the server has
    // one conversation for the booking.
    await openBooking(page, bookingId);
    const opensBeforeDouble = seekerOpens;
    const doubleOpened = page.waitForResponse(
      (r) => r.url() === CONVERSATIONS && r.request().method() === 'POST',
    );
    await page.getByTestId('booking-action-message').evaluate((el) => {
      (el as HTMLButtonElement).click();
      (el as HTMLButtonElement).click();
    });
    expect((await doubleOpened).status()).toBe(200);
    await expect(page.getByTestId('chat-input')).toBeVisible();
    expect(seekerOpens - opensBeforeDouble).toBe(1);
    expect(await conversationsOf(bookingId)).toEqual([conversationId]);

    // ── people outside the booking ─────────────────────────────────────────
    const stranger = await registerSeeker('r12x');
    for (const [path, init] of [
      ['/v1/me/conversations', { method: 'POST', body: { bookingId } }],
      [`/v1/me/conversations/${conversationId}/messages`, {}],
      [`/v1/me/conversations/${conversationId}/messages`, { method: 'POST', body: { body: 'hi' } }],
      [`/v1/me/conversations/${conversationId}/read`, { method: 'POST' }],
    ] as const) {
      const res = await api(stranger.jar, path, init);
      expect(res.status, `${init && 'method' in init ? init.method : 'GET'} ${path}`).toBe(404);
    }
    const otherProvider = await workingProvider(categoryId, 'r12y');
    expect(
      (
        await api(otherProvider.jar, '/v1/provider/conversations', {
          method: 'POST',
          body: { bookingId },
        })
      ).status,
    ).toBe(404);
    expect(
      (await api(otherProvider.jar, `/v1/provider/conversations/${conversationId}/messages`))
        .status,
    ).toBe(404);
    const anonymous = await fetch(`${CONVERSATIONS}/${conversationId}/messages`);
    expect(anonymous.status).toBe(401);
    expect(await messagesIn(conversationId)).toHaveLength(2);

    // ── a suspended provider is out of the chat on every route ─────────────
    // Arranged directly: the suspension decision itself is accepted elsewhere.
    await withDb((db) =>
      db.query(`UPDATE "ProviderProfile" SET "standingState" = 'SUSPENDED' WHERE id = $1`, [
        provider.profileId,
      ]),
    );
    try {
      const viaProviderRoutes = await api(
        provider.jar,
        `/v1/provider/conversations/${conversationId}/messages`,
        { method: 'POST', body: { body: 'still here?' } },
      );
      expect(viaProviderRoutes.status).toBe(403);
      // Before R12 the seeker routes let the same provider post as PROVIDER.
      const viaSeekerRoutes = await api(
        provider.jar,
        `/v1/me/conversations/${conversationId}/messages`,
        { method: 'POST', body: { body: 'around the gate' } },
      );
      expect(viaSeekerRoutes.status).toBe(404);
      const openViaSeekerRoutes = await api(provider.jar, '/v1/me/conversations', {
        method: 'POST',
        body: { bookingId },
      });
      expect(openViaSeekerRoutes.status).toBe(404);
      expect(await messagesIn(conversationId)).toHaveLength(2);
    } finally {
      await withDb((db) =>
        db.query(`UPDATE "ProviderProfile" SET "standingState" = 'GOOD' WHERE id = $1`, [
          provider.profileId,
        ]),
      );
    }

    // ── Progress is the recorded status ────────────────────────────────────
    await providerMoves(provider, bookingId, 'start');
    await providerMoves(provider, bookingId, 'complete');
    await openBooking(page, bookingId);
    await page.getByTestId('booking-action-progress').click();
    await expect(page.getByTestId('booking-progress')).toBeFocused();
    await expect(page.getByTestId('progress-step-4')).toHaveAttribute('data-done', 'true');
    // No location, distance or arrival time is shown anywhere on the screen.
    await expect(
      page.getByText(/\b(ETA|km away|arriving|on the way|live location)\b/i),
    ).toHaveCount(0);

    // ── R11 on the same screen still works ─────────────────────────────────
    await page.getByTestId('booking-review-open').click();
    await page.getByTestId('booking-review-star-5').click();
    const reviewed = page.waitForResponse(
      (r) =>
        r.url() === `${REAL_API}/v1/me/bookings/${bookingId}/review` &&
        r.request().method() === 'POST',
    );
    await page.getByTestId('booking-review-submit').click();
    expect((await reviewed).status()).toBe(201);
    await expect(page.getByTestId('booking-review-saved')).toBeVisible();
    // And Message still opens the same conversation after completion.
    expect(await pressMessage(page, bookingId)).toBe(conversationId);
  });

  test('an answer lost on the way back does not make a second conversation', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker: Seeker = await registerSeeker('r12l');
    const provider = await workingProvider(categoryId, 'r12l');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openBooking(page, bookingId);

    // The request reaches the real server and is handled. Only the answer is
    // dropped, once.
    let reached = 0;
    await page.route(CONVERSATIONS, async (route) => {
      if (route.request().method() !== 'POST' || reached > 0) return route.fallback();
      reached += 1;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByTestId('booking-action-message').click();
    await expect(page.getByTestId('booking-action-message-error')).toHaveAttribute(
      'data-error',
      'NETWORK',
    );
    await expect(page.getByTestId('chat-input')).toHaveCount(0);
    const created = await conversationsOf(bookingId);
    expect(created).toHaveLength(1);

    // Pressing again opens the conversation the server already made.
    expect(await pressMessage(page, bookingId)).toBe(created[0]);
    expect(await conversationsOf(bookingId)).toEqual(created);
  });

  test('a message whose reply is lost, sent again, is stored and shown once', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r12m');
    const provider = await workingProvider(categoryId, 'r12m');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openBooking(page, bookingId);
    const conversationId = await pressMessage(page, bookingId);
    const route = `${CONVERSATIONS}/${conversationId}/messages`;
    const text = 'Please ring the bell twice.';

    // The send reaches the real server and is stored. Only its reply is
    // dropped, once; nothing is answered on the server's behalf.
    const sentKeys: string[] = [];
    let dropped = 0;
    await page.route(route, async (r) => {
      if (r.request().method() !== 'POST') return r.fallback();
      sentKeys.push((r.request().postDataJSON() as { idempotencyKey: string }).idempotencyKey);
      if (dropped > 0) return r.fallback();
      dropped += 1;
      const stored = await r.fetch();
      expect(stored.status()).toBe(201);
      await r.abort('failed');
    });

    await page.getByTestId('chat-input').fill(text);
    await page.getByTestId('chat-send').click();
    await expect(page.getByRole('alert')).toBeVisible();
    // Stored once already, though the browser never heard so.
    expect((await messagesIn(conversationId)).map((m) => m.body)).toEqual([text]);
    // The text is back in the box. Sending it unchanged is the same message.
    await expect(page.getByTestId('chat-input')).toHaveValue(text);
    const replayed = page.waitForResponse(
      (r) => r.url() === route && r.request().method() === 'POST',
    );
    await page.getByTestId('chat-send').click();
    const answer = await replayed;
    expect(answer.status()).toBe(201);
    expect(((await answer.json()) as { replayed?: boolean }).replayed).toBe(true);

    expect(sentKeys).toHaveLength(2);
    expect(sentKeys[1]).toBe(sentKeys[0]);
    expect((await messagesIn(conversationId)).map((m) => m.body)).toEqual([text]);
    await expect(page.getByText(text).filter({ visible: true })).toHaveCount(1);

    // The next message, even with the same words, is a new message.
    await seekerSends(page, conversationId, text);
    expect((await messagesIn(conversationId)).map((m) => m.body)).toEqual([text, text]);
    await expect(page.getByText(text).filter({ visible: true })).toHaveCount(2);
  });

  test('offline holds the message as sending; back online it is sent once', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r12o');
    const provider = await workingProvider(categoryId, 'r12o');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await openBooking(page, bookingId);
    const conversationId = await pressMessage(page, bookingId);

    // Offline, the app holds the message and says it is still sending. It is
    // not shown as sent, and nothing is stored.
    await context.setOffline(true);
    await page.getByTestId('chat-input').fill('Written while offline');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-message-pending')).toHaveText('Sending…');
    expect(await messagesIn(conversationId)).toEqual([]);

    // Back online, the held message goes out once and is then shown as sent.
    const resumed = page.waitForResponse(
      (r) =>
        r.url() === `${CONVERSATIONS}/${conversationId}/messages` &&
        r.request().method() === 'POST',
    );
    await context.setOffline(false);
    expect((await resumed).status()).toBe(201);
    await expect(page.getByTestId('chat-message-pending')).toHaveCount(0);
    await expect(
      page.getByText('Written while offline').filter({ visible: true }).first(),
    ).toBeVisible();
    expect((await messagesIn(conversationId)).map((m) => m.body)).toEqual([
      'Written while offline',
    ]);
  });

  test('Arabic, right-to-left, at 360, 390 and 430, by keyboard', async ({
    page,
    context,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r12a');
    const provider = await workingProvider(categoryId, 'r12a');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'ar');

    for (const size of [
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 640 },
    ]) {
      await page.setViewportSize(size);
      await openBooking(page, bookingId);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('booking-action-call-note')).toHaveText(
        'المكالمات غير متاحة في التطبيق. استخدم الرسائل للتواصل مع المحترف.',
      );
      const layout = await page.evaluate(() => {
        const box = (id: string) => {
          const r = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
          return { w: r.width, h: r.height, left: r.left, right: r.right };
        };
        return {
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          width: window.innerWidth,
          actions: ['booking-action-message', 'booking-action-call', 'booking-action-progress'].map(
            box,
          ),
        };
      });
      expect(layout.overflow).toBeLessThanOrEqual(0);
      for (const a of layout.actions) {
        expect(a.w).toBeGreaterThanOrEqual(44);
        expect(a.h).toBeGreaterThanOrEqual(44);
        expect(a.left).toBeGreaterThanOrEqual(0);
        expect(a.right).toBeLessThanOrEqual(layout.width);
      }
      // Right-to-left: Message is the rightmost action.
      expect(layout.actions[0].left).toBeGreaterThan(layout.actions[2].left);
      await testInfo.attach(`r12-actions-ar-${size.width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }

    // Keyboard: focus Message, press Enter, type, send with the keyboard.
    const opened = page.waitForResponse(
      (r) => r.url() === CONVERSATIONS && r.request().method() === 'POST',
    );
    await page.getByTestId('booking-action-message').focus();
    await page.keyboard.press('Enter');
    const { conversation } = (await (await opened).json()) as { conversation: { id: string } };
    const input = page.getByTestId('chat-input');
    await expect(input).toBeVisible();
    await input.focus();
    await page.keyboard.type('مرحباً، هل الموعد ما زال مناسباً؟');
    const sent = page.waitForResponse(
      (r) =>
        r.url() === `${CONVERSATIONS}/${conversation.id}/messages` &&
        r.request().method() === 'POST',
    );
    await page.keyboard.press('Enter');
    expect((await sent).status()).toBe(201);
    await expect(
      page.getByText('مرحباً، هل الموعد ما زال مناسباً؟').filter({ visible: true }).first(),
    ).toBeVisible();
    const fontSize = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    await testInfo.attach('r12-chat-ar-360.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
