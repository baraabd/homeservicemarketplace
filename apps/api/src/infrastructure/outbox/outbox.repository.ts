import { Injectable } from '@nestjs/common';
import { Prisma, type OutboxEvent, type PrismaTx } from '@homeservicemarketplace/database';

import { PrismaService } from '../prisma/prisma.service';

/** What a producer supplies. The producer never picks a status, an attempt
 *  count, or a claim — those belong to the worker's state machine. */
export interface EnqueueOutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonValue;
  /** Producer-side idempotency. Two enqueues of the same logical event
   *  collapse to one row instead of fanning out twice. */
  dedupeKey?: string | null;
  maxAttempts?: number;
  /** Delay before the event first becomes claimable. */
  availableAt?: Date;
}

// Sprint 6 — outbox persistence. See docs/adr/0004-transactional-outbox.md.
@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: PrismaTx) {
    return tx ?? this.prisma.client;
  }

  /** Append an event.
   *
   *  MUST be called with the `tx` of the domain mutation it describes. That is
   *  the entire point: the event and the state change commit together, so
   *  there is no window in which one exists without the other.
   *
   *  Returns null when `dedupeKey` collided — the event is already enqueued,
   *  which is a success, not an error. */
  async enqueue(input: EnqueueOutboxEvent, tx?: PrismaTx): Promise<OutboxEvent | null> {
    try {
      return await this.db(tx).outboxEvent.create({
        data: {
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          eventType: input.eventType,
          payload: input.payload,
          dedupeKey: input.dedupeKey ?? null,
          ...(input.maxAttempts != null ? { maxAttempts: input.maxAttempts } : {}),
          ...(input.availableAt ? { availableAt: input.availableAt } : {}),
        },
      });
    } catch (err) {
      // P2002 = unique violation on dedupeKey. The caller asked for this event
      // to exist exactly once and it does.
      //
      // NOTE for callers inside a transaction: Postgres aborts the whole
      // transaction on a constraint violation, so swallowing the error here
      // does NOT make the surrounding tx usable again. A producer that may
      // legitimately collide must therefore pass a dedupeKey it has already
      // checked, or enqueue outside the critical path. Every current producer
      // uses a key derived from a freshly-created row's id, which cannot
      // collide.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null;
      }
      throw err;
    }
  }

  /** Atomically claim up to `limit` due events for one worker.
   *
   *  The whole concurrency story is in this one statement:
   *
   *    FOR UPDATE SKIP LOCKED  — a second worker running the same statement
   *      steps over rows this one has locked instead of blocking on them, so
   *      N workers drain the backlog in parallel with zero coordination and
   *      no row is ever handed to two of them.
   *
   *    UPDATE ... RETURNING    — claiming and reading are one statement, so
   *      there is no read-then-write gap for a competitor to win.
   *
   *    status = PENDING        — re-checked inside the UPDATE, closing the
   *      race where the subquery selected a row that another worker claimed
   *      between the SELECT and the UPDATE.
   *
   *  Ordered by availableAt so the oldest due work goes first; `id` breaks
   *  ties deterministically, which keeps the ordering stable when a batch is
   *  enqueued inside one transaction and every row shares a timestamp.
   *
   *  The CTE is load-bearing, not style. Written the obvious way —
   *  `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)` —
   *  the LIMIT does NOT bound the claim: the row-locking clause stops Postgres
   *  hashing the subplan, so it re-executes the sub-SELECT for each candidate
   *  row of the outer UPDATE and their union covers the whole backlog. A
   *  worker asking for 10 was observed claiming all 120 rows, which silently
   *  defeats batching and starves every other replica. A CTE is evaluated
   *  once, so the LIMIT means what it says. Pinned by
   *  "claims no more than the requested batch size" in the integration spec. */
  claimBatch(workerId: string, limit: number): Promise<OutboxEvent[]> {
    return this.prisma.client.$queryRaw<OutboxEvent[]>`
      WITH claimed AS (
        SELECT c."id"
        FROM "OutboxEvent" AS c
        WHERE c."status" = 'PENDING'::"OutboxStatus"
          AND c."availableAt" <= NOW()
        ORDER BY c."availableAt" ASC, c."id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "OutboxEvent" AS e
      SET "status"    = 'PROCESSING'::"OutboxStatus",
          "claimedAt" = NOW(),
          "claimedBy" = ${workerId},
          "updatedAt" = NOW()
      FROM claimed
      WHERE e."id" = claimed."id"
        AND e."status" = 'PENDING'::"OutboxStatus"
      RETURNING e.*;
    `;
  }

  /** Return events orphaned by a crashed worker to the queue.
   *
   *  A process killed between claiming and completing leaves its rows in
   *  PROCESSING forever — claimed by a worker that no longer exists. Nothing
   *  else will ever pick them up, so without this they are silently lost, which
   *  is exactly the failure mode the outbox exists to eliminate.
   *
   *  The visibility timeout must exceed the longest plausible handler run;
   *  reclaiming too eagerly means two workers process one event concurrently.
   *  That is survivable — handler idempotency covers it — but it is wasted
   *  work, so the default is deliberately generous.
   *
   *  R22 — compares the database-stamped claimedAt against an APPLICATION
   *  clock cutoff. The worker uses `reclaimExpired`, which judges both on the
   *  database clock; this remains for callers that pass an explicit cutoff.
   *
   *  Attempts are NOT incremented: the event was never actually tried, and
   *  charging it an attempt would let a crash loop burn the retry budget of
   *  events that are perfectly healthy. */
  reclaimStale(olderThan: Date): Promise<number> {
    return this.prisma.client.outboxEvent
      .updateMany({
        where: { status: 'PROCESSING', claimedAt: { lt: olderThan } },
        data: { status: 'PENDING', claimedAt: null, claimedBy: null },
      })
      .then((r) => r.count);
  }

  // R22 — the unfenced markProcessed/markFailed were removed. Every worker
  // transition on a claim now goes through completeLeased/failLeased below,
  // which only act while the caller still holds the lease.

  /** Delete PROCESSED rows older than the cutoff, in bounded chunks.
   *
   *  Chunked because an unbounded DELETE on a large backlog takes a long lock
   *  and bloats WAL. DEAD rows are never reaped — a dead letter is the only
   *  surviving evidence that the event existed, and deleting it destroys the
   *  thing an operator needs. */
  async deleteProcessedBefore(cutoff: Date, chunkSize: number): Promise<number> {
    const rows = await this.prisma.client.outboxEvent.findMany({
      where: { status: 'PROCESSED', processedAt: { lt: cutoff } },
      select: { id: true },
      take: chunkSize,
    });
    if (rows.length === 0) return 0;
    const result = await this.prisma.client.outboxEvent.deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });
    return result.count;
  }

  /** Queue depth by status — the gauge the worker publishes each tick. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.client.outboxEvent.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  /** Age of the oldest claimable event, in seconds.
   *
   *  The single most useful outbox alarm. Queue DEPTH is ambiguous — a big
   *  backlog draining fast is fine — but a rising oldest-age means throughput
   *  has fallen behind arrivals, which is always worth waking someone for. */
  async oldestPendingAgeSeconds(): Promise<number> {
    const oldest = await this.prisma.client.outboxEvent.findFirst({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: { availableAt: 'asc' },
      select: { availableAt: true },
    });
    if (!oldest) return 0;
    return Math.max(0, (Date.now() - oldest.availableAt.getTime()) / 1000);
  }

  /** Claim the handler-run marker for (event, handler).
   *
   *  Returns false when the marker already exists — this handler has already
   *  run for this event and must not run again.
   *
   *  MUST be called with the handler's own `tx`, so the marker and the
   *  handler's effects commit together. Called outside a transaction it
   *  degrades to "probably once", which is not the guarantee anyone wants.
   *
   *  R22 — `ON CONFLICT DO NOTHING` rather than catching P2002. Postgres
   *  aborts the whole transaction on a unique violation, so the old
   *  catch-and-return-false left `tx` unusable: any later statement in the
   *  same delivery (a second handler, the lease-fenced completion) failed with
   *  "current transaction is aborted". The upsert form reports the duplicate
   *  without poisoning the transaction, and it still waits on a concurrent
   *  uncommitted insert of the same key, so two racing deliveries serialise on
   *  the marker exactly as before. */
  async claimHandlerRun(eventId: string, handler: string, tx: PrismaTx): Promise<boolean> {
    const inserted = await tx.$executeRaw`
      INSERT INTO "OutboxHandlerRun" ("eventId", "handler")
      VALUES (${eventId}, ${handler})
      ON CONFLICT ("eventId", "handler") DO NOTHING
    `;
    return inserted === 1;
  }

  // ── R22: lease-fenced state transitions ───────────────────────────────────
  //
  // A claim is a lease: (status = PROCESSING, claimedBy = <worker>). Every
  // transition a worker makes on its own claim is conditional on still holding
  // that lease. Before R22 they were keyed on `id` alone, so a worker whose
  // claim had been reclaimed (it was slow, partitioned, or paused) could
  // overwrite the NEW owner's result — turning a PROCESSED event back into
  // PENDING, or dead-lettering an event someone else had just delivered.
  //
  // All lease timing uses the DATABASE clock (NOW()). `claimBatch` already
  // stamps `claimedAt` with NOW(); comparing it against an application-side
  // `Date.now()` meant a replica whose clock ran ahead of Postgres reclaimed
  // live claims early. One clock removes the skew class entirely.

  /** Return orphaned claims to the queue, judged by the database clock.
   *  Supersedes `reclaimStale` for the worker; attempts are not charged. */
  reclaimExpired(timeoutMs: number): Promise<number> {
    return this.prisma.client.$executeRaw`
      UPDATE "OutboxEvent"
      SET "status" = 'PENDING'::"OutboxStatus",
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "updatedAt" = NOW()
      WHERE "status" = 'PROCESSING'::"OutboxStatus"
        AND "claimedAt" < NOW() - make_interval(secs => ${timeoutMs / 1000}::double precision)
    `;
  }

  /** Extend every lease this worker still holds. Returns how many rows it
   *  touched. A row that was reclaimed or released is NOT re-acquired: the
   *  heartbeat only renews, it never steals. */
  heartbeat(workerId: string): Promise<number> {
    return this.prisma.client.$executeRaw`
      UPDATE "OutboxEvent"
      SET "claimedAt" = NOW(), "updatedAt" = NOW()
      WHERE "status" = 'PROCESSING'::"OutboxStatus"
        AND "claimedBy" = ${workerId}
    `;
  }

  /** Mark the event PROCESSED inside the delivery transaction, if and only if
   *  this worker still holds its lease. Returns false when the lease is gone;
   *  the caller must then abort the transaction so the handlers' effects roll
   *  back with it. Committing the terminal state together with the effects
   *  also closes the old window where effects had committed but the event was
   *  still PROCESSING. */
  async completeLeased(id: string, workerId: string, tx: PrismaTx): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE "OutboxEvent"
      SET "status" = 'PROCESSED'::"OutboxStatus",
          "processedAt" = NOW(),
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "lastError" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = ${id}
        AND "status" = 'PROCESSING'::"OutboxStatus"
        AND "claimedBy" = ${workerId}
    `;
    return updated === 1;
  }

  /** Record a failed attempt on a leased event: back to PENDING after
   *  `delayMs` (database clock), or DEAD when `delayMs` is null. Returns false
   *  when the lease is gone — the failure is then NOT recorded, because the
   *  event now belongs to another worker and charging it an attempt for this
   *  worker's stale run would be wrong. */
  async failLeased(
    id: string,
    workerId: string,
    attempts: number,
    error: string,
    delayMs: number | null,
  ): Promise<boolean> {
    const dead = delayMs === null;
    const updated = await this.prisma.client.$executeRaw`
      UPDATE "OutboxEvent"
      SET "status" = ${dead ? 'DEAD' : 'PENDING'}::"OutboxStatus",
          "attempts" = ${attempts},
          "lastError" = ${error.slice(0, 2000)},
          "availableAt" = NOW() + make_interval(secs => ${(delayMs ?? 0) / 1000}::double precision),
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = ${id}
        AND "status" = 'PROCESSING'::"OutboxStatus"
        AND "claimedBy" = ${workerId}
    `;
    return updated === 1;
  }

  /** Hand back this worker's claims that it will not process (graceful
   *  shutdown). Only rows still leased to `workerId` are touched; attempts are
   *  not charged because nothing was tried. Releasing an event whose delivery
   *  is still running is safe: that delivery's fenced completion then fails
   *  and rolls back. */
  releaseClaims(workerId: string): Promise<number> {
    return this.prisma.client.$executeRaw`
      UPDATE "OutboxEvent"
      SET "status" = 'PENDING'::"OutboxStatus",
          "claimedAt" = NULL,
          "claimedBy" = NULL,
          "updatedAt" = NOW()
      WHERE "status" = 'PROCESSING'::"OutboxStatus"
        AND "claimedBy" = ${workerId}
    `;
  }

  findById(id: string): Promise<OutboxEvent | null> {
    return this.prisma.client.outboxEvent.findUnique({ where: { id } });
  }
}
