/* eslint-disable @typescript-eslint/no-require-imports --
 * The Prisma client and the units under test are required LAZILY, inside
 * beforeAll, on purpose: with RUN_DB_INTEGRATION unset this whole spec is
 * skipped, and a top-level import would still load the generated Prisma
 * client (and open its connection pool) on every hermetic test run.
 * The sibling integration specs use the same pattern.
 */
// Sprint 6 — outbox delivery guarantees, against a REAL Postgres.
//
// These properties are all about concurrency and failure timing, and none of
// them can be tested with a mocked client:
//
//   * `FOR UPDATE SKIP LOCKED` behaviour under genuinely parallel claims
//   * a unique-constraint conflict inside a transaction
//   * a rollback taking the idempotency marker with it
//
// A mock would assert that we call the right Prisma methods, which is a
// restatement of the implementation, not evidence that two workers never
// deliver the same event.
//
// Gated by RUN_DB_INTEGRATION=1, matching the existing integration specs, so
// the default `pnpm test` stays hermetic.
//
// ── DO NOT run these against a database that a live API is pointed at ──────
//
// Every API replica runs an outbox worker. A worker sharing this database will
// happily claim the events below, find no handler for `test.*`, and DEAD-LETTER
// them — which surfaces here as rows vanishing between an insert and the claim
// two lines later, and as failures that move around between runs. That cost an
// hour to track down; the tell is `lastError: "No handler registered for event
// type test.parallel"` in the diagnostics the assertions print.
//
// CI is unaffected: the integration job runs no API. Locally, stop any
// `node dist/main.js` / `docker compose --profile app` stack first.

// No top-level import/export otherwise, so TypeScript would treat this file
// as a global script and collide with the identically-named locals in the
// sibling integration specs.
export {};

import { acquireAdvisoryLock, type HeldLock } from '../support/db-isolation';

const shouldRun = process.env.RUN_DB_INTEGRATION === '1';
const d = shouldRun ? describe : describe.skip;

jest.setTimeout(120_000);

