/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy Prisma requires: with RUN_DB_INTEGRATION unset this spec is skipped, and
 * a top-level import would still open the client's pool on every hermetic run.
 * `any` on the Prisma and service handles for the same reason.
 */

export {};

import { randomUUID } from 'node:crypto';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';
import { makeTestSecret } from '../support/test-secrets';

// R07 — races, crash recovery and the whole request -> booking path, against
// real Postgres, the real services and the real outbox worker and handlers.
//
// Complements r07-request-provider-lifecycle.integration.spec.ts, which proves
// each rule once. This suite is about ORDER and REPETITION.
//
// Each block states one rule of the marketplace path and proves it at the
// database. The rules that are about ORDER (a bid racing an acceptance, two
// submissions of one request, a worker that died after the commit) cannot be
// shown by a fake: they depend on what Postgres does with two transactions.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

d('R07 — marketplace races and delivery recovery (real Postgres, real outbox worker)', () => {
  let prisma: any;
  let requests: any;
  let providerBids: any;
  let seekerBids: any;
  let feed: any;
  let seekerBookings: any;
  let providerBookings: any;
  let makeWorker: (over?: { failBatchTimes?: number }) => { runOnce: () => Promise<number> };

  const P = fixturePrefix('r07-races');
  const SEEKER = `${P}seeker`;
  const OTHER_SEEKER = `${P}other-seeker`;
  const CATEGORY = `${P}category`;
  const OTHER_CATEGORY = `${P}other-category`;
  // Provider fixtures: user id and profile id.
  const ELIGIBLE = { user: `${P}eligible-user`, profile: `${P}eligible` };
  const ELIGIBLE_2 = { user: `${P}eligible2-user`, profile: `${P}eligible2` };
  const WRONG_CATEGORY = { user: `${P}wrongcat-user`, profile: `${P}wrongcat` };
  const WRONG_CITY = { user: `${P}wrongcity-user`, profile: `${P}wrongcity` };
  // The seeker also holds a provider profile that would otherwise match.
  const SELF = { user: SEEKER, profile: `${P}self` };
  const PROVIDERS = [ELIGIBLE, ELIGIBLE_2, WRONG_CATEGORY, WRONG_CITY, SELF];
  const USERS = [
    SEEKER,
    OTHER_SEEKER,
    ELIGIBLE.user,
    ELIGIBLE_2.user,
    WRONG_CATEGORY.user,
    WRONG_CITY.user,
  ];

  let locks: HeldLock | undefined;

  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const body = (extra: Record<string, unknown> = {}) => ({
    categoryId: CATEGORY,
    customServiceText: null,
    description: 'R07 private description',
    scheduleType: 'ASAP',
    scheduledAt: null,
    manualAddress: { line1: '1 Test Street', city: 'Aleppo', country: 'SY' },
    ...extra,
  });
  const bid = (requestId: string, amount = 10_000) => ({
    requestId,
    amount,
    pricingType: 'FIXED',
  });

  const requestsOf = (userId: string) =>
    prisma.serviceRequest.findMany({ where: { seekerUserId: userId } });
  const requestRow = (id: string) => prisma.serviceRequest.findUnique({ where: { id } });
  const bidsOn = (requestId: string) =>
    prisma.bid.findMany({ where: { requestId }, orderBy: { submittedAt: 'asc' } });
  const announcements = (userId: string, requestId: string) =>
    prisma.notification.count({
      where: { userId, type: 'REQUEST_AVAILABLE', resourceId: requestId },
    });
  const outboxFor = (requestId: string) =>
    prisma.outboxEvent.findMany({
      where: { aggregateType: 'ServiceRequest', aggregateId: requestId },
      orderBy: { createdAt: 'asc' },
    });

  /** Run fresh worker instances until the queue is empty: a restart, every time. */
  async function drain(over?: { failBatchTimes?: number }): Promise<void> {
    const worker = makeWorker(over);
    for (let i = 0; i < 20; i += 1) {
      const claimed = await worker.runOnce();
      if (claimed === 0) {
        const due = await prisma.outboxEvent.count({ where: { status: 'PENDING' } });
        if (due === 0) return;
        // A failed attempt was rescheduled a few milliseconds ahead.
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error('outbox did not drain');
  }

  async function wipe(): Promise<void> {
    const owned = await prisma.serviceRequest.findMany({
      where: { seekerUserId: { in: USERS } },
      select: { id: true },
    });
    const ids = owned.map((r: { id: string }) => r.id);
    await prisma.outboxHandlerRun
      .deleteMany({
        where: { event: { aggregateType: 'ServiceRequest', aggregateId: { in: ids } } },
      })
      .catch(() => undefined);
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: 'ServiceRequest', aggregateId: { in: ids } },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.booking.deleteMany({ where: { seekerUserId: { in: USERS } } });
    await prisma.bid.deleteMany({ where: { requestId: { in: ids } } });
    await prisma.serviceRequest.deleteMany({ where: { id: { in: ids } } });
    await prisma.providerProfile.deleteMany({
      where: { id: { in: PROVIDERS.map((p) => p.profile) } },
    });
    await prisma.serviceCategory.deleteMany({
      where: { id: { in: [CATEGORY, OTHER_CATEGORY] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    // EXCLUSIVE on the outbox: this suite RUNS the worker, which claims
    // whatever is pending and would otherwise deliver other suites' events.
    locks = await acquireAdvisoryLocks([
      { resource: 'providerLifecycle' as const, mode: 'shared' as const },
      { resource: 'outbox' as const, mode: 'exclusive' as const },
      { resource: 'serviceRequests' as const, mode: 'shared' as const },
    ]);

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma };

    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      AddressRepository,
    } = require('../../src/infrastructure/persistence/addresses/address.repository');
    const {
      ServiceCategoryRepository,
    } = require('../../src/infrastructure/persistence/services/service-category.repository');
    const {
      ServiceRequestRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request.repository');
    const {
      ServiceRequestEventRepository,
    } = require('../../src/infrastructure/persistence/requests/service-request-event.repository');
    const {
      ProviderProfileRepository,
    } = require('../../src/infrastructure/persistence/bids/provider-profile.repository');
    const { BidRepository } = require('../../src/infrastructure/persistence/bids/bid.repository');
    const {
      BookingRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking.repository');
    const {
      BookingEventRepository,
    } = require('../../src/infrastructure/persistence/bookings/booking-event.repository');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    const { OutboxWorker } = require('../../src/infrastructure/outbox/outbox.worker');
    const { RequestsService } = require('../../src/modules/requests/requests.service');
    const { RequestMediaService } = require('../../src/modules/media/request-media.service');
    const {
      RequestAvailableBatchHandler,
      RequestAvailableDispatchHandler,
    } = require('../../src/modules/requests/outbox/request-available.handler');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const { BidsService } = require('../../src/modules/bids/bids.service');
    const {
      ProviderBidsService,
    } = require('../../src/modules/provider/bids/provider-bids.service');
    const {
      AvailableRequestsService,
    } = require('../../src/modules/provider/available-requests/available-requests.service');
    const { BookingsService } = require('../../src/modules/bookings/bookings.service');
    const {
      ProviderBookingsService,
    } = require('../../src/modules/provider/bookings/provider-bookings.service');

    // Realtime is a best-effort side channel; it is not what is under test.
    const realtime = new Proxy({}, { get: () => () => undefined });
    const throwingStorage = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('R07 cases must not touch attachment storage');
        },
      },
    );
    const settings: Record<string, unknown> = {
      JWT_ACCESS_SECRET: makeTestSecret('r07-marketplace-races'),
      OUTBOX_WORKER_ENABLED: false,
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_POLL_INTERVAL_MS: 1_000,
      OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
      // Milliseconds, so a deliberately failed attempt is due again at once.
      OUTBOX_RETRY_BASE_MS: 1,
      OUTBOX_RETRY_CAP_MS: 5,
      OUTBOX_RETENTION_HOURS: 72,
      OUTBOX_CLEANUP_INTERVAL_MS: 3_600_000,
      OUTBOX_FANOUT_BATCH_SIZE: 200,
    };
    const config = { get: (k: string) => settings[k] };
    const metrics = () => {
      const noop = { inc: jest.fn(), set: jest.fn(), reset: jest.fn() };
      return {
        outboxEventsProcessedTotal: { inc: jest.fn() },
        outboxEventDurationSeconds: { startTimer: jest.fn(() => jest.fn()) },
        outboxQueueDepth: noop,
        outboxOldestPendingAgeSeconds: noop,
        outboxClaimedTotal: { inc: jest.fn() },
        outboxReclaimedTotal: { inc: jest.fn() },
      };
    };

    const tx = new TransactionRunner(prismaSvc);
    const requestRepo = new ServiceRequestRepository(prismaSvc);
    const requestEvents = new ServiceRequestEventRepository(prismaSvc);
    const providerRepo = new ProviderProfileRepository(prismaSvc);
    const bidRepo = new BidRepository(prismaSvc);
    const bookingRepo = new BookingRepository(prismaSvc);
    const bookingEvents = new BookingEventRepository(prismaSvc);
    const categoryRepo = new ServiceCategoryRepository(prismaSvc);
    const notificationRepo = new NotificationRepository(prismaSvc);
    const outbox = new OutboxRepository(prismaSvc);
    const notifications = new NotificationsService(notificationRepo, realtime);

    requests = new RequestsService(
      requestRepo,
      requestEvents,
      new AddressRepository(prismaSvc),
      categoryRepo,
      tx,
      outbox,
      new RequestMediaService(prismaSvc, config, throwingStorage),
    );
    providerBids = new ProviderBidsService(
      providerRepo,
      bidRepo,
      requestRepo,
      requestEvents,
      notifications,
      tx,
    );
    seekerBids = new BidsService(
      bidRepo,
      requestRepo,
      bookingRepo,
      requestEvents,
      bookingEvents,
      notifications,
      tx,
      realtime,
    );
    feed = new AvailableRequestsService(providerRepo, requestRepo, bidRepo, categoryRepo);
    seekerBookings = new BookingsService(bookingRepo, bookingEvents, notifications, tx, realtime);
    providerBookings = new ProviderBookingsService(
      providerRepo,
      bookingRepo,
      bookingEvents,
      notifications,
      tx,
      realtime,
    );

    makeWorker = (over = {}) => {
      let failures = over.failBatchTimes ?? 0;
      const dispatch = new RequestAvailableDispatchHandler(
        providerRepo,
        outbox,
        config,
        requestRepo,
      );
      const realBatch = new RequestAvailableBatchHandler(notificationRepo, realtime, requestRepo);
      const batch = {
        name: realBatch.name,
        eventTypes: realBatch.eventTypes,
        async handle(event: unknown, handlerTx: unknown) {
          const result = await realBatch.handle(event, handlerTx);
          if (failures > 0) {
            failures -= 1;
            // After the notifications were written in this transaction: the
            // worst moment to fail, because the work looks done.
            throw new Error('simulated worker crash mid-delivery');
          }
          return result;
        },
      };
      return new OutboxWorker(outbox, prismaSvc, config, metrics(), [dispatch, batch]);
    };

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r07-races.invalid`,
          passwordHash: 'x',
          firstName: 'R07',
          lastName: 'Fixture',
        },
      });
    }
    for (const [id, label] of [
      [CATEGORY, 'R07 category'],
      [OTHER_CATEGORY, 'R07 other category'],
    ]) {
      await prisma.serviceCategory.create({
        data: {
          id,
          slug: id,
          labelEn: label,
          labelAr: label,
          icon: 'wrench',
          isActive: true,
          isLeaf: true,
        },
      });
    }
    const profile = (p: { user: string; profile: string }, category: string, city: string) =>
      prisma.providerProfile.create({
        data: {
          id: p.profile,
          userId: p.user,
          displayName: `R07 ${p.profile}`,
          initials: 'R7',
          status: 'ACTIVE',
          serviceAreaCity: city,
          serviceAreaCityKey: city.toLowerCase(),
          serviceCategories: { create: [{ serviceCategoryId: category }] },
        },
      });
    await profile(ELIGIBLE, CATEGORY, 'Aleppo');
    await profile(ELIGIBLE_2, CATEGORY, 'Aleppo');
    await profile(WRONG_CATEGORY, OTHER_CATEGORY, 'Aleppo');
    await profile(WRONG_CITY, CATEGORY, 'Damascus');
    await profile(SELF, CATEGORY, 'Aleppo');
  });

  afterAll(async () => {
    if (prisma) await wipe();
    await locks?.release();
  });

  // ── schedules ───────────────────────────────────────────────────────────

  describe('schedule validation', () => {
    it('refuses a request scheduled in the past, and creates nothing', async () => {
      const before = (await requestsOf(SEEKER)).length;
      for (const scheduledAt of [
        inHours(-24),
        inHours(-1),
        new Date(Date.now() - 600_000).toISOString(),
      ]) {
        await expect(
          requests.create(SEEKER, body({ scheduleType: 'LATER', scheduledAt })),
        ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      }
      expect((await requestsOf(SEEKER)).length).toBe(before);
    });

    it('accepts a future schedule and an ASAP request', async () => {
      const later = await requests.create(
        SEEKER,
        body({ scheduleType: 'LATER', scheduledAt: inHours(48) }),
      );
      expect(later.scheduleType).toBe('LATER');
      const asap = await requests.create(SEEKER, body());
      expect(asap.scheduledAt).toBeNull();
    });

    it('refuses moving an open request into the past, and leaves it unchanged', async () => {
      const created = await requests.create(
        SEEKER,
        body({ scheduleType: 'LATER', scheduledAt: inHours(48) }),
      );
      await expect(
        requests.update(SEEKER, created.id, { scheduledAt: inHours(-2) }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      const stored = await requestRow(created.id);
      expect(stored.scheduledAt.toISOString()).toBe(created.scheduledAt);
    });
  });

  // ── repeated submission ─────────────────────────────────────────────────

  describe('repeated submission', () => {
    it('a repeated submission with the same key returns the first request', async () => {
      const idempotencyKey = randomUUID();
      const first = await requests.create(SEEKER, body({ idempotencyKey }));
      const again = await requests.create(SEEKER, body({ idempotencyKey }));

      expect(again.id).toBe(first.id);
      const rows = await prisma.serviceRequest.findMany({
        where: { seekerUserId: SEEKER, idempotencyKey },
      });
      expect(rows).toHaveLength(1);
      // One announcement owed, not two.
      const events = (await outboxFor(first.id)).filter(
        (e: any) => e.eventType === 'request.available',
      );
      expect(events).toHaveLength(1);
      const timeline = await prisma.serviceRequestEvent.count({
        where: { requestId: first.id, type: 'REQUEST_CREATED' },
      });
      expect(timeline).toBe(1);
    });

    it('concurrent submissions with one key create exactly one request', async () => {
      const idempotencyKey = randomUUID();
      const attempts = await Promise.allSettled(
        Array.from({ length: 6 }, () => requests.create(SEEKER, body({ idempotencyKey }))),
      );
      // Every caller gets an answer, and it is the same request.
      const ids = attempts.map((a) =>
        a.status === 'fulfilled' ? a.value.id : `rejected:${a.reason}`,
      );
      expect(new Set(ids).size).toBe(1);
      expect(ids[0]).not.toMatch(/^rejected/);
      expect(
        await prisma.serviceRequest.count({ where: { seekerUserId: SEEKER, idempotencyKey } }),
      ).toBe(1);
    });

    it('the key is scoped to the seeker', async () => {
      const idempotencyKey = randomUUID();
      const mine = await requests.create(SEEKER, body({ idempotencyKey }));
      const theirs = await requests.create(OTHER_SEEKER, body({ idempotencyKey }));
      expect(theirs.id).not.toBe(mine.id);
      // Another seeker's key never returns this seeker's request.
      expect((await requestRow(theirs.id)).seekerUserId).toBe(OTHER_SEEKER);
    });

    it('without a key, two submissions are two requests', async () => {
      // The documented policy: only a client-supplied key makes a retry safe.
      const one = await requests.create(SEEKER, body());
      const two = await requests.create(SEEKER, body());
      expect(two.id).not.toBe(one.id);
    });
  });

  // ── who may see and bid ─────────────────────────────────────────────────

  describe('matching is one rule for the feed, the detail and the bid', () => {
    let requestId: string;

    beforeAll(async () => {
      requestId = (await requests.create(SEEKER, body())).id;
    });

    it('an eligible provider sees the request in the feed and can open it', async () => {
      const listed = await feed.list(ELIGIBLE.user, {});
      expect(listed.items.map((i: any) => i.id)).toContain(requestId);
      await expect(feed.detail(ELIGIBLE.user, requestId)).resolves.toMatchObject({
        id: requestId,
      });
    });

    it.each([
      ['in another category', WRONG_CATEGORY],
      ['in another city', WRONG_CITY],
      ['who is the seeker', SELF],
    ])('a provider %s cannot see it, open it, or bid on it', async (_label, provider) => {
      const listed = await feed.list(provider.user, {});
      expect(listed.items.map((i: any) => i.id)).not.toContain(requestId);
      await expect(feed.detail(provider.user, requestId)).rejects.toMatchObject({ status: 404 });

      // The bid must be refused by the SAME rule. A provider who cannot open a
      // request must not be able to bid on it by knowing its id — and must not
      // receive its description in a bid response.
      const attempt = await providerBids.submit(provider.user, bid(requestId)).catch((e: any) => e);
      expect(attempt).toMatchObject({
        code: expect.stringMatching(/NOT_FOUND|VALIDATION_ERROR/),
      });
      expect(JSON.stringify(attempt)).not.toContain('R07 private description');
      expect(await prisma.bid.count({ where: { requestId, providerId: provider.profile } })).toBe(
        0,
      );
    });

    it('an unknown request and an invisible one are refused identically', async () => {
      const invisible = await providerBids
        .submit(WRONG_CATEGORY.user, bid(requestId))
        .catch((e: any) => e);
      const unknown = await providerBids
        .submit(WRONG_CATEGORY.user, bid('no-such-request'))
        .catch((e: any) => e);
      expect({
        code: invisible.code,
        status: invisible.status,
        message: invisible.message,
      }).toEqual({
        code: unknown.code,
        status: unknown.status,
        message: unknown.message,
      });
    });

    it('an eligible provider bids once; a second active bid is refused', async () => {
      const first = await providerBids.submit(ELIGIBLE.user, bid(requestId));
      expect(first.bid.status).toBe('PENDING');
      await expect(providerBids.submit(ELIGIBLE.user, bid(requestId))).rejects.toMatchObject({
        status: 409,
      });
      expect(await prisma.bid.count({ where: { requestId, providerId: ELIGIBLE.profile } })).toBe(
        1,
      );
    });
  });

  // ── delivery ────────────────────────────────────────────────────────────

  describe('delivery survives a crash and never duplicates', () => {
    it('a request committed with no worker running is still delivered, once', async () => {
      const created = await requests.create(SEEKER, body());
      // The process "died" here: the request and its event are committed and
      // nothing has been delivered.
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(0);
      const [owed] = await outboxFor(created.id);
      expect(owed).toMatchObject({ eventType: 'request.available', status: 'PENDING' });

      await drain();

      expect(await announcements(ELIGIBLE.user, created.id)).toBe(1);
      expect(await announcements(ELIGIBLE_2.user, created.id)).toBe(1);
      // Not the ineligible, and never the seeker — as a seeker or as a provider.
      expect(await announcements(WRONG_CATEGORY.user, created.id)).toBe(0);
      expect(await announcements(WRONG_CITY.user, created.id)).toBe(0);
      expect(await announcements(SEEKER, created.id)).toBe(0);

      // A restarted worker finds nothing left to do and repeats nothing.
      await drain();
      await drain();
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(1);
      expect((await outboxFor(created.id)).every((e: any) => e.status === 'PROCESSED')).toBe(true);
    });

    it('a worker that fails mid-delivery leaves no partial delivery, and the retry delivers once', async () => {
      const created = await requests.create(SEEKER, body());
      const worker = makeWorker({ failBatchTimes: 1 });
      await worker.runOnce(); // dispatch: fan out into a batch
      await worker.runOnce(); // batch: writes notifications, then throws

      // The failed attempt rolled its notifications back.
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(0);

      await drain();
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(1);
      expect(await announcements(ELIGIBLE_2.user, created.id)).toBe(1);
    });

    it('two workers running at once deliver once', async () => {
      const created = await requests.create(SEEKER, body());
      for (let round = 0; round < 4; round += 1) {
        await Promise.all([makeWorker().runOnce(), makeWorker().runOnce(), makeWorker().runOnce()]);
      }
      await drain();
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(1);
      expect(await announcements(ELIGIBLE_2.user, created.id)).toBe(1);
    });

    it('a request cancelled before delivery is not announced', async () => {
      const created = await requests.create(SEEKER, body());
      await requests.cancel(SEEKER, created.id);

      await drain();

      // Announcing it would send providers to a request they cannot open.
      expect(await announcements(ELIGIBLE.user, created.id)).toBe(0);
      expect(await announcements(ELIGIBLE_2.user, created.id)).toBe(0);
      // The event is settled, not stuck: nothing retries for ever.
      expect((await outboxFor(created.id)).every((e: any) => e.status === 'PROCESSED')).toBe(true);
      await expect(feed.detail(ELIGIBLE.user, created.id)).rejects.toMatchObject({ status: 404 });
    });
  });

  // ── races ───────────────────────────────────────────────────────────────

  describe('races resolve to one consistent state', () => {
    it('a bid racing an acceptance never stays pending on a booked request', async () => {
      for (let round = 0; round < 10; round += 1) {
        const created = await requests.create(SEEKER, body());
        const first = await providerBids.submit(ELIGIBLE.user, bid(created.id));

        const [accepted, late] = await Promise.allSettled([
          seekerBids.accept(SEEKER, created.id, first.bid.id),
          providerBids.submit(ELIGIBLE_2.user, bid(created.id, 9_000)),
        ]);
        expect(accepted.status).toBe('fulfilled');

        const stored = await requestRow(created.id);
        expect(stored.status).toBe('BID_ACCEPTED');
        const rows = await bidsOn(created.id);
        // Whichever order they ran in, no bid is left waiting on a request
        // that already has a booking.
        expect(rows.filter((b: any) => b.status === 'PENDING')).toEqual([]);
        expect(rows.filter((b: any) => b.status === 'ACCEPTED')).toHaveLength(1);
        if (late.status === 'rejected') {
          expect(late.reason).toMatchObject({ status: expect.any(Number) });
          expect(late.reason.status).toBeLessThan(500);
        } else {
          expect(rows.find((b: any) => b.providerId === ELIGIBLE_2.profile).status).toBe(
            'REJECTED',
          );
        }
        expect(await prisma.booking.count({ where: { requestId: created.id } })).toBe(1);
      }
    });

    it('two acceptances of two bids produce one booking', async () => {
      const created = await requests.create(SEEKER, body());
      const a = await providerBids.submit(ELIGIBLE.user, bid(created.id));
      const b = await providerBids.submit(ELIGIBLE_2.user, bid(created.id, 9_000));

      const outcomes = await Promise.allSettled([
        seekerBids.accept(SEEKER, created.id, a.bid.id),
        seekerBids.accept(SEEKER, created.id, b.bid.id),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.booking.count({ where: { requestId: created.id } })).toBe(1);
      const rows = await bidsOn(created.id);
      expect(rows.map((r: any) => r.status).sort()).toEqual(['ACCEPTED', 'REJECTED']);
    });

    it('a cancellation racing an acceptance has exactly one winner', async () => {
      for (let round = 0; round < 6; round += 1) {
        const created = await requests.create(SEEKER, body());
        const offer = await providerBids.submit(ELIGIBLE.user, bid(created.id));

        const [accept, cancel] = await Promise.allSettled([
          seekerBids.accept(SEEKER, created.id, offer.bid.id),
          requests.cancel(SEEKER, created.id),
        ]);
        const stored = await requestRow(created.id);
        const bookings = await prisma.booking.count({ where: { requestId: created.id } });

        expect([accept.status, cancel.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
        if (accept.status === 'fulfilled') {
          expect(stored.status).toBe('BID_ACCEPTED');
          expect(bookings).toBe(1);
        } else {
          expect(stored.status).toBe('CANCELLED');
          expect(bookings).toBe(0);
          // The losing acceptance changed nothing.
          expect((await bidsOn(created.id))[0].status).toBe('PENDING');
        }
      }
    });

    it('a bid racing a cancellation is accepted or refused, never an error', async () => {
      for (let round = 0; round < 6; round += 1) {
        const created = await requests.create(SEEKER, body());
        const [offer, cancel] = await Promise.allSettled([
          providerBids.submit(ELIGIBLE.user, bid(created.id)),
          requests.cancel(SEEKER, created.id),
        ]);
        expect(cancel.status).toBe('fulfilled');
        expect((await requestRow(created.id)).status).toBe('CANCELLED');
        if (offer.status === 'rejected') {
          // It lost: the request was already closed to bids.
          expect([404, 409]).toContain(offer.reason.status);
          expect(await prisma.bid.count({ where: { requestId: created.id } })).toBe(0);
        }
        // A cancelled request is closed to new bids afterwards, either way.
        await expect(providerBids.submit(ELIGIBLE_2.user, bid(created.id))).rejects.toMatchObject({
          status: expect.any(Number),
        });
        expect(
          await prisma.bid.count({
            where: { requestId: created.id, providerId: ELIGIBLE_2.profile },
          }),
        ).toBe(0);
      }
    });

    it('a reopen racing a bid leaves the request open and at most one active bid', async () => {
      for (let round = 0; round < 6; round += 1) {
        const created = await requests.create(SEEKER, body());
        await requests.cancel(SEEKER, created.id);

        const [reopen, offer] = await Promise.allSettled([
          requests.reopen(SEEKER, created.id),
          providerBids.submit(ELIGIBLE.user, bid(created.id)),
        ]);
        expect(reopen.status).toBe('fulfilled');
        expect((await requestRow(created.id)).status).toBe('OPEN_FOR_BIDS');
        const rows = await bidsOn(created.id);
        expect(rows.length).toBe(offer.status === 'fulfilled' ? 1 : 0);
        if (offer.status === 'rejected') expect(offer.reason.status).toBeLessThan(500);
        // Open again: the provider sees it and can bid.
        await expect(feed.detail(ELIGIBLE_2.user, created.id)).resolves.toMatchObject({
          id: created.id,
        });
      }
    });
  });

  // ── the whole path ──────────────────────────────────────────────────────

  describe('request to booking, read back by both parties', () => {
    it('seeker creates, eligible provider bids, seeker accepts, both see one booking', async () => {
      const created = await requests.create(SEEKER, body({ idempotencyKey: randomUUID() }));
      // Media reaches a request only through an R06 claim. Stand one in here.
      const media = ['http://localhost:4000/v1/media/files/requests/ref/photo.png'];
      await prisma.serviceRequest.update({
        where: { id: created.id },
        data: { mediaUrls: media },
      });
      await drain();

      expect(await announcements(ELIGIBLE.user, created.id)).toBe(1);
      expect((await feed.detail(ELIGIBLE.user, created.id)).media).toEqual(media);

      const offer = await providerBids.submit(ELIGIBLE.user, bid(created.id, 12_500));
      const rival = await providerBids.submit(ELIGIBLE_2.user, bid(created.id, 15_000));

      const accepted = await seekerBids.accept(SEEKER, created.id, offer.bid.id);
      const bookingId = accepted.booking.id;

      // Fresh reads only from here: what a reload or a new login would get.
      const seekerView = await requests.detail(SEEKER, created.id);
      expect(seekerView).toMatchObject({ status: 'BID_ACCEPTED', activeBookingId: bookingId });

      const seekerBooking = await seekerBookings.detail(SEEKER, bookingId);
      expect(seekerBooking).toMatchObject({ id: bookingId, priceAmount: 12_500 });
      expect(seekerBooking.requestMediaUrls).toEqual(media);

      const providerBooking = await providerBookings.detail(ELIGIBLE.user, bookingId);
      expect(providerBooking).toMatchObject({ id: bookingId, priceAmount: 12_500 });
      // The provider keeps the seeker's photos once the job is theirs.
      expect(providerBooking.requestMediaUrls).toEqual(media);

      // The booking belongs to these two and nobody else.
      await expect(providerBookings.detail(ELIGIBLE_2.user, bookingId)).rejects.toMatchObject({
        status: 404,
      });
      await expect(seekerBookings.detail(OTHER_SEEKER, bookingId)).rejects.toMatchObject({
        status: 404,
      });

      // The request left the marketplace, and the rival's bid was closed.
      expect((await feed.list(ELIGIBLE_2.user, {})).items.map((i: any) => i.id)).not.toContain(
        created.id,
      );
      await expect(feed.detail(ELIGIBLE_2.user, created.id)).rejects.toMatchObject({
        status: 404,
      });
      const rows = await bidsOn(created.id);
      expect(rows.find((b: any) => b.id === offer.bid.id).status).toBe('ACCEPTED');
      expect(rows.find((b: any) => b.id === rival.bid.id).status).toBe('REJECTED');

      const stored = await prisma.booking.findUnique({ where: { id: bookingId } });
      expect(stored).toMatchObject({
        requestId: created.id,
        bidId: offer.bid.id,
        seekerUserId: SEEKER,
        providerId: ELIGIBLE.profile,
        priceAmount: 12_500,
      });
    });
  });
});
