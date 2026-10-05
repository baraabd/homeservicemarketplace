import { expect, test, type Page } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

import { replica, type Replica } from './api-replicas';
import { seedLanguage } from './fixtures';
import { adminJar, apiAt, loginViaUi, REAL_API, type Jar } from './real-api';
import {
  applySession,
  leafCategoryId,
  registerSeeker,
  scheduledBooking,
  withDb,
  workingProvider,
} from './booking-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// R17-B — notification lifecycle through the real stack.
//
// docs/production-readiness/r17/R17_B_NOTIFICATIONS.md
//
// Notifications here are produced by real business actions (a bid, an
// accepted bid, a booking started) through the real API. Two API processes
// (replica A, replica B) share PostgreSQL and Redis, each serving its own copy
// of the built web app, as in R17-A. The default configuration has realtime
// OFF; the last test starts a separate pair with realtime ON, used only by a
// real Socket.IO client, to prove what reaches a device and what never does.
//
// Synthetic people only. No trace and no video: both would record cookies.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const WEB_A = process.env.E2E_REPLICA_A_WEB ?? '';
const WEB_B = process.env.E2E_REPLICA_B_WEB ?? '';
const cors = [WEB_A, WEB_B].filter(Boolean).join(',');
const A: Replica = replica('A', Number(process.env.E2E_REPLICA_A_PORT ?? 4011), {
  CORS_ORIGINS: cors,
});
const B: Replica = replica('B', Number(process.env.E2E_REPLICA_B_PORT ?? 4012), {
  CORS_ORIGINS: cors,
});
// Realtime ON, used only by the transport test; never by the browsers.
const C: Replica = replica('C', Number(process.env.E2E_REPLICA_C_PORT ?? 4013), {
  CORS_ORIGINS: cors,
  REALTIME_SOCKET_IO: 'true',
});
const D: Replica = replica('D', Number(process.env.E2E_REPLICA_D_PORT ?? 4014), {
  CORS_ORIGINS: cors,
  REALTIME_SOCKET_IO: 'true',
});

interface Row {
  id: string;
  type: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: Date | null;
}
const notificationsOf = (userId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<Row>(
      `SELECT id, type, title, body, "deepLink", "readAt" FROM "Notification"
        WHERE "userId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt", id`,
      [userId],
    );
    return rows;
  });
const userIdOf = (profileId: string) =>
  withDb(async (db) => {
    const { rows } = await db.query<{ userId: string }>(
      'SELECT "userId" FROM "ProviderProfile" WHERE id = $1',
      [profileId],
    );
    return rows[0].userId;
  });
const unreadOn = async (r: Replica, jar: Jar, experience: string) =>
  (
    await apiAt<{ count: number }>(
      r.url,
      jar,
      `/v1/me/notifications/unread-count?experience=${experience}`,
    )
  ).body.count;

/** Every API request a page makes, as `METHOD origin+path?query`. */
function recordApi(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith('/v1/'))
      seen.push(`${r.method()} ${url.origin}${url.pathname}${url.search}`);
  });
  return seen;
}

async function openSeekerBell(page: Page): Promise<void> {
  const bell = page.getByTestId('seeker-notifications-bell');
  // By keyboard: the bell is a real, named button.
  await bell.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('notification-drawer')).toHaveAttribute('aria-hidden', 'false');
  // The panel slides in; evidence is taken once it has settled, not mid-way.
  // Only transitions: the page also runs endless keyframe animations (pulses).
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .filter((a) => a.constructor.name === 'CSSTransition')
        .every((a) => a.playState !== 'running'),
    undefined,
    { timeout: 10_000 },
  );
}

