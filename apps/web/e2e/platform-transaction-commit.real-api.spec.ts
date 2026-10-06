import { expect, test } from '@playwright/test';

import { replica, type Replica } from './api-replicas';
import { seedLanguage } from './fixtures';
import { REAL_API } from './real-api';
import {
  applySession,
  leafCategoryId,
  registerSeeker,
  scheduledBooking,
  withDb,
  workingProvider,
} from './booking-fixtures';

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM-TX-1 — a booking start whose COMMIT is rejected, through the real
// stack: built API process, real login session, real browser, PostgreSQL.
//
// docs/production-readiness/platform/TRANSACTION_COMMIT_AUTHORITY.md
//
// The provider presses Start Job. A test-only deferred constraint trigger on
// "BookingEvent" (created here, dropped in finally; never in a migration)
// rejects that booking's transaction at COMMIT, after every statement of the
// start succeeded. The API must not answer success, nothing of the start may
// be stored, and the screen must not show a started job. Then the trigger is
// removed and the same button starts the job for real.
//
// Synthetic people only. No trace and no video.
// ─────────────────────────────────────────────────────────────────────────────

test.use({ trace: 'off', video: 'off' });

const WEB_A = process.env.E2E_REPLICA_A_WEB ?? '';
const A: Replica = replica('A', Number(process.env.E2E_REPLICA_A_PORT ?? 4011), {
  CORS_ORIGINS: WEB_A,
});

const bookingState = (bookingId: string, actorUserId: string) =>
  withDb(async (db) => {
    const status = (
      await db.query<{ status: string }>('SELECT status FROM "Booking" WHERE id = $1', [bookingId])
    ).rows[0].status;
    const events = (
      await db.query<{ type: string }>(
        `SELECT type FROM "BookingEvent" WHERE "bookingId" = $1 ORDER BY "createdAt"`,
        [bookingId],
      )
    ).rows.map((r) => r.type);
    const notices = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM "Notification"
          WHERE type = 'BOOKING_IN_PROGRESS' AND "resourceId" = $1`,
        [bookingId],
      )
    ).rows[0].n;
    const announcements = (
      await db.query<{ n: number }>(
        // Scoped to this test's own (fresh, synthetic) provider as the actor:
        // other suites share the table.
        `SELECT count(*)::int AS n FROM "OutboxEvent" e
          WHERE e."eventType" = 'notification.created'
            AND e.payload->>'actorUserId' = $1
            AND NOT EXISTS (SELECT 1 FROM "Notification" x WHERE x.id = e."aggregateId")`,
        [actorUserId],
      )
    ).rows[0].n;
    return { status, events, notices, orphanAnnouncements: announcements };
  });

test.describe('PLATFORM-TX-1 — a rejected COMMIT through the real stack', () => {
  test.skip(
    !REAL_API || !WEB_A,
    'E2E_REAL_API and E2E_REPLICA_A_WEB are required for PLATFORM-TX-1 acceptance.',
  );
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    // Longer than the replica's own 90 s health deadline, so a slow or failed
    // boot reports the API's output instead of a bare hook timeout.
    test.setTimeout(120_000);
    expect(REAL_API).toBe(A.url);
    await A.start();
  });
  test.afterAll(async () => {
    await A.stop();
  });

  test('Start Job whose commit is rejected is not reported, stored or shown as started', async ({
    page,
    context,
  }, testInfo) => {
    const categoryId = await leafCategoryId();
    const seeker = await registerSeeker('ptx');
    const provider = await workingProvider(categoryId, 'ptx');
    const bookingId = await scheduledBooking(seeker, provider, categoryId);
    const before = await bookingState(bookingId, provider.userId);
    expect(before.status).toBe('SCHEDULED');

    await page.setViewportSize({ width: 390, height: 844 });
    await applySession(context, provider.jar);
    await seedLanguage(page, 'en');
    await page.goto(`${WEB_A}/provider/bids`);
    const start = page.getByRole('button', { name: 'Start Job', exact: true });
    await expect(start).toBeVisible();

    await withDb(async (db) => {
      await db.query(`CREATE OR REPLACE FUNCTION ptx_reject_start() RETURNS trigger AS $$
        BEGIN
          IF NEW."bookingId" = '${bookingId}' THEN
            RAISE EXCEPTION 'ptx: start rejected at commit' USING ERRCODE = 'P0001';
          END IF;
          RETURN NULL;
        END $$ LANGUAGE plpgsql`);
      await db.query('DROP TRIGGER IF EXISTS ptx_reject_start ON "BookingEvent"');
      await db.query(`CREATE CONSTRAINT TRIGGER ptx_reject_start AFTER INSERT ON "BookingEvent"
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ptx_reject_start()`);
    });
    try {
      const rejected = page.waitForResponse(
        (r) =>
          r.url() === `${A.url}/v1/provider/bookings/${bookingId}/start` &&
          r.request().method() === 'POST',
      );
      await start.click();
      const response = await rejected;
      const body = await response.text();
      // Not a success, and no database detail on the wire.
      expect(response.status(), body).toBeGreaterThanOrEqual(500);
      expect(body).not.toMatch(/ptx|trigger|BookingEvent|P0001|prisma/i);
    } finally {
      await withDb(async (db) => {
        await db.query('DROP TRIGGER IF EXISTS ptx_reject_start ON "BookingEvent"');
        await db.query('DROP FUNCTION IF EXISTS ptx_reject_start()');
      });
    }

    // Nothing of the start survived: status, history, notice, announcement.
    expect(await bookingState(bookingId, provider.userId)).toEqual(before);
    // The screen does not claim a started job, before or after a reload.
    await expect(page.getByRole('button', { name: 'Mark Complete', exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Start Job', exact: true })).toBeVisible();
    await testInfo.attach('ptx-start-rejected-390.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The same action, once the database accepts it, commits once.
    const accepted = page.waitForResponse(
      (r) =>
        r.url() === `${A.url}/v1/provider/bookings/${bookingId}/start` &&
        r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Start Job', exact: true }).click();
    expect((await accepted).status()).toBeLessThan(300);
    const after = await bookingState(bookingId, provider.userId);
    expect(after.status).toBe('IN_PROGRESS');
    expect(after.notices).toBe(1);
    expect(after.orphanAnnouncements).toBe(0);
    await expect(page.getByRole('button', { name: 'Mark Complete', exact: true })).toBeVisible();
  });
});
