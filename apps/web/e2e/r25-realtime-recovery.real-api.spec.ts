import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

import { replica } from './api-replicas';
import { seedLanguage } from './fixtures';
import { assertFontsReady, serveVendoredAssets } from './prototype-assets';
import { adminJar, apiAt, REAL_API, type Jar } from './real-api';
import {
  applySession,
  leafCategoryId,
  registerSeeker,
  scheduledBooking,
  withDb,
  workingProvider,
} from './booking-fixtures';

// R25 accepts the real routes and real committed data. Socket faults below
// only drop/repeat genuine server frames; no application response is stubbed.
// Cairo/Inter alone use the existing retained static-asset fixture. This keeps
// a blocked external font CDN from preventing the production bundle mounting;
// API, Socket.IO, authentication and durable history remain real services.
// Requires the sprint harness's disposable DB/Redis/mailbox and two previews
// built with VITE_REALTIME_SOCKET_IO=true. The normal mock suite must exclude
// this file (coordinator-owned Playwright routing request).
test.use({ trace: 'off', video: 'off', actionTimeout: 15_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial', timeout: 420_000 });

const WEB_A = process.env.E2E_REPLICA_A_WEB ?? '';
const WEB_B = process.env.E2E_REPLICA_B_WEB ?? '';
const config = {
  CORS_ORIGINS: [WEB_A, WEB_B].filter(Boolean).join(','),
  REALTIME_SOCKET_IO: 'true',
};
const A = replica('R25-A', Number(process.env.E2E_REPLICA_A_PORT ?? 4325), config);
const B = replica('R25-B', Number(process.env.E2E_REPLICA_B_PORT ?? 4425), config);

interface Envelope {
  type: string;
  eventId?: string;
  payload?: { conversationId?: string };
}
function envelope(frame: string | Buffer): Envelope | null {
  if (typeof frame !== 'string' || !frame.startsWith('42[')) return null;
  try {
    const [name, data] = JSON.parse(frame.slice(2)) as [string, Envelope];
    return name === 'realtime.event' ? data : null;
  } catch {
    return null;
  }
}

async function transportProbe(page: Page) {
  const live = new Set<WebSocketRoute>();
  const probe = {
    attempts: 0,
    connected: 0,
    authorized: 0,
    subscriptions: 0,
    messages: 0,
    repeated: 0,
    blocked: false,
    messageIds: new Set<string>(),
  };
  await page.routeWebSocket(
    (url) => url.pathname === '/socket.io/',
    (client) => {
      probe.attempts += 1;
      if (probe.blocked) {
        void client.close();
        return;
      }
      const server = client.connectToServer();
      live.add(client);
      server.onMessage((frame) => {
        if (typeof frame === 'string' && frame.startsWith('40')) probe.connected += 1;
        if (typeof frame === 'string' && frame.startsWith('42["connection.ack",'))
          probe.authorized += 1;
        if (typeof frame === 'string' && frame.startsWith('43')) {
          try {
            const [ack] = JSON.parse(frame.slice(frame.indexOf('['))) as Array<{
              ok?: boolean;
              room?: string;
            }>;
            if (ack?.ok && ack.room?.startsWith('conversation:')) probe.subscriptions += 1;
          } catch {
            /* Not a conversation acknowledgement. */
          }
        }
        client.send(frame);
        const event = envelope(frame);
        if (event?.type === 'message.created') {
          probe.messages += 1;
          if (event.eventId) probe.messageIds.add(event.eventId);
          // Duplicate fault: repeat precisely the authorized immutable frame.
          client.send(frame);
          probe.repeated += 1;
        }
      });
    },
  );
  return {
    probe,
    async block() {
      probe.blocked = true;
      await Promise.all([...live].map((socket) => socket.close()));
      live.clear();
    },
  };
}

async function recordToasts(page: Page) {
  await page.addInitScript(() => {
    const observed = new WeakSet<Element>();
    const counts: Record<string, number> = {};
    Object.defineProperty(window, '__r25ToastCounts', { value: counts, configurable: true });
    const inspect = () => {
      for (const element of document.querySelectorAll('[data-sonner-toast]')) {
        if (observed.has(element)) continue;
        observed.add(element);
        const title = element.querySelector('[data-title]')?.textContent ?? '';
        counts[title] = (counts[title] ?? 0) + 1;
      }
    };
    new MutationObserver(inspect).observe(document, { childList: true, subtree: true });
  });
}

const toastCount = (page: Page, title: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __r25ToastCounts: Record<string, number> }).__r25ToastCounts[name] ??
      0,
    title,
  );

