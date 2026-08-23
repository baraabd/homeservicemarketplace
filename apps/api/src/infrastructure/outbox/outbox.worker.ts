import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { OutboxEvent } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../telemetry/metrics.service';
import { OUTBOX_HANDLERS } from './outbox.tokens';
import { OutboxRepository } from './outbox.repository';
import { nextAttemptAt, type RetryPolicy } from './outbox.retry';
import type { OutboxHandler, OutboxHandlerResult } from './outbox.handler';

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

  private readonly byEventType = new Map<string, OutboxHandler[]>();

  constructor(
    private readonly repo: OutboxRepository,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly metrics: MetricsService,
    @Inject(OUTBOX_HANDLERS) private readonly handlers: OutboxHandler[],
  ) {
    for (const handler of this.handlers) {
      for (const type of handler.eventTypes) {
        const list = this.byEventType.get(type) ?? [];
        list.push(handler);
        this.byEventType.set(type, list);
      }
    }
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

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Let the current tick finish. Its events are already claimed; abandoning
    // them means waiting out the visibility timeout before anyone retries.
    if (this.inFlight) await this.inFlight.catch(() => undefined);
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
      this.metrics.outboxClaimedTotal.inc(events.length);
      // Sequential, not Promise.all. These handlers fan out to hundreds of
      // recipients each; running a whole batch concurrently multiplies the
      // connection-pool demand by the batch size and starves the HTTP path
      // sharing that pool. Throughput comes from more REPLICAS, which the
      // claim statement already supports safely.
      for (const event of events) {
        if (this.stopped) break;
        await this.processEvent(event);
      }
    }

    await this.publishGauges();
    return events.length;
  }

  private async reclaimOrphans(): Promise<void> {
    const timeoutMs = this.config.get('OUTBOX_CLAIM_TIMEOUT_MS');
    const count = await this.repo.reclaimStale(new Date(Date.now() - timeoutMs));
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
      await this.repo.markFailed(
        event.id,
        event.attempts + 1,
        `No handler registered for event type "${event.eventType}"`,
        null,
      );
      this.metrics.outboxEventsProcessedTotal.inc({
        event_type: event.eventType,
        outcome: 'dead',
      });
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
      await this.prisma.client.$transaction(async (tx) => {
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
      });

      await this.repo.markProcessed(event.id);

      // Outside the transaction, by contract: realtime publishes and mail.
      // Failures are logged, never rethrown — the durable work is already
      // committed, and failing the event here would redeliver it only for
      // every handler to be skipped by its marker, achieving nothing.
      for (const effect of afterCommit) {
        try {
          await effect();
        } catch (err) {
          this.log.warn({
            msg: 'outbox.after_commit_failed',
            eventId: event.id,
            eventType: event.eventType,
            err: String(err),
          });
        }
      }

      this.metrics.outboxEventsProcessedTotal.inc({
        event_type: event.eventType,
        outcome: skipped === handlers.length ? 'skipped-duplicate' : 'processed',
      });
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

  private async handleFailure(event: OutboxEvent, err: unknown): Promise<void> {
    const attempts = event.attempts + 1;
    const when = nextAttemptAt(attempts, event.maxAttempts, new Date(), this.retryPolicy());
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);

    await this.repo.markFailed(event.id, attempts, message, when);

    if (when === null) {
      // Terminal. ERROR, not warn: a dead letter is an event the system
      // promised to deliver and never will, and it needs a human.
      this.log.error({
        msg: 'outbox.dead_letter',
        eventId: event.id,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        attempts,
        err: message,
      });
      this.metrics.outboxEventsProcessedTotal.inc({
        event_type: event.eventType,
        outcome: 'dead',
      });
      return;
    }

    this.log.warn({
      msg: 'outbox.retry_scheduled',
      eventId: event.id,
      eventType: event.eventType,
      attempts,
      maxAttempts: event.maxAttempts,
      nextAttemptAt: when.toISOString(),
      err: message.slice(0, 500),
    });
    this.metrics.outboxEventsProcessedTotal.inc({
      event_type: event.eventType,
      outcome: 'retried',
    });
  }

  private retryPolicy(): RetryPolicy {
    return {
      baseMs: this.config.get('OUTBOX_RETRY_BASE_MS'),
      capMs: this.config.get('OUTBOX_RETRY_CAP_MS'),
      jitter: 0.2,
    };
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
