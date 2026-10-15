import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OutboxEvent } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../telemetry/metrics.service';
import { OUTBOX_HANDLERS } from './outbox.tokens';
import { OutboxRepository } from './outbox.repository';
import { nextAttemptDelayMs, type RetryPolicy } from './outbox.retry';
import {
  classifyOutboxFailure,
  OutboxDeadlineExceededError,
  OutboxLeaseLostError,
  retryAfterHintMs,
} from './outbox.errors';
import {
  validateHandlerRegistry,
  type OutboxHandler,
  type OutboxHandlerResult,
} from './outbox.handler';

/** R22 — delivery timing defaults. Each can be overridden by the environment
 *  variable of the same name once the coordinator adds it to env.schema.ts
 *  (docs/production-readiness/r22/shared-change-requests/CR-02-env-keys.md);
 *  until then an unset or invalid value falls back to these.
 *
 *  Transaction timeout: Prisma's interactive-transaction default is 5 s, which
 *  was the de facto handler limit before R22 without anyone having chosen it.
 *  The deadline sits a little above it so Prisma's own timeout normally fires
 *  first and the worker deadline only catches a callback stuck on a non-DB
 *  await (a hung HTTP call), which Prisma's timer cannot interrupt. */
export const OUTBOX_DELIVERY_TX_TIMEOUT_MS = 15_000;
export const OUTBOX_DELIVERY_DEADLINE_MS = 20_000;
/** How long shutdown waits for the in-flight delivery before releasing this
 *  worker's claims. Below the usual 30 s container stop grace period. */
export const OUTBOX_SHUTDOWN_GRACE_MS = 20_000;