async function openSeekerChat(page: Page, bookingId: string): Promise<string> {
  await page.goto(`${WEB_A}/home/bookings`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator('#startup-error'),
    'The production application must mount before the booking route can render',
  ).toHaveCount(0, { timeout: 15_000 });
  await page.getByTestId(`booking-card-${bookingId}`).click();
  const response = page.waitForResponse(
    (result) =>
      result.url() === `${A.url}/v1/me/conversations` && result.request().method() === 'POST',
  );
  await page.getByTestId('booking-action-message').click();
  const opened = await response;
  expect(opened.status()).toBe(200);
  await expect(page.getByTestId('chat-input')).toBeVisible();
  return ((await opened.json()) as { conversation: { id: string } }).conversation.id;
}

async function sendProviderMessage(page: Page, conversationId: string, body: string) {
  const response = page.waitForResponse(
    (result) =>
      result.url() === `${B.url}/v1/provider/conversations/${conversationId}/messages` &&
      result.request().method() === 'POST',
  );
  await page.getByLabel('Type a message…').fill(body);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await response).status()).toBe(201);
}

async function openBell(page: Page) {
  const bell = page.getByTestId('seeker-notifications-bell');
  await bell.focus();
  await expect(bell).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('notification-drawer')).toHaveAttribute('aria-hidden', 'false');
}

const unread = async (url: string, jar: Jar) => {
  const response = await apiAt<{ count: number }>(
    url,
    jar,
    '/v1/me/notifications/unread-count?experience=seeker',
  );
  expect(response.status).toBe(200);
  return response.body.count;
};

test.beforeAll(async () => {
  // Configuration errors fail explicitly. Exclusion is owned by the runner,
  // never a silent passing/skip branch inside this acceptance test.
  expect(process.env.HSM_R25_REALTIME).toBe('isolated-ci');
  expect(REAL_API).toBe(A.url);
  expect(WEB_A).toMatch(/^http:\/\/127\.0\.0\.1:/);
  expect(WEB_B).toMatch(/^http:\/\/127\.0\.0\.1:/);
  await A.start();
  await B.start();
  expect(A.pid()).not.toBe(B.pid());
});

test.afterAll(async () => {
  const stopped = await Promise.allSettled([A.stop(), B.stop()]);
  for (const result of stopped) if (result.status === 'rejected') throw result.reason;
});

