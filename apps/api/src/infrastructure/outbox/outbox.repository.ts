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

  /** Mark an event delivered. Terminal and successful. */
  async markProcessed(id: string, tx?: PrismaTx): Promise<void> {
    await this.db(tx).outboxEvent.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        claimedAt: null,
        claimedBy: null,
        lastError: null,
      },
    });
  }

  /** Record a failed attempt: back to PENDING with a future `availableAt`, or
   *  DEAD once the budget is spent.
   *
   *  `attempts` is incremented here rather than at claim time so a reclaimed
   *  orphan is not charged for a crash it did not cause. */
  async markFailed(
    id: string,
    attempts: number,
    error: string,
    nextAttemptAt: Date | null,
  ): Promise<void> {
    const dead = nextAttemptAt === null;
    await this.prisma.client.outboxEvent.update({
      where: { id },
      data: {
        status: dead ? 'DEAD' : 'PENDING',
        attempts,
        // Truncated: a driver stack trace can be tens of kilobytes and this
        // column is read by operators, not machines.
        lastError: error.slice(0, 2000),
        availableAt: nextAttemptAt ?? new Date(),
        claimedAt: null,
        claimedBy: null,
      },
    });
  }

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
   *  degrades to "probably once", which is not the guarantee anyone wants. */
  async claimHandlerRun(eventId: string, handler: string, tx: PrismaTx): Promise<boolean> {
    try {
      await tx.outboxHandlerRun.create({ data: { eventId, handler } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  findById(id: string): Promise<OutboxEvent | null> {
    return this.prisma.client.outboxEvent.findUnique({ where: { id } });
  }
}
