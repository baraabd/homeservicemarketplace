import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { OutboxRepository } from './outbox.repository';

// Sprint 6 — reaps delivered outbox rows.
//
// Without this the table grows without bound: every request fan-out leaves one
// dispatcher row plus one row per slice, permanently. That is not merely disk
// — the claim query's index is `(status, availableAt)`, and an ever-growing
// tail of PROCESSED rows inflates it and slows the hot path that keeps
// delivery timely.
//
// DEAD rows are NEVER reaped. A dead letter is the only surviving evidence
// that an event existed and was never delivered; deleting it on a timer
// destroys exactly what an operator needs and turns a visible failure into
// silence. They are cleared by hand, after someone has looked.
@Injectable()
export class OutboxCleanupJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxCleanupJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  /** Rows per DELETE. Chunked so cleanup never takes a long lock or bloats
   *  WAL with one enormous statement — it competes with live delivery for the
   *  same table. */
  private static readonly CHUNK = 500;
  /** Chunks per run. Bounds one pass so a huge backlog is drained over
   *  several runs instead of monopolising a connection for minutes. */
  private static readonly MAX_CHUNKS_PER_RUN = 20;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    // Tied to the worker flag: cleanup is part of running the outbox, and a
    // deployment with delivery off should not be mutating the queue either.
    if (!this.config.get('OUTBOX_WORKER_ENABLED')) return;
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err) => this.log.warn({ msg: 'outbox.cleanup.failed', err: String(err) }))
        .finally(() => this.schedule());
    }, this.config.get('OUTBOX_CLEANUP_INTERVAL_MS'));
    this.timer.unref?.();
  }

  /** Delete PROCESSED rows past the retention window. Returns how many.
   *
   *  Public so tests can run it deterministically. */
  async runOnce(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.get('OUTBOX_RETENTION_HOURS') * 3_600_000);
    let total = 0;
    for (let i = 0; i < OutboxCleanupJob.MAX_CHUNKS_PER_RUN; i++) {
      if (this.stopped) break;
      const deleted = await this.repo.deleteProcessedBefore(cutoff, OutboxCleanupJob.CHUNK);
      total += deleted;
      // A short chunk means the backlog is drained; stop rather than spin.
      if (deleted < OutboxCleanupJob.CHUNK) break;
    }
    if (total > 0) {
      this.log.log({ msg: 'outbox.cleanup.reaped', deleted: total, cutoff: cutoff.toISOString() });
    }
    return total;
  }
}
