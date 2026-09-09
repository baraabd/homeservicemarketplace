import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { PublicMediaCleanupService } from './public-media-cleanup.service';

// Sprint 09B.29 Phase 4 — the production caller for the public-media sweep.
//
// Shaped exactly like `EvidenceScanJob`, `VerificationExpiryJob` and
// `OutboxCleanupJob`: an unref'd setTimeout chain, a public `runOnce` for
// deterministic tests and for an operator draining a backlog by hand, and a
// config flag that decides whether it runs at all. No scheduling dependency is
// introduced — @nestjs/schedule, a queue or a cron container would each be a
// new failure domain for a pass that deletes a handful of objects.
//
// WHY DEFAULT OFF
//
// This job DELETES BYTES. Every other default-off worker in this codebase is
// off because enabling it grants something; this one is off because enabling
// it destroys something, which is a stronger reason rather than a weaker one.
// An operator turns it on deliberately, having read what it deletes.
//
// Failing safe here means the leak persists — objects accumulate — rather than
// bytes being removed that should not have been. That is the correct direction
// for a destructive sweep, and it is the opposite of the direction the scan
// worker fails in.
//
// WHY IT IS SAFE ON EVERY REPLICA
//
// Selection is not a claim. Two replicas may pick the same asset; the object
// delete is idempotent and the row write is conditional on `deletedAt` still
// being null, so one wins and the other counts a race. There is no leader
// election to get wrong.
@Injectable()
export class PublicMediaCleanupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PublicMediaCleanupJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** One pass at a time IN THIS PROCESS. The next timer is armed in
   *  `.finally()`, so a pass slower than its interval delays the next one
   *  rather than running two. */
  private running = false;

  constructor(
    private readonly cleanup: PublicMediaCleanupService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('PUBLIC_MEDIA_CLEANUP_WORKER_ENABLED')) return;
    this.log.log({
      msg: 'public.media.cleanup.worker.started',
      intervalMs: this.config.get('PUBLIC_MEDIA_CLEANUP_INTERVAL_MS'),
      batch: this.config.get('PUBLIC_MEDIA_CLEANUP_BATCH_SIZE'),
      graceMs: this.config.get('PUBLIC_MEDIA_CLEANUP_RESERVATION_GRACE_MS'),
    });
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** One pass, awaited. The deterministic entry point for tests and for an
   *  operator draining a backlog by hand. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanup.sweep({
        limit: this.config.get('PUBLIC_MEDIA_CLEANUP_BATCH_SIZE'),
        reservationGraceMs: this.config.get('PUBLIC_MEDIA_CLEANUP_RESERVATION_GRACE_MS'),
      });
    } finally {
      this.running = false;
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err) =>
          // A failed pass is logged and retried on the next tick. It must never
          // reject into the timer, which would leave the chain unscheduled and
          // silently stop the sweep for the lifetime of the process — putting
          // every later object back in the state this job exists to clear.
          this.log.warn({ msg: 'public.media.cleanup.pass.failed', err: String(err) }),
        )
        .finally(() => this.schedule());
    }, this.config.get('PUBLIC_MEDIA_CLEANUP_INTERVAL_MS'));
    // unref so a pending timer never holds the process open during shutdown or
    // keeps a Jest worker alive after its tests finish.
    this.timer.unref?.();
  }
}
