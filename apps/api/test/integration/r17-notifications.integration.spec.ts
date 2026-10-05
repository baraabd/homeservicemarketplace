/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any --
 * Lazy requires: with RUN_DB_INTEGRATION unset this spec is skipped, and a
 * top-level import would still open the Prisma client's pool. `any` on the
 * Prisma and HTTP handles for the same reason.
 */

export {};

import { Test } from '@nestjs/testing';
import { APP_FILTER, Reflector } from '@nestjs/core';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';

import { acquireAdvisoryLocks, fixturePrefix, type HeldLock } from '../support/db-isolation';

// R17-B — notification lifecycle against real PostgreSQL.
//
// docs/production-readiness/r17/R17_B_NOTIFICATIONS.md
//
// Real NotificationsService, repository, outbox repository, outbox worker and
// realtime publisher. The publisher's in-process bus (the SSE source) is real;
// the Socket.IO gateway is a recording stand-in, so transport delivery is
// proven elsewhere (the R17-B browser/transport spec). The JWT and CSRF guards
// are replaced here: real login and session refusal are proven through the
// running API in the browser spec. What is under test is what the service
// and repository let a known caller do.
//
// Gated by RUN_DB_INTEGRATION=1.

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(240_000);

let currentUser: { id: string } | null = null;

class StubJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const named = req.headers['x-test-user'];
    const user = typeof named === 'string' ? { id: named } : currentUser;
    if (!user) return false;
    req.user = user;
    return true;
  }
}
class PassGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

