import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AppConfigService } from '../../config/app-config.service';
import { DurableMailService } from './durable-mail.service';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { MailMetrics } from './mail.metrics';

const BATCH_SIZE = 20;
const RETENTION_EVERY_MS = 60 * 60_000;
export const FEEDBACK_RETENTION_DAYS = 30;
export const DELIVERY_RETENTION_DAYS = 90;
const DELETE_CHUNK = 500;
const DAY_MS = 24 * 60 * 60_000;

/**
 * R21 — retries queued mail outside any request.
 *
 * Same shape as OutboxWorker (a plain timer loop over a Postgres claim with
 * FOR UPDATE SKIP LOCKED, `runOnce()` public for tests), but over
 * EmailDelivery, because mail needs what the generic outbox deliberately does
 * not model: an external send that must stay OUTSIDE the database
 * transaction, a per-message validity window, provider acceptance distinct
 * from delivery, and suppression. The outbox worker is not modified.
 *
 * Every replica runs one. A crash between "the relay accepted" and "we
 * recorded ACCEPTED" re-sends after the lease lapses, with the same
 * Message-ID: at-least-once, never silently lost.
 */
@Injectable()
export class MailDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MailDispatcher.name);
  private readonly workerId = `mail-${process.pid}-${randomUUID().slice(0, 8)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private inFlight: Promise<void> | null = null;
  private lastRetentionAt = 0;

  constructor(
    private readonly repo: EmailDeliveryRepository,
    private readonly mail: DurableMailService,
    private readonly config: AppConfigService,
    private readonly metrics: MailMetrics,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('MAIL_DISPATCHER_ENABLED')) {
      this.log.warn(
        'Mail dispatcher DISABLED (MAIL_DISPATCHER_ENABLED=false); queued mail is not retried',
      );
      return;
    }
    this.log.log(`Mail dispatcher started (id=${this.workerId})`);
    this.scheduleNext(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.inFlight) await this.inFlight.catch(() => undefined);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => {
        this.inFlight = null;
      });
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    let claimed = 0;
    try {
      claimed = await this.runOnce();
    } catch (err) {
      this.log.error({
        msg: 'mail.dispatcher.tick_failed',
        err: err instanceof Error ? err.name : 'unknown',
      });
    } finally {
      this.running = false;
      this.scheduleNext(
        claimed >= BATCH_SIZE ? 0 : this.config.get('MAIL_DISPATCH_POLL_INTERVAL_MS'),
      );
    }
  }

  /** Claim and attempt one batch; run retention when due. Returns the number
   *  of rows claimed. */
  async runOnce(now: Date = new Date()): Promise<number> {
    const rows = await this.repo.claimBatch(
      this.workerId,
      BATCH_SIZE,
      this.config.get('MAIL_DISPATCH_LEASE_MS'),
    );
    // Sequential: a slow relay should slow this replica, not open N parallel
    // SMTP sessions against a provider rate limit.
    for (const row of rows) {
      if (this.stopped) break;
      await this.mail.process(row, this.workerId);
    }
    if (now.getTime() - this.lastRetentionAt >= RETENTION_EVERY_MS) {
      this.lastRetentionAt = now.getTime();
      await this.runRetention(now);
    }
    await this.publishGauges();
    return rows.length;
  }

  /** Bounded retention. Envelopes go first (they can hold secrets); feedback
   *  after FEEDBACK_RETENTION_DAYS; closed delivery rows after
   *  DELIVERY_RETENTION_DAYS. Nothing in flight is touched. */
  async runRetention(now: Date = new Date()): Promise<void> {
    try {
      const expired = await this.repo.expireOverdue(now);
      const purged = await this.repo.purgeTerminalEnvelopes();
      const feedback = await this.repo.deleteFeedbackBefore(
        new Date(now.getTime() - FEEDBACK_RETENTION_DAYS * DAY_MS),
      );
      let deliveries = 0;
      for (let i = 0; i < 20; i++) {
        const n = await this.repo.deleteClosedBefore(
          new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS),
          DELETE_CHUNK,
        );
        deliveries += n;
        if (n < DELETE_CHUNK) break;
      }
      if (expired + purged + feedback + deliveries > 0) {
        this.log.log({
          msg: 'mail.retention',
          expired,
          purgedEnvelopes: purged,
          feedback,
          deliveries,
        });
      }
    } catch (err) {
      this.log.warn({
        msg: 'mail.retention.failed',
        err: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  private async publishGauges(): Promise<void> {
    try {
      const byStatus = await this.repo.countByStatus();
      this.metrics.queueDepth.reset();
      for (const status of [
        'QUEUED',
        'SENDING',
        'ACCEPTED',
        'DELIVERED',
        'BOUNCED',
        'COMPLAINED',
        'SUPPRESSED',
        'FAILED',
        'EXPIRED',
      ]) {
        this.metrics.queueDepth.set({ status }, byStatus[status] ?? 0);
      }
    } catch {
      // Metrics never take the dispatcher down.
    }
  }
}