// Sprint 6 — the outbox worker. See docs/adr/0004-transactional-outbox.md.
//
// Deliberately a plain timer loop rather than BullMQ / @nestjs/schedule:
//
//   * The queue is a Postgres table we already have, and `FOR UPDATE SKIP
//     LOCKED` already gives safe multi-worker claiming. A broker would add a
//     second durable store that can disagree with the database — the exact
//     dual-write problem the outbox exists to remove.
//   * A dependency-free loop is testable by calling `runOnce()` directly. No
//     fake timers, no scheduler internals.
//
// Every replica runs one of these. They coordinate solely through the claim
// statement; there is no leader election, and none is needed.
//
// R22 — a claim is a LEASE (status PROCESSING + claimedBy). The worker renews
// its leases with a heartbeat while it holds them, commits PROCESSED inside the
// delivery transaction only while it still holds the lease, records failures
// only on its own lease, bounds each delivery with a deadline, and hands its
// unprocessed claims back on shutdown. Delivery stays at-least-once; exactly-
// once EFFECTS come from the handler-run marker and domain unique keys.
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxWorker.name);

  /** Identifies this worker in `claimedBy`. Instance-scoped, so a crashed
   *  worker's rows are attributable and its successor gets a fresh identity
   *  rather than inheriting orphaned claims. */
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  /** Resolves when an in-flight tick finishes — shutdown awaits it so a
   *  SIGTERM cannot tear down the process mid-handler and orphan a claim. */
  private inFlight: Promise<void> | null = null;
  /** Whether this worker ever claimed a row. A worker that never did — the
   *  disabled worker in every test AppModule, an idle replica — has nothing
   *  to release and must not touch the database during shutdown, when the
   *  Prisma client may already be disconnecting. */
  private hasClaimed = false;

  private readonly byEventType = new Map<string, OutboxHandler[]>();

  constructor(
    private readonly repo: OutboxRepository,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    @Inject(OUTBOX_HANDLERS) private readonly handlers: OutboxHandler[],
  ) {
    // R22 — fail the boot on a registration that would silently lose work
    // (duplicate marker names, a handler that consumes nothing).
    const problems = validateHandlerRegistry(this.handlers);
    if (problems.length > 0) {
      throw new Error(`Invalid outbox handler registry: ${problems.join('; ')}`);
    }
    for (const handler of this.handlers) {
      for (const type of handler.eventTypes) {
        const list = this.byEventType.get(type) ?? [];
        list.push(handler);
        this.byEventType.set(type, list);
      }
    }
  }

  /** This worker's lease identity. Exposed for operational tooling and tests. */
  get id(): string {
    return this.workerId;
  }

  onModuleInit(): void {
    if (!this.config.get('OUTBOX_WORKER_ENABLED')) {
      // Off is a supported state, not a degraded one: tests and one-shot
      // processes should not race a background loop. Say so once, loudly
      // enough that "why is nothing delivering" has an answer in the logs.
      this.log.warn('Outbox worker DISABLED (OUTBOX_WORKER_ENABLED=false); no events delivered');
      return;
    }
    this.log.log(
      `Outbox worker started (id=${this.workerId}, ` +
        `batch=${this.config.get('OUTBOX_BATCH_SIZE')}, ` +
        `poll=${this.config.get('OUTBOX_POLL_INTERVAL_MS')}ms, ` +
        `handlers=${this.handlers.map((h) => h.name).join(',') || 'none'})`,
    );
    this.scheduleNext(0);
  }

  /** Graceful shutdown (R22):
   *
   *    1. stop claiming — no new tick is scheduled and the batch loop exits
   *       before its next event;
   *    2. give the in-flight delivery a BOUNDED grace period to finish, so a
   *       hung handler cannot hold the process past its stop timeout;
   *    3. release every claim still leased to THIS worker, so the rest of the
   *       batch is immediately claimable by the surviving replicas instead of
   *       waiting out the visibility timeout. Another worker's leases are never
   *       touched. If the in-flight delivery is still running when its claim is
   *       released, its lease-fenced completion fails and it rolls back. */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.inFlight) {
      const graceMs = this.setting('OUTBOX_SHUTDOWN_GRACE_MS', OUTBOX_SHUTDOWN_GRACE_MS);
      let graceTimer: NodeJS.Timeout | undefined;
      const finished = await Promise.race([
        this.inFlight.then(
          () => true,
          () => true,
        ),
        new Promise<false>((resolve) => {
          graceTimer = setTimeout(() => resolve(false), graceMs);
          graceTimer.unref?.();
        }),
      ]);
      if (graceTimer) clearTimeout(graceTimer);
      if (!finished) {
        this.log.warn({ msg: 'outbox.shutdown.grace_exceeded', workerId: this.workerId, graceMs });
      }
    }
    if (!this.hasClaimed) return;
    try {
      const released = await this.repo.releaseClaims(this.workerId);
      if (released > 0) {
        this.log.log({ msg: 'outbox.shutdown.released', workerId: this.workerId, released });
      }
    } catch (err) {
      // The database may already be gone. The claims then expire through the
      // visibility timeout, which is the durable fallback.
      this.log.warn({ msg: 'outbox.shutdown.release_failed', err: String(err) });
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => {
        this.inFlight = null;
      });
    }, delayMs);
    // Do not hold the event loop open for a poll timer — otherwise a process
    // that has finished its work cannot exit.
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    let claimed = 0;
    try {
      claimed = await this.runOnce();
    } catch (err) {
      // A failure HERE is the loop itself failing (database unreachable), not
      // a handler failing. It must never kill the loop.
      this.log.error({ msg: 'outbox.tick.failed', err: String(err) });
    } finally {
      this.running = false;
      // Drain fast while there is a backlog, idle slowly when there is not.
      // A full batch almost certainly means more is waiting, so going straight
      // back round beats sleeping a poll interval per batch.
      const full = claimed >= this.config.get('OUTBOX_BATCH_SIZE');
      this.scheduleNext(full ? 0 : this.config.get('OUTBOX_POLL_INTERVAL_MS'));
    }
  }

  /** One full cycle: reclaim orphans, claim a batch, process it, publish
   *  gauges. Returns how many events were claimed.
   *
   *  Public so tests drive the worker deterministically instead of waiting on
   *  a timer. */
  async runOnce(): Promise<number> {
    await this.reclaimOrphans();

    const batchSize = this.config.get('OUTBOX_BATCH_SIZE');
    const events = await this.repo.claimBatch(this.workerId, batchSize);
    if (events.length > 0) {
      this.hasClaimed = true;
      this.metrics.outboxClaimedTotal.inc(events.length);
      // R22 — the batch is processed sequentially, so the LAST event in it
      // waits for every earlier one. Without renewal its claim could expire
      // while it is still queued here and a second worker would take it.
      const stopHeartbeat = this.startHeartbeat();
      try {
        // Sequential, not Promise.all. These handlers fan out to hundreds of
        // recipients each; running a whole batch concurrently multiplies the
        // connection-pool demand by the batch size and starves the HTTP path
        // sharing that pool. Throughput comes from more REPLICAS, which the
        // claim statement already supports safely.
        for (const event of events) {
          if (this.stopped) break;
          await this.processEvent(event);
        }
      } finally {
        stopHeartbeat();
      }
    }

    await this.publishGauges();
    return events.length;
  }

  private startHeartbeat(): () => void {
    const timeoutMs = this.config.get('OUTBOX_CLAIM_TIMEOUT_MS');
    // A quarter of the visibility timeout: three consecutive heartbeats can be
    // lost (a DB blip) before a live claim becomes reclaimable.
    const everyMs = Math.min(30_000, Math.max(250, Math.floor(timeoutMs / 4)));
    const timer = setInterval(() => {
      this.repo.heartbeat(this.workerId).catch((err: unknown) => {
        this.log.warn({
          msg: 'outbox.heartbeat_failed',
          workerId: this.workerId,
          err: String(err),
        });
      });
    }, everyMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private async reclaimOrphans(): Promise<void> {
    const timeoutMs = this.config.get('OUTBOX_CLAIM_TIMEOUT_MS');
    // R22 — judged on the database clock, the same clock that stamped the
    // claim; see OutboxRepository.reclaimExpired.
    const count = await this.repo.reclaimExpired(timeoutMs);
    if (count > 0) {
      this.metrics.outboxReclaimedTotal.inc(count);
      // Worth a warning, not an info: reclaims mean a worker died mid-flight,
      // and a steady trickle of them is a crash loop nobody has noticed.
      this.log.warn({ msg: 'outbox.reclaimed_stale', count, timeoutMs });
    }
  }

  private async processEvent(event: OutboxEvent): Promise<void> {
    const handlers = this.byEventType.get(event.eventType) ?? [];

    // No handler at all. Retrying forever would pile up a backlog nothing can
    // ever drain, so this goes straight to DEAD — a loud, inspectable state —
    // rather than quietly succeeding, which would erase the evidence that the
    // event was produced with no consumer.
    if (handlers.length === 0) {
      this.log.error({ msg: 'outbox.no_handler', eventId: event.id, eventType: event.eventType });
      const recorded = await this.repo.failLeased(
        event.id,
        this.workerId,
        event.attempts + 1,
        `No handler registered for event type "${event.eventType}"`,
        null,
      );
      this.count(event, recorded ? 'dead' : 'lease-lost');
      return;
    }

    const stopTimer = this.metrics.outboxEventDurationSeconds.startTimer({
      event_type: event.eventType,
    });

    try {
      const afterCommit: Array<() => Promise<void>> = [];
      const stats: Record<string, number> = {};
      let skipped = 0;

      // All handlers for one event share ONE transaction: the event is
      // delivered atomically or not at all. A partial delivery — handler A
      // committed, handler B rolled back — would be redelivered and A's
      // marker would then skip it, leaving the event permanently half-applied.
      //
      // R22 — the PROCESSED transition is the last statement of that same
      // transaction and is fenced on this worker's lease. Effects and the
      // terminal state commit together or not at all, and a worker whose lease
      // was reclaimed rolls its effects back instead of racing the new owner.
      const txTimeoutMs = this.setting(
        'OUTBOX_DELIVERY_TX_TIMEOUT_MS',
        OUTBOX_DELIVERY_TX_TIMEOUT_MS,
      );
      const delivery = this.prisma.client.$transaction(
        async (tx) => {
          for (const handler of handlers) {
            const first = await this.repo.claimHandlerRun(event.id, handler.name, tx);
            if (!first) {
              // Already ran to completion in an earlier delivery. This is the
              // duplicate-delivery guard doing its job, not an error.
              skipped += 1;
              continue;
            }
            const result = (await handler.handle(event, tx)) as OutboxHandlerResult | undefined;
            if (result?.afterCommit) afterCommit.push(result.afterCommit);
            Object.assign(stats, result?.stats ?? {});
          }
          if (!(await this.repo.completeLeased(event.id, this.workerId, tx))) {
            throw new OutboxLeaseLostError(event.id);
          }
        },
        { timeout: txTimeoutMs, maxWait: Math.min(txTimeoutMs, 5_000) },
      );
      await this.withDeadline(delivery);

      // A stalled best-effort transport must not keep heartbeating the rest
      // of this batch forever. This phase has its own bounded deadline;
      // failure here cannot retry the already committed database effects.
      await this.publishAfterCommit(event, afterCommit);

      this.count(event, skipped === handlers.length ? 'skipped-duplicate' : 'processed');
      this.log.log({
        msg: 'outbox.processed',
        eventId: event.id,
        eventType: event.eventType,
        attempts: event.attempts,
        ...(skipped > 0 ? { skippedHandlers: skipped } : {}),
        ...stats,
      });
    } catch (err) {
      await this.handleFailure(event, err);
    } finally {
      stopTimer();
    }
  }

  private async publishAfterCommit(
    event: OutboxEvent,
    effects: ReadonlyArray<() => Promise<void>>,
  ): Promise<void> {
    if (effects.length === 0) return;
    let closed = false;
    const warn = (err: unknown) => {
      this.log.warn({
        msg: 'outbox.after_commit_failed',
        eventId: event.id,
        eventType: event.eventType,
        err: String(err),
      });
    };
    const publication = (async () => {
      for (const effect of effects) {
        // Promise timeouts cannot cancel arbitrary transport work. If a late
        // callback settles, it must not launch the remaining callbacks after
        // the worker has already moved on to another event.
        if (closed) break;
        try {
          await effect();
        } catch (err) {
          warn(err);
        }
      }
    })();
    try {
      // One budget for the whole callback list, not one budget per callback.
      await this.withDeadline(publication);
    } catch (err) {
      // PROCESSED, markers and durable effects have committed. Never route a
      // publication failure through handleFailure or requeue this event.
      warn(err);
    } finally {
      closed = true;
    }
  }

  /** Bound one asynchronous phase. The delivery caller records a transient
   *  failure on its lease; Prisma's timeout or fenced completion prevents
   *  the abandoned transaction from committing. The post-commit caller only
   *  logs expiry, since its durable effects have already committed. */
  private async withDeadline(work: Promise<unknown>): Promise<void> {
    const deadlineMs = this.setting('OUTBOX_DELIVERY_DEADLINE_MS', OUTBOX_DELIVERY_DEADLINE_MS);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OutboxDeadlineExceededError(deadlineMs)), deadlineMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      // An abandoned delivery that later rejects must not surface as an
      // unhandled rejection and crash the process.
      work.catch(() => undefined);
    }
  }

  private async handleFailure(event: OutboxEvent, err: unknown): Promise<void> {
    const kind = classifyOutboxFailure(err);
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);

    if (kind === 'lease-lost') {
      // Not this worker's event any more. Recording anything would overwrite
      // the new owner's state, so the only correct action is to step aside.
      this.log.warn({
        msg: 'outbox.lease_lost',
        eventId: event.id,
        eventType: event.eventType,
        workerId: this.workerId,
      });
      this.count(event, 'lease-lost');
      return;
    }

    const attempts = event.attempts + 1;
    const delayMs =
      kind === 'permanent'
        ? null
        : nextAttemptDelayMs(
            attempts,
            event.maxAttempts,
            this.retryPolicy(),
            Math.random,
            retryAfterHintMs(err),
          );

    const recorded = await this.repo.failLeased(
      event.id,
      this.workerId,
      attempts,
      message,
      delayMs,
    );
    if (!recorded) {
      this.log.warn({
        msg: 'outbox.lease_lost',
        eventId: event.id,
        eventType: event.eventType,
        workerId: this.workerId,
        during: 'failure',
      });
      this.count(event, 'lease-lost');
      return;
    }

    if (delayMs === null) {
      // Terminal. ERROR, not warn: a dead letter is an event the system
      // promised to deliver and never will, and it needs a human.
      this.log.error({
        msg: 'outbox.dead_letter',
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        attempts,
        reason: kind === 'permanent' ? 'permanent-error' : 'retry-budget-exhausted',
        err: message,
      });
      this.count(event, 'dead');
      return;
    }

    this.log.warn({
      msg: 'outbox.retry_scheduled',
      eventId: event.id,
      eventType: event.eventType,
      attempts,
      maxAttempts: event.maxAttempts,
      retryInMs: delayMs,
      err: message.slice(0, 500),
    });
    this.count(event, 'retried');
  }

  /** `outcome` values are a closed, low-cardinality set:
   *  processed / skipped-duplicate / retried / dead / lease-lost. */
  private count(event: OutboxEvent, outcome: string): void {
    this.metrics.outboxEventsProcessedTotal.inc({ event_type: event.eventType, outcome });
  }

  private retryPolicy(): RetryPolicy {
    return {
      baseMs: this.config.get('OUTBOX_RETRY_BASE_MS'),
      capMs: this.config.get('OUTBOX_RETRY_CAP_MS'),
      jitter: 0.2,
    };
  }

  /** An R22 timing setting not yet declared in env.schema.ts (CR-02). Accepts
   *  only a positive integer up to ten minutes; anything else — unset, a typo,
   *  a negative — falls back to the code default rather than disabling the
   *  bound it configures. */
  private setting(key: string, fallback: number): number {
    const raw = (this.config as unknown as { get(k: string): unknown }).get(key);
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isInteger(value) && value > 0 && value <= 600_000 ? value : fallback;
  }

  private async publishGauges(): Promise<void> {
    try {
      const byStatus = await this.repo.countByStatus();
      // Reset first: a status that drops to zero rows disappears from the
      // groupBy entirely, and without a reset its gauge would keep reporting
      // the last non-zero value forever — a permanently stuck "3 DEAD" long
      // after they were cleared.
      this.metrics.outboxQueueDepth.reset();
      for (const status of ['PENDING', 'PROCESSING', 'PROCESSED', 'DEAD']) {
        this.metrics.outboxQueueDepth.set({ status }, byStatus[status] ?? 0);
      }
      this.metrics.outboxOldestPendingAgeSeconds.set(await this.repo.oldestPendingAgeSeconds());
    } catch (err) {
      // Metrics must never take the worker down.
      this.log.warn({ msg: 'outbox.gauges_failed', err: String(err) });
    }
  }
}