d('R17-B notifications (real Postgres)', () => {
  let prisma: any;
  let app: INestApplication;
  let http: any;
  let service: any;
  let publisher: any;
  let outboxRepo: any;
  let OutboxWorker: any;
  let locks: HeldLock | undefined;
  const gatewayEmits: Array<{ room: string; event: any }> = [];

  const P = fixturePrefix('r17n');
  const ALICE = `${P}alice`;
  const BOB = `${P}bob`;
  const USERS = [ALICE, BOB];
  const BASE = '/v1/me/notifications';

  const as = (userId: string | null) => {
    currentUser = userId ? { id: userId } : null;
  };

  /** Every event the in-process bus delivers for a user (the SSE source). */
  function listen(userId: string): { events: any[]; stop: () => void } {
    const events: any[] = [];
    const sub = publisher.subscribe(userId).subscribe((e: any) => events.push(e));
    return { events, stop: () => sub.unsubscribe() };
  }

  const input = (userId: string, over: Record<string, unknown> = {}) => ({
    userId,
    type: 'SYSTEM',
    title: 'R17 notice',
    body: 'Synthetic R17 notification.',
    deepLink: '/home/bookings/r17',
    ...over,
  });

  /** A committed notification created the way producers create them. */
  const committed = (userId: string, over: Record<string, unknown> = {}) =>
    prisma.$transaction((tx: any) => service.createForUser(input(userId, over), tx));

  const outboxFor = (notificationId: string) =>
    prisma.outboxEvent.findMany({ where: { aggregateId: notificationId } });

  function makeWorker(handlers: any[]) {
    const values: Record<string, unknown> = {
      OUTBOX_WORKER_ENABLED: false,
      OUTBOX_BATCH_SIZE: 200,
      OUTBOX_POLL_INTERVAL_MS: 1_000,
      OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
      OUTBOX_RETRY_BASE_MS: 1_000,
      OUTBOX_RETRY_CAP_MS: 300_000,
    };
    const noop = { inc: jest.fn(), set: jest.fn(), reset: jest.fn() };
    const metrics = {
      outboxEventsProcessedTotal: { inc: jest.fn() },
      outboxEventDurationSeconds: { startTimer: jest.fn(() => jest.fn()) },
      outboxQueueDepth: noop,
      outboxOldestPendingAgeSeconds: noop,
      outboxClaimedTotal: { inc: jest.fn() },
      outboxReclaimedTotal: { inc: jest.fn() },
    };
    return new OutboxWorker(
      outboxRepo,
      { client: prisma },
      { get: (k: string) => values[k] },
      metrics,
      handlers,
    );
  }
  const createdHandler = () => {
    const {
      NotificationCreatedHandler,
    } = require('../../src/modules/notifications/notification-created.handler');
    return new NotificationCreatedHandler(publisher);
  };

  async function wipe(): Promise<void> {
    const ids = (
      await prisma.notification.findMany({ where: { userId: { in: USERS } }, select: { id: true } })
    ).map((r: any) => r.id);
    if (ids.length > 0) {
      await prisma.outboxHandlerRun.deleteMany({
        where: { event: { aggregateId: { in: ids } } },
      });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    }
    await prisma.notification.deleteMany({ where: { userId: { in: USERS } } });
    await prisma.user.deleteMany({ where: { id: { in: USERS } } });
  }

  beforeAll(async () => {
    // The worker claims table-wide, so no other suite may enqueue meanwhile.
    locks = await acquireAdvisoryLocks([
      { resource: 'outbox' as const, mode: 'exclusive' as const },
    ]);
    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    const prismaSvc = { client: prisma, isReady: () => true };

    const { PrismaService } = require('../../src/infrastructure/prisma/prisma.service');
    const { TransactionRunner } = require('../../src/infrastructure/prisma/transaction.runner');
    const {
      NotificationRepository,
    } = require('../../src/infrastructure/persistence/notifications/notification.repository');
    const { OutboxRepository } = require('../../src/infrastructure/outbox/outbox.repository');
    OutboxWorker = require('../../src/infrastructure/outbox/outbox.worker').OutboxWorker;
    const { RealtimeGateway } = require('../../src/modules/realtime/realtime.gateway');
    const {
      RealtimeEventsPublisher,
    } = require('../../src/modules/realtime/realtime-events.publisher');
    const {
      NotificationsService,
    } = require('../../src/modules/notifications/notifications.service');
    const {
      NotificationsController,
    } = require('../../src/modules/notifications/notifications.controller');
    const { AllExceptionsFilter } = require('../../src/infrastructure/http/all-exceptions.filter');
    const { JwtAuthGuard } = require('../../src/modules/iam/authentication/guards/jwt-auth.guard');
    const { CsrfGuard } = require('../../src/modules/iam/authentication/guards/csrf.guard');
    const { AppConfigService } = require('../../src/config/app-config.service');

    const config = { get: () => undefined, isProduction: false };
    const gateway = {
      emitToRoom: (room: string, event: any) => gatewayEmits.push({ room, event }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        NotificationRepository,
        OutboxRepository,
        TransactionRunner,
        RealtimeEventsPublisher,
        Reflector,
        { provide: RealtimeGateway, useValue: gateway },
        { provide: PrismaService, useValue: prismaSvc },
        { provide: AppConfigService, useValue: config },
        { provide: AllExceptionsFilter, useValue: new AllExceptionsFilter(config) },
        { provide: APP_FILTER, useExisting: AllExceptionsFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .overrideGuard(CsrfGuard)
      .useClass(PassGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    http = app.getHttpServer();
    service = moduleRef.get(NotificationsService);
    publisher = moduleRef.get(RealtimeEventsPublisher);
    outboxRepo = moduleRef.get(OutboxRepository);

    await wipe();
    for (const id of USERS) {
      await prisma.user.create({
        data: {
          id,
          email: `${id}@r17n.test`,
          firstName: 'Rana',
          lastName: 'Fixture',
          emailVerifiedAt: new Date('2026-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
  });

  afterAll(async () => {
    try {
      if (prisma) await wipe();
    } finally {
      await app?.close();
      await locks?.release();
    }
  });

  beforeEach(async () => {
    gatewayEmits.length = 0;
    const ids = (
      await prisma.notification.findMany({ where: { userId: { in: USERS } }, select: { id: true } })
    ).map((r: any) => r.id);
    if (ids.length > 0) {
      await prisma.outboxHandlerRun.deleteMany({ where: { event: { aggregateId: { in: ids } } } });
      await prisma.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
    }
    await prisma.notification.deleteMany({ where: { userId: { in: USERS } } });
    as(ALICE);
  });

  // ── B-1: nothing leaves the process before the transaction commits ───────
  describe('B-1 committed publication', () => {
    it('nothing is announced while the transaction is open, and a rolled-back notification never is', async () => {
      const bus = listen(ALICE);
      try {
        await expect(
          prisma.$transaction(async (tx: any) => {
            await service.createForUser(input(ALICE, { actorUserId: BOB }), tx);
            // Still inside the transaction: nobody may hear about it yet.
            expect(bus.events).toEqual([]);
            expect(gatewayEmits).toEqual([]);
            throw new Error('the business change failed after the notification write');
          }),
        ).rejects.toThrow('the business change failed');
        expect(bus.events).toEqual([]);
        expect(gatewayEmits).toEqual([]);
        expect(await prisma.notification.count({ where: { userId: ALICE } })).toBe(0);
      } finally {
        bus.stop();
      }
    });

    it('a committed notification is announced once, after commit, by the outbox, with its actor', async () => {
      const bus = listen(ALICE);
      try {
        const created = await committed(ALICE, { actorUserId: BOB });
        // Committed, but not yet dispatched: still silent.
        expect(bus.events).toEqual([]);
        const events = await outboxFor(created.id);
        expect(events).toEqual([
          expect.objectContaining({
            eventType: 'notification.created',
            dedupeKey: `notification.created:${created.id}`,
            status: 'PENDING',
            payload: { schemaVersion: 1, notificationId: created.id, actorUserId: BOB },
          }),
        ]);

        const worker = makeWorker([createdHandler()]);
        await worker.runOnce();
        expect(bus.events).toEqual([
          expect.objectContaining({
            type: 'notification.created',
            userId: ALICE,
            actorUserId: BOB,
            payload: expect.objectContaining({ id: created.id, readAt: null }),
          }),
        ]);
        expect(gatewayEmits.map((e) => e.room)).toEqual([`user:${ALICE}`]);

        // Re-delivery of the same event (a second worker, a replayed claim):
        // the handler marker holds, nothing is announced twice.
        await prisma.outboxEvent.update({
          where: { id: events[0].id },
          data: { status: 'PENDING', availableAt: new Date(Date.now() - 1_000) },
        });
        await makeWorker([createdHandler()]).runOnce();
        expect(bus.events).toHaveLength(1);
        expect(await prisma.outboxHandlerRun.count({ where: { eventId: events[0].id } })).toBe(1);
      } finally {
        bus.stop();
      }
    });

    it('without a caller transaction the row and its announcement commit together', async () => {
      const created = await service.createForUser(input(ALICE));
      expect(await outboxFor(created.id)).toHaveLength(1);
      expect(await prisma.notification.count({ where: { id: created.id } })).toBe(1);
    });

    it('an announcement whose worker died after claiming is reclaimed and announced once', async () => {
      const bus = listen(ALICE);
      try {
        const created = await committed(ALICE);
        const [event] = await outboxFor(created.id);
        // A worker claimed it and died: PROCESSING with an expired lease.
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PROCESSING',
            claimedAt: new Date(Date.now() - 10 * 60_000),
            claimedBy: 'dead-worker',
          },
        });
        await makeWorker([createdHandler()]).runOnce();
        expect(bus.events.map((e: any) => e.payload.id)).toEqual([created.id]);
        expect((await prisma.outboxEvent.findUnique({ where: { id: event.id } })).status).toBe(
          'PROCESSED',
        );
      } finally {
        bus.stop();
      }
    });

    it('a notification deleted before dispatch is not announced', async () => {
      const bus = listen(ALICE);
      try {
        const created = await committed(ALICE);
        await request(http).delete(`${BASE}/${created.id}`).expect(204);
        await makeWorker([createdHandler()]).runOnce();
        expect(bus.events).toEqual([]);
      } finally {
        bus.stop();
      }
    });
  });

  // ── B-2: read-all marks what the reader was shown ─────────────────────────
  describe('B-2 read-all selection', () => {
    const readAll = (body: unknown, experience = 'seeker') =>
      request(http)
        .post(`${BASE}/read-all?experience=${experience}`)
        .send(body as object);
    const unreadIds = async (userId: string) =>
      (
        await prisma.notification.findMany({
          where: { userId, readAt: null, deletedAt: null },
          orderBy: { id: 'asc' },
        })
      ).map((r: any) => r.id);

    it('marks only the notifications the reader was shown; one that arrived meanwhile stays unread', async () => {
      for (let i = 0; i < 3; i += 1) await committed(ALICE, { title: `shown ${i}` });
      const shown = (await request(http).get(`${BASE}?experience=seeker`)).body.items.map(
        (n: any) => n.id,
      );
      expect(shown).toHaveLength(3);
      const arrived = await committed(ALICE, { title: 'arrived after the list was read' });

      const res = await readAll({ ids: shown });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updatedCount: 3 });
      expect(await unreadIds(ALICE)).toEqual([arrived.id]);
      expect((await request(http).get(`${BASE}/unread-count?experience=seeker`)).body).toEqual({
        count: 1,
      });
    });

    it('the unbounded bodyless call is refused and changes nothing', async () => {
      await committed(ALICE);
      await committed(ALICE);
      const res = await readAll(undefined);
      expect(res.status).toBe(400);
      expect(await unreadIds(ALICE)).toHaveLength(2);
    });

    it('equal timestamps and a row that commits after the list stay outside the selection', async () => {
      // Boundary dataset written directly (labelled fixture): identical
      // createdAt values, and a row whose timestamp predates the list but
      // whose transaction commits after it.
      const at = new Date('2026-10-05T10:00:00.000Z');
      const same = [];
      for (let i = 0; i < 3; i += 1) {
        same.push(
          await prisma.notification.create({
            data: { ...input(ALICE, { title: `tie ${i}` }), createdAt: at },
          }),
        );
      }
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      let lateId = '';
      const late = prisma.$transaction(
        async (tx: any) => {
          const row = await tx.notification.create({
            data: {
              ...input(ALICE, { title: 'late' }),
              createdAt: new Date(at.getTime() - 60_000),
            },
          });
          lateId = row.id;
          await held;
        },
        { timeout: 60_000 },
      );
      // The reader's list cannot see the uncommitted row.
      const shown = (await request(http).get(`${BASE}?experience=seeker`)).body.items.map(
        (n: any) => n.id,
      );
      expect(new Set(shown)).toEqual(new Set(same.map((r) => r.id)));
      release();
      await late;

      const res = await readAll({ ids: shown.slice(0, 2) });
      expect(res.body).toEqual({ updatedCount: 2 });
      expect(new Set(await unreadIds(ALICE))).toEqual(new Set([shown[2], lateId]));
    });

    it('foreign, other-experience, deleted and unknown ids are never touched; bad selections are refused', async () => {
      const mine = await committed(ALICE);
      const providerSide = await committed(ALICE, { deepLink: '/provider/bids/r17' });
      const deleted = await committed(ALICE);
      await request(http).delete(`${BASE}/${deleted.id}`).expect(204);
      const theirs = await committed(BOB);

      const res = await readAll({
        ids: [mine.id, providerSide.id, deleted.id, theirs.id, `${P}unknown`],
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ updatedCount: 1 });
      expect(await unreadIds(ALICE)).toEqual([providerSide.id]);
      expect(await unreadIds(BOB)).toEqual([theirs.id]);

      for (const bad of [
        { ids: [] },
        { ids: Array.from({ length: 101 }, (_, i) => `id${i}`) },
        { ids: ['not an id!'] },
        { ids: 'x' },
        { ids: [mine.id], userId: BOB },
      ]) {
        expect((await readAll(bad)).status).toBe(400);
      }
    });

    it('a retry does not widen the selection or move readAt', async () => {
      const first = await committed(ALICE);
      expect((await readAll({ ids: [first.id] })).body).toEqual({ updatedCount: 1 });
      const readAt = (await prisma.notification.findUnique({ where: { id: first.id } })).readAt;
      const later = await committed(ALICE);
      expect((await readAll({ ids: [first.id] })).body).toEqual({ updatedCount: 0 });
      expect((await prisma.notification.findUnique({ where: { id: first.id } })).readAt).toEqual(
        readAt,
      );
      expect(await unreadIds(ALICE)).toEqual([later.id]);
    });

    it('single read, read-all and delete racing on the same rows agree', async () => {
      const rows = [];
      for (let i = 0; i < 6; i += 1) rows.push(await committed(ALICE, { title: `race ${i}` }));
      const ids = rows.map((r) => r.id);
      const [all, one, gone] = await Promise.all([
        readAll({ ids }).set('x-test-user', ALICE),
        request(http).post(`${BASE}/${ids[0]}/read`).set('x-test-user', ALICE),
        request(http).delete(`${BASE}/${ids[1]}`).set('x-test-user', ALICE),
      ]);
      expect([one.status, gone.status]).toEqual([200, 204]);
      const stored = await prisma.notification.findMany({ where: { id: { in: ids } } });
      // Every live row ends read; the deleted row is gone; the counter only
      // counts rows read-all itself flipped.
      expect(stored.filter((r: any) => !r.deletedAt).every((r: any) => r.readAt)).toBe(true);
      expect(all.body.updatedCount).toBeGreaterThanOrEqual(4);
      expect(all.body.updatedCount).toBeLessThanOrEqual(6);
      expect(await unreadIds(ALICE)).toEqual([]);
    });
  });

  // ── B-3/B-4: experiences are presentation partitions, not permissions ─────
  describe('B-3/B-4 experience scope', () => {
    it('each experience lists, counts and reads only its rows; a dispute notice belongs to both participant experiences', async () => {
      const seekerRow = await committed(ALICE, { deepLink: '/home/requests/r17' });
      const providerRow = await committed(ALICE, { deepLink: '/provider/bookings/r17' });
      const adminRow = await committed(ALICE, { deepLink: '/admin/disputes/r17' });
      // The dispute-intake producer's shape: no resource type, /disputes link.
      const intake = await committed(ALICE, {
        deepLink: '/disputes/r17-case',
        resourceType: null,
        title: 'Support case update',
      });
      const ids = async (experience: string) =>
        new Set(
          (await request(http).get(`${BASE}?experience=${experience}`)).body.items.map(
            (n: any) => n.id,
          ),
        );
      const count = async (experience: string) =>
        (await request(http).get(`${BASE}/unread-count?experience=${experience}`)).body.count;

      expect(await ids('seeker')).toEqual(new Set([seekerRow.id, intake.id]));
      expect(await ids('provider')).toEqual(new Set([providerRow.id, intake.id]));
      expect(await ids('admin')).toEqual(new Set([adminRow.id]));
      expect([await count('seeker'), await count('provider'), await count('admin')]).toEqual([
        2, 2, 1,
      ]);

      // Read-all from the provider drawer cannot reach the seeker's row even
      // when its id is sent.
      const res = await request(http)
        .post(`${BASE}/read-all?experience=provider`)
        .send({ ids: [providerRow.id, seekerRow.id] });
      expect(res.body).toEqual({ updatedCount: 1 });
      expect(await count('seeker')).toBe(2);
    });

    it('experience=admin grants nothing: another user sees none of these rows', async () => {
      await committed(ALICE, { deepLink: '/admin/disputes/r17' });
      as(BOB);
      expect((await request(http).get(`${BASE}?experience=admin`)).body.items).toEqual([]);
      expect((await request(http).get(`${BASE}/unread-count?experience=admin`)).body).toEqual({
        count: 0,
      });
    });

    it('the unread count is exact beyond one page', async () => {
      await prisma.notification.createMany({
        data: Array.from({ length: 130 }, (_, i) => input(ALICE, { title: `bulk ${i}` })),
      });
      expect((await request(http).get(`${BASE}?experience=seeker`)).body.items).toHaveLength(50);
      expect((await request(http).get(`${BASE}/unread-count?experience=seeker`)).body).toEqual({
        count: 130,
      });
    });
  });
});
