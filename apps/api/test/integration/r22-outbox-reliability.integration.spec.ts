/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports --
 * Lazily loaded Prisma client and units; see outbox.integration.spec.ts. */
// R22 — outbox lease, failure and shutdown semantics against REAL Postgres.
//
// The Sprint 6 suite (outbox.integration.spec.ts) pins claiming, markers,
// retry and cleanup. This suite pins what R22 added on top: lease fencing,
// database-clock reclaim, heartbeat, typed failures, delivery deadlines,
// bounded graceful shutdown, post-commit visibility and poison isolation.
// The two-process crash suite is r22-outbox-process.integration.spec.ts.
//
// Gated by RUN_DB_INTEGRATION=1 and holds the exclusive `outbox` advisory lock,
// exactly like the Sprint 6 suite: a queue consumer needs the queue to itself.

export {};

import { acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';
import {
  cleanup,
  deferred,
  effectHandler,
  effectsFor,
  enqueue,
  ensureUser,
  loadOutbox,
  makeConfig,
  makeMetrics,
  R22_AGGREGATE,
  R22_PREFIX,
  waitFor,
} from './r22-support/outbox-harness';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('R22 outbox reliability (real Postgres)', () => {
  let prisma: any;
  let OutboxRepository: any;
  let OutboxWorker: any;
  let repo: any;
  let lock: HeldLock;
  const userId = `${R22_PREFIX}user-1`;

  function worker(handlers: any[], over: Record<string, unknown> = {}, metrics = makeMetrics()) {
    const w = new OutboxWorker(repo, { client: prisma }, makeConfig(over), metrics, handlers);
    return { w, metrics };
  }

  async function row(id: string) {
    return prisma.outboxEvent.findUnique({ where: { id } });
  }

  beforeAll(async () => {
    lock = await acquireAdvisoryLock('outbox', 'exclusive');
    ({ prisma, OutboxRepository, OutboxWorker } = loadOutbox());
    repo = new OutboxRepository({ client: prisma });
    await cleanup(prisma);
    await ensureUser(prisma, userId);
  });

  afterEach(async () => {
    await cleanup(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.user.deleteMany({ where: { id: { startsWith: R22_PREFIX } } });
    await lock?.release();
  });

  // ── post-commit publication ──────────────────────────────────────────────

  describe('post-commit publication', () => {
    it('an intent enqueued in an open transaction is invisible until commit', async () => {
      const handler = effectHandler('r22.postcommit', 'r22.postcommit', userId);
      const { w } = worker([handler]);
      const inTx = deferred();
      const release = deferred();
      let eventId = '';

      const producer = prisma.$transaction(async (tx: any) => {
        const e = await repo.enqueue(
          {
            aggregateType: R22_AGGREGATE,
            aggregateId: 'agg-r22',
            eventType: 'r22.postcommit',
            payload: {},
            availableAt: new Date(Date.now() - 1_000),
          },
          tx,
        );
        eventId = e.id;
        inTx.resolve();
        await release.promise;
      });

      await inTx.promise;
      // The worker runs while the business transaction is still open.
      expect(await w.runOnce()).toBe(0);
      expect(handler.runs).toEqual([]);

      release.resolve();
      await producer;
      await waitFor(
        async () => (await w.runOnce()) > 0 || (await row(eventId))?.status === 'PROCESSED',
        'not delivered',
      );
      expect((await row(eventId)).status).toBe('PROCESSED');
      expect(await effectsFor(prisma, eventId)).toBe(1);
    });

    it('a rolled-back business transaction emits nothing', async () => {
      const before = await prisma.outboxEvent.count({ where: { aggregateType: R22_AGGREGATE } });
      await expect(
        prisma.$transaction(async (tx: any) => {
          await repo.enqueue(
            {
              aggregateType: R22_AGGREGATE,
              aggregateId: 'agg-r22',
              eventType: 'r22.rollback',
              payload: {},
            },
            tx,
          );
          throw new Error('business rule rejected the mutation');
        }),
      ).rejects.toThrow('business rule rejected');
      expect(await prisma.outboxEvent.count({ where: { aggregateType: R22_AGGREGATE } })).toBe(
        before,
      );
      const { w, metrics } = worker([effectHandler('r22.rollback', 'r22.rollback', userId)]);
      expect(await w.runOnce()).toBe(0);
      expect(metrics.outcomes).toEqual([]);
    });
  });

  // ── lease fencing ────────────────────────────────────────────────────────

  describe('lease fencing', () => {
    it('a stale owner cannot overwrite a newer result, and its effect rolls back', async () => {
      const e = await enqueue(prisma, repo, 'r22.fence');
      const gate = deferred();
      const entered = deferred();
      const handler = effectHandler('r22.fence', 'r22.fence', userId, {
        before: async () => {
          entered.resolve();
          await gate.promise;
        },
      });
      const a = worker([handler]);
      const running = a.w.runOnce();
      await entered.promise;

      // While A is inside its delivery transaction, a newer owner finishes the
      // event (what a reclaim + successful redelivery leaves behind).
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "status" = 'PROCESSED'::"OutboxStatus", "claimedBy" = NULL,
           "claimedAt" = NULL, "processedAt" = NOW() WHERE "id" = $1`,
        e.id,
      );
      const newer = await row(e.id);

      gate.resolve();
      await running;

      const after = await row(e.id);
      expect(after.status).toBe('PROCESSED');
      expect(after.processedAt.getTime()).toBe(newer.processedAt.getTime());
      expect(after.attempts).toBe(0);
      expect(a.metrics.outcomes).toEqual(['lease-lost']);
      // A's Notification and marker rolled back with its transaction.
      expect(await effectsFor(prisma, e.id)).toBe(0);
      expect(await prisma.outboxHandlerRun.count({ where: { eventId: e.id } })).toBe(0);
    });

    it('a reclaimed event is delivered once: the stale owner rolls back, the new owner commits', async () => {
      const e = await enqueue(prisma, repo, 'r22.reclaim');
      const gate = deferred();
      const entered = deferred();
      let first = true;
      const handler = effectHandler('r22.reclaim', 'r22.reclaim', userId, {
        before: async () => {
          if (!first) return;
          first = false;
          entered.resolve();
          await gate.promise;
        },
      });
      const a = worker([handler]);
      const running = a.w.runOnce();
      await entered.promise;

      // A looks dead: its claim is far past the visibility timeout.
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "claimedAt" = NOW() - INTERVAL '10 minutes' WHERE "id" = $1`,
        e.id,
      );
      const b = worker([handler]);
      // B reclaims; A's open transaction still holds the marker row, so B
      // cannot claim it yet (SKIP LOCKED) — but A has lost the lease.
      await b.w.runOnce();
      expect((await row(e.id)).claimedBy).not.toBe(a.w.id);

      gate.resolve();
      await running;
      expect(a.metrics.outcomes).toEqual(['lease-lost']);
      expect(await effectsFor(prisma, e.id)).toBe(0);

      await waitFor(async () => {
        await b.w.runOnce();
        return (await row(e.id)).status === 'PROCESSED';
      }, 'new owner never delivered');
      expect(await effectsFor(prisma, e.id)).toBe(1);
      expect((await row(e.id)).attempts).toBe(0);
    });

    it('a stale owner cannot record a failure over the new owner', async () => {
      const e = await enqueue(prisma, repo, 'r22.stalefail');
      const gate = deferred();
      const entered = deferred();
      const handler = {
        name: 'r22.stalefail',
        eventTypes: ['r22.stalefail'],
        async handle() {
          entered.resolve();
          await gate.promise;
          throw new Error('stale owner failure');
        },
      };
      const a = worker([handler]);
      const running = a.w.runOnce();
      await entered.promise;
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "claimedBy" = 'worker-b', "claimedAt" = NOW() WHERE "id" = $1`,
        e.id,
      );
      gate.resolve();
      await running;
      const after = await row(e.id);
      expect(after.status).toBe('PROCESSING');
      expect(after.claimedBy).toBe('worker-b');
      expect(after.attempts).toBe(0);
      expect(after.lastError).toBeNull();
      expect(a.metrics.outcomes).toEqual(['lease-lost']);
    });
  });

  // ── clocks and heartbeat ─────────────────────────────────────────────────

  describe('database-clock reclaim and heartbeat', () => {
    it('an application clock running ahead does not reclaim a live claim', async () => {
      const e = await enqueue(prisma, repo, 'r22.skew');
      await repo.claimBatch('live-worker', 10);
      const realNow = Date.now();
      const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 10 * 60_000);
      try {
        // The pre-R22 cutoff, computed on the skewed app clock, would reclaim:
        // that is the defect. The database-clock reclaim does not.
        expect(await repo.reclaimExpired(120_000)).toBe(0);
      } finally {
        spy.mockRestore();
      }
      expect((await row(e.id)).claimedBy).toBe('live-worker');
      // Control: the app-clock variant demonstrably misfires under that skew.
      expect(await repo.reclaimStale(new Date(realNow + 10 * 60_000 - 120_000))).toBe(1);
    });

    it('heartbeat renews only the caller’s own leases and never re-acquires', async () => {
      const mine = await enqueue(prisma, repo, 'r22.hb');
      await repo.claimBatch('hb-worker', 10);
      const theirs = await enqueue(prisma, repo, 'r22.hb');
      await repo.claimBatch('other-worker', 10);
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "claimedAt" = NOW() - INTERVAL '10 minutes' WHERE "id" = ANY($1)`,
        [mine.id, theirs.id],
      );
      expect(await repo.heartbeat('hb-worker')).toBe(1);
      expect(await repo.reclaimExpired(120_000)).toBe(1);
      expect((await row(mine.id)).claimedBy).toBe('hb-worker');
      expect((await row(theirs.id)).status).toBe('PENDING');
      // After the reclaim the old owner's heartbeat cannot take it back.
      expect(await repo.heartbeat('other-worker')).toBe(0);
      expect((await row(theirs.id)).claimedBy).toBeNull();
    });

    it('the worker heartbeats a batch so its last event is not reclaimed while queued', async () => {
      const events = [
        await enqueue(prisma, repo, 'r22.batch'),
        await enqueue(prisma, repo, 'r22.batch'),
      ];
      const timeoutMs = 1_000;
      const handler = effectHandler('r22.batch', 'r22.batch', userId, {
        // Each delivery outlasts the whole visibility timeout.
        before: () => new Promise((r) => setTimeout(r, 1_400)),
      });
      const { w } = worker([handler], { OUTBOX_CLAIM_TIMEOUT_MS: timeoutMs });
      const running = w.runOnce();
      // A competitor keeps trying to reclaim while the batch runs.
      let stolen = 0;
      const until = Date.now() + 3_000;
      while (Date.now() < until) {
        stolen += await repo.reclaimExpired(timeoutMs);
        await new Promise((r) => setTimeout(r, 100));
      }
      await running;
      expect(stolen).toBe(0);
      for (const e of events) {
        expect((await row(e.id)).status).toBe('PROCESSED');
        expect(await effectsFor(prisma, e.id)).toBe(1);
      }
    });
  });

  // ── typed failures, deadlines, poison ────────────────────────────────────

  describe('failure handling', () => {
    it('a permanent error dead-letters on the first attempt', async () => {
      const { OutboxPermanentError } = require('../../src/infrastructure/outbox/outbox.errors');
      const e = await enqueue(prisma, repo, 'r22.permanent');
      const { w, metrics } = worker([
        {
          name: 'r22.permanent',
          eventTypes: ['r22.permanent'],
          async handle() {
            throw new OutboxPermanentError('payload references a deleted booking');
          },
        },
      ]);
      await w.runOnce();
      const after = await row(e.id);
      expect(after.status).toBe('DEAD');
      expect(after.attempts).toBe(1);
      expect(after.lastError).toContain('deleted booking');
      expect(metrics.outcomes).toEqual(['dead']);
    });

    it('a transient retry-after hint lengthens the backoff on the database clock', async () => {
      const { OutboxTransientError } = require('../../src/infrastructure/outbox/outbox.errors');
      const e = await enqueue(prisma, repo, 'r22.hint');
      const { w } = worker(
        [
          {
            name: 'r22.hint',
            eventTypes: ['r22.hint'],
            async handle() {
              throw new OutboxTransientError('vendor throttled', 60_000);
            },
          },
        ],
        { OUTBOX_RETRY_BASE_MS: 10, OUTBOX_RETRY_CAP_MS: 120_000 },
      );
      await w.runOnce();
      const [{ delay }] = await prisma.$queryRawUnsafe(
        `SELECT EXTRACT(EPOCH FROM ("availableAt" - NOW()))::float AS delay FROM "OutboxEvent" WHERE "id" = $1`,
        e.id,
      );
      expect((await row(e.id)).status).toBe('PENDING');
      expect(delay).toBeGreaterThan(55);
      expect(delay).toBeLessThanOrEqual(60.5);
    });

    it('a delivery past its deadline is abandoned, rolled back and retried', async () => {
      const e = await enqueue(prisma, repo, 'r22.hang');
      const hang = deferred();
      const handler = effectHandler('r22.hang', 'r22.hang', userId, {
        // A non-database await that Prisma's transaction timer cannot cancel.
        before: () => hang.promise,
      });
      const { w, metrics } = worker([handler], {
        OUTBOX_DELIVERY_TX_TIMEOUT_MS: 2_000,
        OUTBOX_DELIVERY_DEADLINE_MS: 500,
      });
      const started = Date.now();
      await w.runOnce();
      expect(Date.now() - started).toBeLessThan(5_000);
      const after = await row(e.id);
      expect(after.status).toBe('PENDING');
      expect(after.attempts).toBe(1);
      expect(after.lastError).toContain('deadline');
      expect(metrics.outcomes).toEqual(['retried']);

      // The abandoned callback wakes up later; its transaction can no longer
      // commit an effect or a marker.
      hang.resolve();
      await new Promise((r) => setTimeout(r, 2_500));
      expect(await effectsFor(prisma, e.id)).toBe(0);
      expect(await prisma.outboxHandlerRun.count({ where: { eventId: e.id } })).toBe(0);
      expect((await row(e.id)).status).toBe('PENDING');
    });

    it('a poison event neither blocks nor starves unrelated work', async () => {
      const poison = await enqueue(prisma, repo, 'r22.poison', {}, { maxAttempts: 3 });
      const healthy = [];
      for (let i = 0; i < 5; i++) healthy.push(await enqueue(prisma, repo, 'r22.healthy'));
      const poisonHandler = {
        name: 'r22.poison',
        eventTypes: ['r22.poison'],
        async handle() {
          throw new Error('always fails');
        },
      };
      const ok = effectHandler('r22.healthy', 'r22.healthy', userId);
      const { w } = worker([poisonHandler, ok], {
        OUTBOX_RETRY_BASE_MS: 1,
        OUTBOX_RETRY_CAP_MS: 1,
      });

      await w.runOnce();
      for (const e of healthy) expect((await row(e.id)).status).toBe('PROCESSED');

      await waitFor(async () => {
        await w.runOnce();
        return (await row(poison.id)).status === 'DEAD';
      }, 'poison never reached DEAD');
      expect((await row(poison.id)).attempts).toBe(3);
      for (const e of healthy) expect(await effectsFor(prisma, e.id)).toBe(1);
    });

    it('a producer budget above the ceiling still dead-letters', async () => {
      const { MAX_ATTEMPTS_CEILING } = require('../../src/infrastructure/outbox/outbox.retry');
      const e = await enqueue(prisma, repo, 'r22.ceiling', {}, { maxAttempts: 1_000_000 });
      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { attempts: MAX_ATTEMPTS_CEILING - 1 },
      });
      const { w } = worker([
        {
          name: 'r22.ceiling',
          eventTypes: ['r22.ceiling'],
          async handle() {
            throw new Error('still failing');
          },
        },
      ]);
      await w.runOnce();
      expect((await row(e.id)).status).toBe('DEAD');
    });

    it('an unknown event type dead-letters without touching other events', async () => {
      const unknown = await enqueue(prisma, repo, 'r22.nobody-handles-this');
      const fine = await enqueue(prisma, repo, 'r22.fine');
      const { w } = worker([effectHandler('r22.fine', 'r22.fine', userId)]);
      await w.runOnce();
      expect((await row(unknown.id)).status).toBe('DEAD');
      expect((await row(unknown.id)).lastError).toContain('No handler registered');
      expect((await row(fine.id)).status).toBe('PROCESSED');
    });
  });

  // ── duplicates and registration ──────────────────────────────────────────

  describe('duplicate delivery and registration', () => {
    it('a redelivery with one completed handler still runs the other handler (tx not aborted)', async () => {
      // Pre-R22 the marker conflict was caught AFTER Postgres had aborted the
      // transaction, so every later statement in the delivery failed.
      const e = await enqueue(prisma, repo, 'r22.multi');
      const first = effectHandler('r22.multi.a', 'r22.multi', userId);
      const second = effectHandler('r22.multi.b', 'r22.multi', userId);
      await prisma.outboxHandlerRun.create({ data: { eventId: e.id, handler: 'r22.multi.a' } });

      const { w, metrics } = worker([first, second]);
      await w.runOnce();

      expect((await row(e.id)).status).toBe('PROCESSED');
      expect(first.runs).toEqual([]);
      expect(second.runs).toEqual([e.id]);
      expect(await effectsFor(prisma, e.id)).toBe(1);
      expect(metrics.outcomes).toEqual(['processed']);
    });

    it('duplicate delivery after a crash between commit and ack produces one effect', async () => {
      const e = await enqueue(prisma, repo, 'r22.dup');
      const handler = effectHandler('r22.dup', 'r22.dup', userId);
      await worker([handler]).w.runOnce();
      // Force the at-least-once redelivery window.
      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { status: 'PENDING', claimedAt: null, claimedBy: null },
      });
      const again = worker([handler]);
      await again.w.runOnce();
      expect(again.metrics.outcomes).toEqual(['skipped-duplicate']);
      expect(await effectsFor(prisma, e.id)).toBe(1);
    });

    it('refuses to construct a worker whose handlers share a marker name', () => {
      expect(() =>
        worker([
          effectHandler('r22.same', 'r22.one', userId),
          effectHandler('r22.same', 'r22.two', userId),
        ]),
      ).toThrow(/duplicate handler name "r22.same"/);
    });
  });

  // ── graceful shutdown ────────────────────────────────────────────────────

  describe('graceful shutdown', () => {
    it('finishes the in-flight event, releases the rest of its batch, and stops claiming', async () => {
      const events = [];
      for (let i = 0; i < 3; i++) events.push(await enqueue(prisma, repo, 'r22.shutdown'));
      const gate = deferred();
      const entered = deferred();
      let n = 0;
      const handler = effectHandler('r22.shutdown', 'r22.shutdown', userId, {
        before: async () => {
          if (n++ > 0) return;
          entered.resolve();
          await gate.promise;
        },
      });
      const { w } = worker([handler], {
        OUTBOX_WORKER_ENABLED: true,
        OUTBOX_SHUTDOWN_GRACE_MS: 10_000,
      });
      w.onModuleInit();
      await entered.promise;

      const stopping = w.onModuleDestroy();
      gate.resolve();
      await stopping;

      const rows = await Promise.all(events.map((e) => row(e.id)));
      const processed = rows.filter((r: any) => r.status === 'PROCESSED');
      const released = rows.filter((r: any) => r.status === 'PENDING');
      expect(processed).toHaveLength(1);
      expect(released).toHaveLength(2);
      for (const r of released) {
        expect(r.claimedBy).toBeNull();
        expect(r.attempts).toBe(0);
      }
      expect(handler.runs).toHaveLength(1);

      // Stopped means stopped: a new due event is not claimed.
      const later = await enqueue(prisma, repo, 'r22.shutdown');
      await new Promise((r) => setTimeout(r, 300));
      expect((await row(later.id)).status).toBe('PENDING');
    });

    it('bounds the wait for a hung delivery and leaves it recoverable', async () => {
      const e = await enqueue(prisma, repo, 'r22.hungstop');
      const hang = deferred();
      const entered = deferred();
      const handler = effectHandler('r22.hungstop', 'r22.hungstop', userId, {
        before: async () => {
          entered.resolve();
          await hang.promise;
        },
      });
      const { w, metrics } = worker([handler], {
        OUTBOX_WORKER_ENABLED: true,
        OUTBOX_SHUTDOWN_GRACE_MS: 300,
        OUTBOX_DELIVERY_DEADLINE_MS: 60_000,
        OUTBOX_DELIVERY_TX_TIMEOUT_MS: 60_000,
      });
      w.onModuleInit();
      await entered.promise;

      const started = Date.now();
      await w.onModuleDestroy();
      expect(Date.now() - started).toBeLessThan(3_000);
      // Released immediately rather than stranded until the visibility timeout.
      expect((await row(e.id)).status).toBe('PENDING');
      expect((await row(e.id)).claimedBy).toBeNull();

      // The hung delivery wakes after release: its fenced completion fails and
      // its transaction (marker + effect) rolls back.
      hang.resolve();
      await waitFor(
        async () => metrics.outcomes.includes('lease-lost'),
        'stale delivery never stood down',
      );
      expect(await effectsFor(prisma, e.id)).toBe(0);

      // A fresh worker recovers it.
      const fresh = worker([effectHandler('r22.hungstop', 'r22.hungstop', userId)]);
      await fresh.w.runOnce();
      expect((await row(e.id)).status).toBe('PROCESSED');
      expect(await effectsFor(prisma, e.id)).toBe(1);
    });
  });
});