test('real seeker/provider/admin routes recover across replicas, duplicates, socket failure, suspension and logout', async ({
  page,
  context,
  browser,
}, testInfo) => {
  const phase = (description: string) =>
    testInfo.annotations.push({ type: 'r25-phase', description });
  phase('real fixtures');
  const categoryId = await leafCategoryId();
  const seeker = await registerSeeker('r25');
  const provider = await workingProvider(categoryId, 'r25');
  const bookingId = await scheduledBooking(seeker, provider, categoryId);
  const admin = await adminJar();
  const providerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const isolated of [providerContext, adminContext]) {
    isolated.setDefaultTimeout(15_000);
    isolated.setDefaultNavigationTimeout(30_000);
  }
  const providerPage = await providerContext.newPage();
  const adminPage = await adminContext.newPage();
  const peer = await context.newPage();
  const apiOrigins = new Set<string>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/v1/')) apiOrigins.add(url.origin);
  });

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, seeker.jar);
    await applySession(providerContext, provider.jar);
    await applySession(adminContext, admin);
    await seedLanguage(page, 'en');
    await seedLanguage(peer, 'en');
    await seedLanguage(providerPage, 'en');
    await seedLanguage(adminPage, 'en');
    await recordToasts(page);
    await recordToasts(peer);
    const staticAssets = await Promise.all(
      [page, peer, providerPage, adminPage].map(async (tab) => {
        const assets = await serveVendoredAssets(tab);
        // The application bundles its scripts. Retain only this helper's
        // font/static routes, with no interception of application requests.
        await tab.unroute('**://unpkg.com/**');
        return assets;
      }),
    );
    const screenshot = async (tab: Page) => {
      await assertFontsReady(tab);
      for (const assets of staticAssets) expect(assets.missing).toEqual([]);
      return tab.screenshot();
    };
    const transport = await transportProbe(page);
    const peerTransport = await transportProbe(peer);
    phase('seeker bootstrap and authorized chat');
    const conversationId = await openSeekerChat(page, bookingId);
    await expect.poll(() => transport.probe.connected).toBeGreaterThan(0);
    await expect.poll(() => transport.probe.authorized).toBeGreaterThan(0);
    await expect.poll(() => transport.probe.subscriptions).toBeGreaterThan(0);

    phase('provider message across replicas');
    await providerPage.goto(`${WEB_B}/provider/messages/${conversationId}`);
    await expect(providerPage.getByLabel('Type a message…')).toBeVisible();
    const first = `R25 cross-replica message ${randomUUID()}`;
    await sendProviderMessage(providerPage, conversationId, first);
    await expect.poll(() => transport.probe.messages, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(transport.probe.repeated).toBeGreaterThan(0);
    expect(transport.probe.messageIds.size).toBeGreaterThan(0);
    await expect(page.getByText(first, { exact: true }).filter({ visible: true })).toHaveCount(1);
    expect([...apiOrigins]).toEqual([A.url]);

    // Read position belongs to the durable message actually shown.
    await expect
      .poll(() =>
        withDb(async (db) => {
          const { rows } = await db.query<{ read: boolean }>(
            `SELECT p."lastReadAt" >= m."createdAt" AS read FROM "ConversationParticipant" p, "Message" m
         WHERE p."conversationId" = $1 AND p."userId" = $2 AND m."conversationId" = $1 AND m.body = $3`,
            [conversationId, seeker.userId, first],
          );
          return rows[0]?.read ?? false;
        }),
      )
      .toBe(true);

    // A lost API replica creates a real reconnect gap. Publish on B while A
    // is stopped, then recover the open route without navigation/reloading.
    phase('replica restart recovery');
    const oldPid = A.pid();
    await A.stop();
    const gap = `R25 while replica A was stopped ${randomUUID()}`;
    await sendProviderMessage(providerPage, conversationId, gap);
    await A.start();
    expect(A.pid()).not.toBe(oldPid);
    await expect(page.getByText(gap, { exact: true }).filter({ visible: true })).toHaveCount(1, {
      timeout: 75_000,
    });
    await expect.poll(() => transport.probe.connected, { timeout: 75_000 }).toBeGreaterThan(1);
    const framesAfterRestart = transport.probe.messages;
    const resumed = `R25 new socket delivery after restart ${randomUUID()}`;
    await sendProviderMessage(providerPage, conversationId, resumed);
    await expect
      .poll(() => transport.probe.messages, { timeout: 15_000 })
      .toBeGreaterThan(framesAfterRestart);
    await expect(page.getByText(resumed, { exact: true }).filter({ visible: true })).toHaveCount(1);

    // Socket-only partition leaves the genuine REST server available. The
    // failed transport is not replaced by fabricated frames or UI state.
    phase('socket-only failure and REST fallback');
    await transport.block();
    const attemptsBefore = transport.probe.attempts;
    const polling = `R25 authoritative REST fallback ${randomUUID()}`;
    await sendProviderMessage(providerPage, conversationId, polling);
    await expect(page.getByText(polling, { exact: true }).filter({ visible: true })).toHaveCount(
      1,
      { timeout: 35_000 },
    );
    expect(transport.probe.attempts - attemptsBefore).toBeLessThanOrEqual(6);
    transport.probe.blocked = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => transport.probe.connected, { timeout: 75_000 }).toBeGreaterThan(2);

    const fromA = await apiAt<{ items: Array<{ id: string; body: string }> }>(
      A.url,
      seeker.jar,
      `/v1/me/conversations/${conversationId}/messages`,
    );
    const fromB = await apiAt<{ items: Array<{ id: string; body: string }> }>(
      B.url,
      seeker.jar,
      `/v1/me/conversations/${conversationId}/messages`,
    );
    expect([fromA.status, fromB.status]).toEqual([200, 200]);
    expect(fromA.body.items.map((row) => row.id)).toEqual(fromB.body.items.map((row) => row.id));
    for (const body of [first, gap, resumed, polling])
      expect(fromA.body.items.filter((row) => row.body === body)).toHaveLength(1);
    await testInfo.attach('r25-seeker-messages-en-390.png', {
      body: await screenshot(page),
      contentType: 'image/png',
    });
    await testInfo.attach('r25-provider-messages-en-390.png', {
      body: await screenshot(providerPage),
      contentType: 'image/png',
    });

    // Two same-origin seeker tabs receive a real booking transition. Both
    // cache snapshots converge, but the Web Lock allows one visible alert.
    phase('multi-tab notifications and durable read state');
    await page.goto(`${WEB_A}/home`);
    await peer.goto(`${WEB_A}/home`);
    await openBell(page);
    await openBell(peer);
    const beforeToast =
      (await toastCount(page, 'Booking started')) + (await toastCount(peer, 'Booking started'));
    const started = await apiAt(
      B.url,
      provider.jar,
      `/v1/me/provider/bookings/${bookingId}/start`,
      { method: 'POST' },
    );
    expect(started.status).toBe(200);
    await expect
      .poll(
        async () =>
          (await toastCount(page, 'Booking started')) + (await toastCount(peer, 'Booking started')),
        { timeout: 20_000 },
      )
      .toBe(beforeToast + 1);
    await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 2 unread',
    );
    await expect(peer.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 2 unread',
    );
    const marked = page.waitForResponse(
      (response) =>
        response.url().startsWith(`${A.url}/v1/me/notifications/read-all`) &&
        response.request().method() === 'POST',
    );
    await page
      .getByTestId('notification-drawer')
      .getByRole('button', { name: 'Mark all read', exact: true })
      .click();
    expect((await marked).status()).toBe(200);
    await expect(peer.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 0 unread',
      { timeout: 10_000 },
    );
    expect(await unread(A.url, seeker.jar)).toBe(0);
    expect(await unread(B.url, seeker.jar)).toBe(0);
    await peer.reload();
    await expect(peer.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 0 unread',
    );

    // Preserve bilingual notification routes and real keyboard controls at
    // the specified narrow/mobile/tablet/desktop widths.
    phase('bilingual notification layout and keyboard');
    for (const language of ['en', 'ar'] as const) {
      await seedLanguage(page, language);
      for (const width of [320, 390, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${WEB_A}/home`);
        await expect(page.locator('html')).toHaveAttribute(
          'dir',
          language === 'ar' ? 'rtl' : 'ltr',
        );
        await openBell(page);
        const close = page
          .getByTestId('notification-drawer')
          .getByRole('button', { name: language === 'ar' ? 'إغلاق' : 'Close', exact: true });
        await expect(close).toBeInViewport();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        ).toBeLessThanOrEqual(0);
        await testInfo.attach(`r25-notifications-${language}-${width}.png`, {
          body: await screenshot(page),
          contentType: 'image/png',
        });
        await close.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('notification-drawer')).toHaveAttribute(
          'aria-hidden',
          'true',
        );
      }
    }

    // Actual admin review controls change permission on B while provider is
    // connected to A. Provider standing and account identity remain separate.
    phase('admin suspension and provider authority');
    await providerPage.goto(`${WEB_A}/provider/messages/${conversationId}`);
    await adminPage.goto(`${WEB_B}/admin/providers/${provider.profileId}`);
    const workspace = adminPage.getByTestId('admin-provider-review-workspace');
    await expect(workspace).toBeVisible();
    const suspend = workspace.getByRole('button', { name: 'Suspend provider', exact: true });
    await suspend.focus();
    await suspend.press('Enter');
    await adminPage
      .getByLabel('Reason for suspension')
      .fill('R25 isolated capability-revocation acceptance');
    const decision = adminPage.waitForResponse(
      (response) =>
        response.url() === `${B.url}/v1/admin/providers/${provider.profileId}/suspend` &&
        response.request().method() === 'POST',
    );
    await adminPage.getByRole('button', { name: 'Confirm decision', exact: true }).click();
    expect((await decision).status()).toBe(200);
    await expect(workspace).toContainText('Provider status decision saved.');
    await expect
      .poll(
        async () =>
          (
            await apiAt(
              A.url,
              provider.jar,
              `/v1/provider/conversations/${conversationId}/messages`,
            )
          ).status,
      )
      .toBe(403);
    await expect(providerPage.getByLabel('Type a message…')).toHaveCount(0, { timeout: 30_000 });
    await adminPage.reload();
    await expect(
      workspace.getByRole('button', { name: 'Reactivate provider', exact: true }),
    ).toBeVisible();
    await testInfo.attach('r25-admin-review-en-1440.png', {
      body: await screenshot(adminPage),
      contentType: 'image/png',
    });
    await seedLanguage(adminPage, 'ar');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.reload();
    await expect(adminPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(
      workspace.getByRole('button', { name: 'رفع تعليق المهني', exact: true }),
    ).toBeVisible();
    await testInfo.attach('r25-admin-review-ar-390.png', {
      body: await screenshot(adminPage),
      contentType: 'image/png',
    });

    // Existing logout action invalidates the real session and every same-
    // origin tab; no delayed reconnect or queued UX can restore private data.
    phase('logout clears rendered history and pending reconnects');
    await seedLanguage(page, 'en');
    expect(await openSeekerChat(peer, bookingId)).toBe(conversationId);
    for (const body of [first, gap, resumed, polling])
      await expect(peer.getByText(body, { exact: true }).filter({ visible: true })).toHaveCount(1);
    await page.goto(`${WEB_A}/home/profile`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign Out', exact: true }).first().click();
    const out = page.waitForResponse(
      (response) =>
        response.url() === `${A.url}/v1/auth/logout` && response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign Out', exact: true }).last().click();
    expect((await out).status()).toBe(204);
    await expect(page).toHaveURL(/\/(login|select)/);
    await expect(peer).toHaveURL(/\/(login|select)/);
    expect(
      (await apiAt(B.url, seeker.jar, `/v1/me/conversations/${conversationId}/messages`)).status,
    ).toBe(401);
    for (const tab of [page, peer])
      for (const body of [first, gap, resumed, polling])
        await expect(tab.getByText(body, { exact: true })).toHaveCount(0);
    const afterLogout = [transport, peerTransport].map(({ probe }) => ({
      attempts: probe.attempts,
      authorized: probe.authorized,
      messages: probe.messages,
    }));
    // Deliberately observe a bounded interval after the redirect; an
    // instantaneous absence assertion cannot detect queued reconnect work.
    await page.waitForTimeout(3_000);
    expect(
      [transport, peerTransport].map(({ probe }) => ({
        attempts: probe.attempts,
        authorized: probe.authorized,
        messages: probe.messages,
      })),
    ).toEqual(afterLogout);
    for (const assets of staticAssets) expect(assets.missing).toEqual([]);

    await testInfo.attach('r25-browser-transport-summary.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            replicas: 2,
            principalContexts: 3,
            sameOriginSeekerTabs: 2,
            actualNamespaceConnections: transport.probe.connected,
            actualAuthorizedConnections: transport.probe.authorized,
            authorizedConversationSubscriptions: transport.probe.subscriptions,
            actualMessageFrames: transport.probe.messages,
            repeatedAuthorizedFrames: transport.probe.repeated,
            distinctImmutableMessageIds: transport.probe.messageIds.size,
            socketOnlyFailure: true,
            replicaRestart: true,
            notificationPresentationsForStart: 1,
            postLogoutObservationMs: 3_000,
            staticFontFixture: 'existing retained Cairo/Inter assets; application services real',
            traces: false,
            videos: false,
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all([providerContext.close(), adminContext.close()]);
  }
});