test.describe('R17-B notifications — real API, PostgreSQL, Redis and two replicas', () => {
  test.skip(
    !REAL_API || !WEB_A || !WEB_B,
    'E2E_REAL_API, E2E_REPLICA_A_WEB and E2E_REPLICA_B_WEB are required for R17-B.',
  );
  test.describe.configure({ mode: 'serial', timeout: 420_000 });

  test.beforeAll(async () => {
    expect(REAL_API).toBe(A.url);
    await A.start();
    await B.start();
  });
  test.afterAll(async () => {
    await Promise.allSettled([A.stop(), B.stop(), C.stop(), D.stop()]);
  });

  test('produced by real actions, read by experience, read-all bounded to what was shown, across replicas', async ({
    page,
    context,
    browser,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17b');
    const provider = await workingProvider(categoryId, 'r17b');
    const providerUserId = await userIdOf(provider.profileId);
    const bookingId = await scheduledBooking(seeker, provider, categoryId);

    // ── 1. exactly the expected recipients and rows ─────────────────────────
    const seekerRows = await notificationsOf(seeker.userId);
    expect(seekerRows.map((r) => r.type)).toEqual(['BID_RECEIVED']);
    expect(seekerRows[0].deepLink).toMatch(/^\/home\/requests\//);
    expect((await notificationsOf(providerUserId)).map((r) => r.type).sort()).toEqual([
      'BID_ACCEPTED',
      'BOOKING_CREATED',
    ]);
    // Each row was announced through the outbox, by a replica's worker.
    await expect
      .poll(() =>
        withDb(async (db) => {
          const { rows } = await db.query<{ status: string }>(
            `SELECT e.status FROM "OutboxEvent" e JOIN "Notification" n ON n.id = e."aggregateId"
              WHERE n."userId" = ANY($1) AND e."eventType" = 'notification.created'`,
            [[seeker.userId, providerUserId]],
          );
          return rows.map((r) => r.status).sort();
        }),
      )
      .toEqual(['PROCESSED', 'PROCESSED', 'PROCESSED']);

    // ── 2. the seeker's inbox on web A: server count, seeker scope only ─────
    await page.setViewportSize({ width: 390, height: 844 });
    const calls = recordApi(page);
    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    await page.goto(`${WEB_A}/home`);
    await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 1 unread',
    );
    await openSeekerBell(page);
    const drawer = page.getByTestId('notification-drawer');
    await expect(drawer.getByText(seekerRows[0].body)).toBeVisible();
    for (const c of calls.filter((x) => x.includes('/v1/me/notifications'))) {
      expect(c).toContain(A.url);
      expect(c).toContain('experience=seeker');
    }
    await testInfo.attach('r17b-seeker-drawer-390.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // ── 3. a notification arrives (via replica B) while the drawer is open ──
    const started = await apiAt(B.url, provider.jar, `/v1/provider/bookings/${bookingId}/start`, {
      method: 'POST',
    });
    expect(started.status, JSON.stringify(started.body)).toBeLessThan(300);
    const arrived = (await notificationsOf(seeker.userId)).find(
      (r) => r.type === 'BOOKING_IN_PROGRESS',
    );
    expect(arrived?.readAt).toBeNull();
    // The open drawer has not re-read the list: it still shows only what it showed.
    await expect(drawer.getByText(arrived!.body)).toHaveCount(0);

    const readAll = page.waitForResponse(
      (r) =>
        r.url().startsWith(`${A.url}/v1/me/notifications/read-all`) &&
        r.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: 'Mark all read' }).click();
    const response = await readAll;
    expect(response.status()).toBe(200);
    expect(new URL(response.url()).searchParams.get('experience')).toBe('seeker');
    expect(response.request().postDataJSON()).toEqual({ ids: [seekerRows[0].id] });
    expect(await response.json()).toEqual({ updatedCount: 1 });
    const after = await notificationsOf(seeker.userId);
    expect(after.find((r) => r.id === seekerRows[0].id)?.readAt).not.toBeNull();
    expect(after.find((r) => r.id === arrived!.id)?.readAt).toBeNull();
    expect([
      await unreadOn(A, seeker.jar, 'seeker'),
      await unreadOn(B, seeker.jar, 'seeker'),
    ]).toEqual([1, 1]);
    await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 1 unread',
    );

    // ── 4. reload on the other replica; a restart changes nothing ──────────
    const onB = await context.newPage();
    await onB.goto(`${WEB_B}/home`);
    await expect(onB.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 1 unread',
    );
    await onB.close();
    await B.restart();
    expect(await unreadOn(B, seeker.jar, 'seeker')).toBe(1);
    expect((await notificationsOf(seeker.userId)).map((r) => r.type)).toEqual([
      'BID_RECEIVED',
      'BOOKING_IN_PROGRESS',
    ]);

    // ── 5. the provider: provider rows in the provider app, none in the seeker app
    const providerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      await applySession(providerCtx, provider.jar);
      const asSeekerApp = await providerCtx.newPage();
      await seedLanguage(asSeekerApp, 'en');
      await asSeekerApp.goto(`${WEB_A}/home`);
      await expect(asSeekerApp.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
        'Open notifications, 0 unread',
      );
      const providerRows = await notificationsOf(providerUserId);
      for (const r of providerRows) {
        await expect(asSeekerApp.getByTestId('notification-drawer').getByText(r.body)).toHaveCount(
          0,
        );
      }
      const asProviderApp = await providerCtx.newPage();
      await seedLanguage(asProviderApp, 'en');
      // The top bar (and its bell) is hidden on the full-screen job map.
      await asProviderApp.goto(`${WEB_B}/provider/bids`);
      await expect(
        asProviderApp.getByRole('button', { name: 'Open notifications, 2 unread' }),
      ).toBeVisible();
    } finally {
      await providerCtx.close();
    }

    // ── 6. another user's notification is not theirs to read ───────────────
    const foreign = await apiAt(B.url, provider.jar, `/v1/me/notifications/${arrived!.id}/read`, {
      method: 'POST',
    });
    expect(foreign.status).toBe(404);
    const foreignAll = await apiAt<{ updatedCount: number }>(
      B.url,
      provider.jar,
      '/v1/me/notifications/read-all?experience=seeker',
      { method: 'POST', body: { ids: [arrived!.id] } },
    );
    expect(foreignAll.body).toEqual({ updatedCount: 0 });
    expect(
      (await apiAt(B.url, seeker.jar, '/v1/me/notifications/read-all', { method: 'POST' })).status,
    ).toBe(400);
    expect(
      (await notificationsOf(seeker.userId)).find((r) => r.id === arrived!.id)?.readAt,
    ).toBeNull();

    // ── 7. account switch in the same browser: nothing of the seeker survives
    await page.goto(`${WEB_A}/home/profile`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Sign Out' }).first().click();
    const loggedOut = page.waitForResponse(
      (r) => r.url() === `${A.url}/v1/auth/logout` && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign Out' }).last().click();
    const out = await loggedOut;
    expect(out.status(), await out.text()).toBe(204);
    await page.waitForURL(/\/(login|select)/);
    await page.goto(`${WEB_A}/login`);
    const verified = page.waitForResponse(
      (r) => r.url() === `${A.url}/v1/auth/verify-otp` && r.request().method() === 'POST',
    );
    await loginViaUi(page, provider);
    expect((await verified).status()).toBe(200);
    // Let the app finish confirming the new session before leaving the page.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(`${WEB_A}/home`);
    await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
      'Open notifications, 0 unread',
    );
    for (const r of await notificationsOf(seeker.userId)) {
      await expect(page.getByText(r.body)).toHaveCount(0);
    }
  });

  test('a list that cannot be read says so, and recovers (fault injected on a real response)', async ({
    page,
    context,
  }) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17bf');
    const provider = await workingProvider(categoryId, 'r17bf');
    await scheduledBooking(seeker, provider, categoryId);
    const [row] = await notificationsOf(seeker.userId);

    await applySession(context, seeker.jar);
    await seedLanguage(page, 'en');
    // Fault injection, labelled: the first list read is aborted on the wire.
    let aborted = false;
    await page.route(`${A.url}/v1/me/notifications?**`, async (route) => {
      if (!aborted) {
        aborted = true;
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });
    await page.goto(`${WEB_A}/home`);
    await openSeekerBell(page);
    const drawer = page.getByTestId('notification-drawer');
    await expect(drawer.getByTestId('notification-drawer-state')).toHaveAttribute(
      'data-state',
      'error',
    );
    await expect(drawer.getByText('Couldn’t load notifications.')).toBeVisible();
    await expect(drawer.getByText('No notifications yet')).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Try again' }).click();
    await expect(drawer.getByText(row.body)).toBeVisible();
  });

  test('Arabic, right-to-left, at 360, 390 and 430, by keyboard', async ({
    page,
    context,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17ba');
    const provider = await workingProvider(categoryId, 'r17ba');
    await scheduledBooking(seeker, provider, categoryId);

    await applySession(context, seeker.jar);
    await seedLanguage(page, 'ar');
    for (const width of [360, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${WEB_A}/home`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('seeker-notifications-bell')).toHaveAccessibleName(
        'فتح الإشعارات، 1 غير مقروءة',
      );
      await openSeekerBell(page);
      const drawer = page.getByTestId('notification-drawer');
      await expect(drawer.getByText('الإشعارات', { exact: true })).toBeInViewport();
      await expect(drawer.getByRole('button', { name: 'تعليم الكل كمقروء' })).toBeVisible();
      await expect(drawer.getByRole('button', { name: 'إغلاق' })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      // The arrival toast (Arabic copy) must sit wholly on screen.
      const toasts = page.locator('[data-sonner-toast]');
      await expect(toasts.first()).toBeVisible();
      for (const box of await toasts.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right };
        }),
      )) {
        expect(box.left, `toast left edge at ${width}px`).toBeGreaterThanOrEqual(0);
        expect(box.right, `toast right edge at ${width}px`).toBeLessThanOrEqual(width);
      }
      await testInfo.attach(`r17b-drawer-ar-${width}.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    }
  });

  test('the admin bell shows the server count and an honest empty inbox', async ({
    page,
    context,
  }) => {
    const jar = await adminJar();
    const me = await apiAt<{ id: string }>(A.url, jar, '/v1/auth/me');
    const adminRows = await withDb(async (db) => {
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM "Notification"
          WHERE "userId" = $1 AND "deletedAt" IS NULL AND "readAt" IS NULL AND "deepLink" LIKE '/admin/%'`,
        [me.body.id],
      );
      return Number(rows[0].n);
    });
    expect(await unreadOn(A, jar, 'admin')).toBe(adminRows);
    await applySession(context, jar);
    await seedLanguage(page, 'en');
    await page.goto(`${WEB_A}/admin`);
    const bell = page.getByRole('button', { name: 'Admin notifications' });
    await expect(bell).toBeVisible();
    if (adminRows === 0) {
      await expect(bell.locator('span')).toHaveCount(0);
      await bell.click();
      await expect(page.getByText('No notifications yet.')).toBeVisible();
    } else {
      await expect(bell).toContainText(adminRows > 99 ? '99+' : String(adminRows));
    }
  });

  test('with realtime on: a rolled-back action is never announced; a committed one is, once, across replicas', async () => {
    // Every API process runs an outbox worker, and whichever claims an
    // announcement publishes it through its OWN gateway. A deployed fleet
    // shares one configuration; this test must too, so the realtime-off
    // replicas stop first and only the realtime-on pair (C, D) dispatches.
    // (In CI the job's own API on 4010 is stopped before this spec runs.)
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('r17bt');
    const provider = await workingProvider(categoryId, 'r17bt');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    // The fixtures above go through replica A; its announcements are done
    // (or will be by whoever claims them) and are not asserted below.
    await Promise.all([A.stop(), B.stop()]);
    await C.start();
    await D.start();

    // A real Socket.IO client, connected to replica D with the seeker's session.
    const cookie = [...seeker.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const socket: Socket = io(D.url, {
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
    });
    const received: Array<{ type: string; actorUserId: string | null; payload: { id: string } }> =
      [];
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connection.ack', () => resolve());
        socket.once('connect_error', (e) => reject(e));
      });
      socket.on('realtime.event', (e) => {
        if (e?.type === 'notification.created') received.push(e);
      });

      // The provider's start is made to fail AFTER the seeker's notification
      // row has been written in its transaction: the next statement — the
      // announcement event for that row — is rejected (test-only trigger,
      // removed in finally). The whole transaction must roll back, and no
      // device may hear about it.
      //
      // Not a commit-time failure on purpose: on this Prisma version a failure
      // raised AT COMMIT is logged and the transaction promise still resolves,
      // so the API would report success for a rolled-back action. That is a
      // separate platform defect (GAP_REGISTER PLATFORM-TX-1), not R17-B's.
      await withDb(async (db) => {
        await db.query(`CREATE OR REPLACE FUNCTION r17b_fail_after_row() RETURNS trigger AS $$
          BEGIN
            IF NEW."eventType" = 'notification.created' AND EXISTS (
              SELECT 1 FROM "Notification"
               WHERE id = NEW."aggregateId" AND "userId" = '${seeker.userId}'
                 AND type = 'BOOKING_IN_PROGRESS') THEN
              RAISE EXCEPTION 'r17b: rejected after the notification row';
            END IF;
            RETURN NEW;
          END $$ LANGUAGE plpgsql`);
        await db.query(`DROP TRIGGER IF EXISTS r17b_fail_after_row ON "OutboxEvent"`);
        await db.query(`CREATE TRIGGER r17b_fail_after_row BEFORE INSERT ON "OutboxEvent"
          FOR EACH ROW EXECUTE FUNCTION r17b_fail_after_row()`);
      });
      let failed;
      try {
        failed = await apiAt(C.url, provider.jar, `/v1/provider/bookings/${bookingId}/start`, {
          method: 'POST',
        });
      } finally {
        await withDb(async (db) => {
          await db.query(`DROP TRIGGER IF EXISTS r17b_fail_after_row ON "OutboxEvent"`);
          await db.query(`DROP FUNCTION IF EXISTS r17b_fail_after_row()`);
        });
      }
      expect(failed.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(failed.body)).not.toContain('r17b');
      expect((await notificationsOf(seeker.userId)).map((r) => r.type)).toEqual(['BID_RECEIVED']);
      const status = await withDb(async (db) => {
        const { rows } = await db.query<{ status: string }>(
          'SELECT status FROM "Booking" WHERE id = $1',
          [bookingId],
        );
        return rows[0].status;
      });
      expect(status).toBe('SCHEDULED');

      // Now the same action commits, through replica C; the seeker's socket is
      // on replica D. Its arrival also bounds the window in which a rolled-back
      // announcement could have appeared: events are dispatched in order.
      const ok = await apiAt(C.url, provider.jar, `/v1/provider/bookings/${bookingId}/start`, {
        method: 'POST',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
      const committed = (await notificationsOf(seeker.userId)).find(
        (r) => r.type === 'BOOKING_IN_PROGRESS',
      );
      await expect.poll(() => received.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
      expect(received.map((e) => e.payload.id)).toEqual([committed!.id]);
      expect(received[0].actorUserId).toBe(await userIdOf(provider.profileId));
    } finally {
      socket.close();
    }
  });
});