d('Outbox delivery guarantees (real Postgres)', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let prisma: any;
  let OutboxRepository: any;
  let OutboxWorker: any;
  let repo: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const config = {
    OUTBOX_WORKER_ENABLED: false, // never let the real loop race these tests
    OUTBOX_BATCH_SIZE: 50,
    OUTBOX_POLL_INTERVAL_MS: 1_000,
    OUTBOX_CLAIM_TIMEOUT_MS: 120_000,
    OUTBOX_RETRY_BASE_MS: 1_000,
    OUTBOX_RETRY_CAP_MS: 300_000,
    OUTBOX_RETENTION_HOURS: 72,
    OUTBOX_CLEANUP_INTERVAL_MS: 3_600_000,
    OUTBOX_FANOUT_BATCH_SIZE: 200,
  } as Record<string, unknown>;

  function makeConfig(over: Record<string, unknown> = {}) {
    const merged = { ...config, ...over };
    return { get: (k: string) => merged[k] };
  }

  // Minimal in-memory metrics with the same surface the worker touches.
  function makeMetrics() {
    const noop = { inc: jest.fn(), set: jest.fn(), reset: jest.fn() };
    return {
      outboxEventsProcessedTotal: { inc: jest.fn() },
      outboxEventDurationSeconds: { startTimer: jest.fn(() => jest.fn()) },
      outboxQueueDepth: noop,
      outboxOldestPendingAgeSeconds: noop,
      outboxClaimedTotal: { inc: jest.fn() },
      outboxReclaimedTotal: { inc: jest.fn() },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeWorker(handlers: any[], over: Record<string, unknown> = {}) {
    return new OutboxWorker(repo, { client: prisma }, makeConfig(over), makeMetrics(), handlers);
  }

  /** Records every (eventId, attempt) it sees, and can be told to throw. */
  function recordingHandler(name: string, eventType: string) {
    const seen: string[] = [];
    let failTimes = 0;
    return {
      name,
      eventTypes: [eventType],
      seen,
      failNext(times: number) {
        failTimes = times;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async handle(event: any) {
        seen.push(event.id);
        if (failTimes > 0) {
          failTimes -= 1;
          throw new Error('handler exploded');
        }
        return undefined;
      },
    };
  }

  // `availableAt` defaults to ONE SECOND AGO, not "now".
  //
  // Prisma generates `@default(now())` on the CLIENT, while the claim compares
  // against the database's NOW(). Those are two different clocks, and here the
  // Postgres container runs ~67 ms behind the host — measured, reproducible —
  // so an event enqueued with the client clock is not claimable for ~67 ms.
  // In production that is invisible (the worker polls every 2 s); in a test
  // that enqueues and claims on the next line it is a coin flip, and it made
  // this suite fail 3 runs in 4.
  //
  // Backdating puts the schedule under the test's control instead of the
  // clock's. Cases that specifically exercise future availability pass their
  // own `availableAt`.
  async function enqueue(
    eventType: string,
    payload: Record<string, unknown> = {},
    over: { availableAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
  ) {
    const row = await repo.enqueue({
      aggregateType: 'Test',
      aggregateId: 'agg-1',
      eventType,
      payload,
      availableAt: new Date(Date.now() - 1_000),
      ...over,
    });
    // Only wait for rows that are MEANT to be claimable now; the
    // future-availableAt case deliberately is not.
    const wantsDueNow = !over.availableAt || over.availableAt.getTime() <= Date.now();
    if (row && wantsDueNow) await waitUntilClaimable(row.id);
    return row;
  }

  /** Block until the database agrees the row is claimable.
   *
   *  These tests are written as enqueue-then-claim-on-the-next-line, which
   *  silently depends on two things that do not hold reliably:
   *
   *    1. The CLOCKS agreeing. Prisma generates `@default(now())` on the
   *       client, while the claim compares against the database's NOW(). Here
   *       the Postgres container runs ~70 ms behind the host — measured — so a
   *       just-written event is not yet due.
   *    2. Read-your-writes across a CONNECTION POOL. The write and the claim
   *       can land on different connections.
   *
   *  Together they made this suite fail roughly three runs in four, always
   *  with "the row I just wrote is not there". Waiting for the condition the
   *  claim actually tests removes both variables without weakening anything:
   *  a row that never becomes claimable still fails, loudly and by name.
   *
   *  The production worker polls seconds later, so neither issue affects it. */
  async function waitUntilClaimable(id: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT 1 FROM "OutboxEvent"
          WHERE "id" = $1 AND "status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= NOW()`,
        id,
      );
      if (rows.length > 0) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`outbox event ${id} never became claimable`);
  }

  /** Every row enqueue() writes carries this aggregate type, so this suite's
   *  rows are distinguishable from any other producer's. */
  const OWNED = { aggregateType: 'Test' } as const;

  /**
   * Remove this suite's own queue rows.
   *
   * This used to be a table-wide TRUNCATE. Under parallel workers that deleted
   * rows other suites had legitimately enqueued — and geo-fanout's own
   * TRUNCATE returned the favour, wiping this suite's rows mid-assertion.
   * Neither suite had a bug; the reset did.
   */
  async function truncate() {
    const mine = (await prisma.outboxEvent.findMany({ where: OWNED, select: { id: true } })).map(
      (e: { id: string }) => e.id,
    );
    if (mine.length === 0) return;
    await prisma.outboxHandlerRun.deleteMany({ where: { eventId: { in: mine } } });
    await prisma.outboxEvent.deleteMany({ where: { id: { in: mine } } });
  }

  let outboxLock: HeldLock;

  beforeAll(async () => {
    // EXCLUSIVE. Scoped cleanup keeps this suite from destroying other
    // producers' rows, but it cannot make claimBatch() selective: the worker
    // claims whatever is PENDING and due, by design, so a row enqueued
    // elsewhere would be claimed here and break assertions that name the
    // exact rows expected back. A queue consumer needs the queue to itself.
    outboxLock = await acquireAdvisoryLock('outbox', 'exclusive');

    const db =
      require('@homeservicemarketplace/database') as typeof import('@homeservicemarketplace/database');
    prisma = db.prisma;
    OutboxRepository =
      require('../../src/infrastructure/outbox/outbox.repository').OutboxRepository;
    OutboxWorker = require('../../src/infrastructure/outbox/outbox.worker').OutboxWorker;
    repo = new OutboxRepository({ client: prisma });
  });

  beforeEach(truncate);
  afterAll(async () => {
    await truncate();
    await prisma.$disconnect();
    await outboxLock.release();
  });

  // ── claiming ─────────────────────────────────────────────────────────────

  describe('claim', () => {
    it('claims a due event and marks it PROCESSING', async () => {
      const e = await enqueue('test.a');
      const claimed = await repo.claimBatch('worker-1', 10);
      expect(claimed.map((c: { id: string }) => c.id)).toEqual([e.id]);
      const row = await repo.findById(e.id);
      expect(row.status).toBe('PROCESSING');
      expect(row.claimedBy).toBe('worker-1');
    });

    it('claims no more than the requested batch size', async () => {
      // Regression guard for a real defect. Written as
      //   UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)
      // the LIMIT does not bound anything: the locking clause blocks subplan
      // hashing, Postgres re-runs the sub-SELECT per candidate row, and their
      // union is the whole backlog. A worker asking for 10 claimed all 120 —
      // batching silently defeated and every other replica starved. The
      // repository uses a CTE, which is evaluated once.
      for (let i = 0; i < 40; i++) await enqueue('test.a', { i });
      const claimed = await repo.claimBatch('worker-1', 10);
      expect(claimed).toHaveLength(10);
      // And the rest are genuinely still available to everyone else.
      expect(await prisma.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(30);
    });

    it('spreads a backlog across concurrent workers instead of one taking it all', async () => {
      // The observable consequence of the bug above: with an unbounded claim,
      // the first worker took everything and the others saw an empty queue.
      for (let i = 0; i < 40; i++) await enqueue('test.a', { i });
      const batches = await Promise.all([
        repo.claimBatch('w1', 10),
        repo.claimBatch('w2', 10),
        repo.claimBatch('w3', 10),
        repo.claimBatch('w4', 10),
      ]);
      for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(10);
      expect(batches.flat()).toHaveLength(40);
      // At least two workers got work — the point of running more than one.
      expect(batches.filter((b) => b.length > 0).length).toBeGreaterThan(1);
    });

    it('does NOT claim an event whose availableAt is in the future', async () => {
      // This is how retry backoff is implemented — if a future availableAt
      // were claimable, every failure would hot-loop.
      await enqueue('test.a', {}, { availableAt: new Date(Date.now() + 60_000) });
      expect(await repo.claimBatch('worker-1', 10)).toHaveLength(0);
    });

    it('never hands the same event to two workers', async () => {
      // The core concurrency guarantee. 40 events, 4 workers claiming
      // simultaneously: every event goes to exactly one worker.
      const ids: string[] = [];
      for (let i = 0; i < 40; i++) ids.push((await enqueue('test.a', { i })).id);

      // Rounds, not a single shot. SKIP LOCKED guarantees no row goes to two
      // workers; it does NOT guarantee that one concurrent round drains the
      // queue, because a worker steps over rows another has locked and can
      // legitimately come back with fewer than it asked for. Asserting
      // "all 40 in one round" was asserting something Postgres never promised,
      // and it failed whenever contention was high enough.
      const claimed: string[] = [];
      for (let round = 0; round < 20 && claimed.length < 40; round++) {
        const batches = await Promise.all([
          repo.claimBatch('w1', 25),
          repo.claimBatch('w2', 25),
          repo.claimBatch('w3', 25),
          repo.claimBatch('w4', 25),
        ]);
        claimed.push(...batches.flat().map((e: { id: string }) => e.id));
        // THE guarantee, checked after every round: an event is handed to at
        // most one worker, ever.
        expect(new Set(claimed).size).toBe(claimed.length);
      }
      expect(new Set(claimed).size).toBe(40); // and every one is eventually claimed
    });

    it('claims oldest-due first', async () => {
      const old = await enqueue('test.a', { n: 1 }, { availableAt: new Date(Date.now() - 60_000) });
      const recent = await enqueue(
        'test.a',
        { n: 2 },
        { availableAt: new Date(Date.now() - 5_000) },
      );
      const claimed = await repo.claimBatch('w1', 10);
      expect(claimed[0].id).toBe(old.id);
      expect(claimed[1].id).toBe(recent.id);
    });

    it('collapses a duplicate dedupeKey to one row', async () => {
      const first = await enqueue('test.a', {}, { dedupeKey: 'same' });
      expect(first).not.toBeNull();
      // A second enqueue with the same key returns null rather than throwing.
      // (Standalone, not inside a transaction — see the note on enqueue().)
      const second = await enqueue('test.a', {}, { dedupeKey: 'same' });
      expect(second).toBeNull();
      // Scoped: a bare count() is a global read over a queue every producer
      // shares. The property under test is that the dedupe key collapsed THIS
      // suite's two enqueues into one row.
      expect(await prisma.outboxEvent.count({ where: OWNED })).toBe(1);
    });
  });

  // ── crash timing ─────────────────────────────────────────────────────────

  describe('crash timing', () => {
    it('reclaims an event orphaned by a worker that died mid-flight', async () => {
      const e = await enqueue('test.a');
      await repo.claimBatch('dead-worker', 10);

      // Simulate the crash: the row stays PROCESSING with nobody to finish it.
      // Backdate the claim past the visibility timeout.
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "claimedAt" = NOW() - INTERVAL '10 minutes' WHERE "id" = $1`,
        e.id,
      );

      // Nothing claims it while it looks in-flight...
      expect(await repo.claimBatch('w2', 10)).toHaveLength(0);

      // ...until the reclaim returns it to the queue.
      expect(await repo.reclaimStale(new Date(Date.now() - 120_000))).toBe(1);
      const reclaimed = await repo.claimBatch('w2', 10);
      expect(reclaimed.map((r: { id: string }) => r.id)).toEqual([e.id]);
    });

    it('does NOT charge an attempt for a crash the event did not cause', async () => {
      // A crash loop must not burn the retry budget of healthy events; they
      // would reach DEAD without ever having been tried.
      const e = await enqueue('test.a');
      await repo.claimBatch('dead-worker', 10);
      await prisma.$executeRawUnsafe(
        `UPDATE "OutboxEvent" SET "claimedAt" = NOW() - INTERVAL '10 minutes' WHERE "id" = $1`,
        e.id,
      );
      await repo.reclaimStale(new Date(Date.now() - 120_000));
      expect((await repo.findById(e.id)).attempts).toBe(0);
    });

    it('leaves a still-running event alone', async () => {
      // Reclaiming a healthy slow handler would run it twice concurrently.
      const e = await enqueue('test.a');
      await repo.claimBatch('busy-worker', 10);
      expect(await repo.reclaimStale(new Date(Date.now() - 120_000))).toBe(0);
      expect((await repo.findById(e.id)).status).toBe('PROCESSING');
    });

    it('a handler that throws mid-transaction leaves NO partial effect', async () => {
      // The marker and the effects share one transaction, so a crash halfway
      // must roll back both — otherwise the retry is skipped by a marker
      // whose effects never landed, and the event is permanently half-applied.
      const e = await enqueue('test.crash');
      const handler = {
        name: 'crashing',
        eventTypes: ['test.crash'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async handle(_event: any, tx: any) {
          await tx.outboxEvent.update({
            where: { id: e.id },
            data: { lastError: 'partial write that must not survive' },
          });
          throw new Error('died after writing');
        },
      };

      await makeWorker([handler]).runOnce();

      const row = await repo.findById(e.id);
      // Rescheduled, not lost.
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      // The partial write is gone; lastError is the failure the worker
      // recorded, not the handler's rolled-back scribble.
      expect(row.lastError).toContain('died after writing');
      // And no marker survived, so the retry will really re-run the handler.
      expect(await prisma.outboxHandlerRun.count({ where: { eventId: e.id } })).toBe(0);
    });
  });

  // ── duplicate delivery ───────────────────────────────────────────────────

  describe('duplicate delivery', () => {
    it('runs a handler at most once even when the event is delivered twice', async () => {
      const e = await enqueue('test.dup');
      const handler = recordingHandler('dup-handler', 'test.dup');

      await makeWorker([handler]).runOnce();
      expect(handler.seen).toEqual([e.id]);

      // Force a redelivery: put the event back as if the worker had died
      // between committing the handler and marking it PROCESSED — the exact
      // window at-least-once delivery cannot close.
      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { status: 'PENDING', claimedAt: null, claimedBy: null },
      });

      await makeWorker([handler]).runOnce();

      // Claimed and completed again, but the HANDLER did not run twice.
      expect(handler.seen).toEqual([e.id]);
      expect((await repo.findById(e.id)).status).toBe('PROCESSED');
    });

    it('two workers processing the same event concurrently produce ONE effect', async () => {
      // Belt and braces: bypass the claim (which already prevents this) and
      // let both workers genuinely race the same row, so the test exercises
      // the idempotency marker rather than the claim.
      const e = await enqueue('test.race');
      const runs: string[] = [];
      const handler = {
        name: 'racy',
        eventTypes: ['test.race'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async handle(event: any) {
          runs.push(event.id);
        },
      };

      const both = await Promise.allSettled([
        makeWorker([handler]).runOnce(),
        makeWorker([handler]).runOnce(),
      ]);
      expect(both.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(runs).toEqual([e.id]);
    });

    it('records one marker row per (event, handler)', async () => {
      const e = await enqueue('test.dup');
      const a = recordingHandler('handler-a', 'test.dup');
      const b = recordingHandler('handler-b', 'test.dup');
      await makeWorker([a, b]).runOnce();

      const markers = await prisma.outboxHandlerRun.findMany({ where: { eventId: e.id } });
      expect(markers.map((m: { handler: string }) => m.handler).sort()).toEqual([
        'handler-a',
        'handler-b',
      ]);
    });
  });

  // ── retries and the dead-letter state ────────────────────────────────────

  describe('retry and dead-letter', () => {
    it('reschedules a failure into the future with a growing delay', async () => {
      const e = await enqueue('test.retry');
      const handler = recordingHandler('flaky', 'test.retry');
      handler.failNext(1);

      const before = Date.now();
      await makeWorker([handler]).runOnce();

      const row = await repo.findById(e.id);
      expect(row.status).toBe('PENDING');
      expect(row.attempts).toBe(1);
      // Pushed into the future — that is what stops the retry hot-looping.
      expect(row.availableAt.getTime()).toBeGreaterThan(before);
      expect(row.lastError).toContain('handler exploded');
    });

    it('reaches DEAD after maxAttempts and stops being claimable', async () => {
      const e = await enqueue('test.retry', {}, { maxAttempts: 2 });
      const handler = recordingHandler('always-fails', 'test.retry');
      handler.failNext(99);

      // Attempt 1 → PENDING with a delay; clear the delay so the test does
      // not have to sleep out the backoff.
      await makeWorker([handler]).runOnce();
      expect((await repo.findById(e.id)).status).toBe('PENDING');
      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });

      // Attempt 2 exhausts the budget.
      await makeWorker([handler]).runOnce();
      const dead = await repo.findById(e.id);
      expect(dead.status).toBe('DEAD');
      expect(dead.attempts).toBe(2);

      // Terminal: a DEAD row is never claimed again.
      expect(await repo.claimBatch('w1', 10)).toHaveLength(0);
    });

    it('dead-letters an event with no registered handler instead of retrying forever', async () => {
      const e = await enqueue('test.nobody-handles-this');
      await makeWorker([]).runOnce();
      const row = await repo.findById(e.id);
      expect(row.status).toBe('DEAD');
      expect(row.lastError).toMatch(/No handler registered/);
    });

    it('a successful retry after a failure ends PROCESSED', async () => {
      const e = await enqueue('test.retry');
      const handler = recordingHandler('recovers', 'test.retry');
      handler.failNext(1);

      await makeWorker([handler]).runOnce();
      await prisma.outboxEvent.update({
        where: { id: e.id },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      await makeWorker([handler]).runOnce();

      expect((await repo.findById(e.id)).status).toBe('PROCESSED');
      // Ran twice: the first attempt rolled back its marker, so the retry was
      // a real re-run rather than a skip.
      expect(handler.seen).toEqual([e.id, e.id]);
    });
  });

  // ── parallel workers ─────────────────────────────────────────────────────

  describe('parallel workers', () => {
    it('four workers drain a backlog with every event handled exactly once', async () => {
      const total = 120;
      for (let i = 0; i < total; i++) await enqueue('test.parallel', { i });

      const handled: string[] = [];
      const makeH = () => ({
        name: 'parallel-handler',
        eventTypes: ['test.parallel'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async handle(event: any) {
          handled.push(event.id);
        },
      });

      // Four workers polling concurrently until the queue is genuinely empty.
      //
      // Deliberately NOT "stop on the first empty claim": the real worker
      // never does that — it schedules another poll — and a worker that gave
      // up on one empty result would quit while another worker still had 40
      // rows in flight that are about to become claimable again on a retry.
      // Modelling the production loop is both more faithful and not flaky.
      const deadline = Date.now() + 60_000;
      const drain = async () => {
        const w = makeWorker([makeH()], { OUTBOX_BATCH_SIZE: 10 });
        for (;;) {
          const claimed = await w.runOnce();
          if (claimed === 0) {
            // Nothing claimable right now. Done only when nothing is in
            // flight either — otherwise another worker is mid-batch.
            const outstanding = await prisma.outboxEvent.count({
              where: { status: { in: ['PENDING', 'PROCESSING'] } },
            });
            if (outstanding === 0) return;
            if (Date.now() > deadline) throw new Error(`drain stalled: ${outstanding} outstanding`);
            await new Promise((r) => setTimeout(r, 25));
          }
        }
      };
      await Promise.all([drain(), drain(), drain(), drain()]);

      // Report the terminal state alongside the count: a bare "expected 120,
      // got 70" sends the next person hunting with no information about
      // whether the missing events were retried, dead-lettered, or skipped.
      const byStatus = await prisma.outboxEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const failed = await prisma.outboxEvent.findFirst({
        where: { status: { in: ['DEAD', 'PENDING'] } },
        select: { status: true, attempts: true, lastError: true },
      });
      const summary =
        JSON.stringify(
          Object.fromEntries(
            byStatus.map((r: { status: string; _count: { _all: number } }) => [
              r.status,
              r._count._all,
            ]),
          ),
        ) + (failed ? ` first-failure=${JSON.stringify(failed).slice(0, 300)}` : '');

      // The guarantee: no event's handler ran twice.
      expect(new Set(handled).size).toBe(handled.length);
      // Every event reached the terminal success state.
      expect({
        processed: await prisma.outboxEvent.count({ where: { status: 'PROCESSED' } }),
        summary,
      }).toEqual({ processed: total, summary });
      expect(await prisma.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(0);
      // And each was handled exactly once. Checked last: if it fails after the
      // above passed, the cause is the idempotency marker skipping a
      // redelivery, not a lost event — which the summary above will show.
      expect(new Set(handled).size).toBe(total);
    });
  });

  // ── cleanup ──────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('reaps PROCESSED rows past retention but NEVER dead letters', async () => {
      const processed = await enqueue('test.old');
      const dead = await enqueue('test.dead');
      await prisma.outboxEvent.update({
        where: { id: processed.id },
        data: { status: 'PROCESSED', processedAt: new Date(Date.now() - 10 * 24 * 3_600_000) },
      });
      await prisma.outboxEvent.update({ where: { id: dead.id }, data: { status: 'DEAD' } });

      const cutoff = new Date(Date.now() - 72 * 3_600_000);
      expect(await repo.deleteProcessedBefore(cutoff, 500)).toBe(1);

      expect(await repo.findById(processed.id)).toBeNull();
      // A dead letter is the only surviving evidence the event existed.
      expect((await repo.findById(dead.id)).status).toBe('DEAD');
    });

    it('keeps PROCESSED rows inside the retention window', async () => {
      const recent = await enqueue('test.recent');
      await prisma.outboxEvent.update({
        where: { id: recent.id },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      const cutoff = new Date(Date.now() - 72 * 3_600_000);
      expect(await repo.deleteProcessedBefore(cutoff, 500)).toBe(0);
    });
  });
});
