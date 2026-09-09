import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../../../../config/app-config.service';
import { EvidenceScanService } from './evidence-scan.service';

// Sprint 09B.29 — the scheduled adapter for the evidence scan sweep.
//
// WHY IT EXISTS: the sweep had no caller.
//
// `EvidenceScanService.scanPending` is the only thing that moves a restricted
// evidence asset off `PENDING`. It was registered in the module and exported,
// and nothing in production ever called it — its only caller was its own unit
// spec. In a running system that means a provider uploads identity evidence,
// it is stored, and nobody ever judges it: `scanState` stays PENDING, case
// submission stays blocked on EVIDENCE_NOT_CLEAN, no verification case can be
// approved, no `ProviderWorkAccessGrant` is issued, and no provider can ever be
// activated.
//
// Phase 3's integration Journey C missed this because it invokes `scanPending()`
// directly. Only driving the real API through a browser surfaced it.
//
// Deliberately the NARROWEST thing that will do the job, and shaped exactly
// like `VerificationExpiryJob` and `OutboxCleanupJob` — this repository's
// existing convention for a recurring background pass: an unref'd setTimeout
// chain, a public `runOnce` for deterministic tests, and a config flag that
// decides whether it runs at all. No new scheduling dependency was introduced;
// @nestjs/schedule, a queue, or a cron container would each be a new failure
// domain for a pass that grants nothing.
//
// HOW IT IS ACTIVATED
//
// `EVIDENCE_SCAN_WORKER_ENABLED=true`, per environment. Default OFF.
//
// WHY DEFAULT OFF IS SAFE
//
// The read path serves CLEAN and nothing else, and `EvidenceScanService`
// refuses to write CLEAN unless the adapter reports `isRealScanner`. Off means
// evidence stays unreadable and unverifiable — the same direction the feature
// already fails in without a scanner configured. It never means something is
// trusted that nobody scanned. Arming it is an operational decision, exactly as
// it is for the expiry sweep.
//
// WHY IT IS SAFE TO RUN ON EVERY REPLICA
//
// Selection is not a claim. Two replicas may pick the same asset; the write
// inside `EvidenceScanService` is conditional on the state it read, so one
// wins and the other is a no-op. There is no leader election to get wrong.
@Injectable()
export class EvidenceScanJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(EvidenceScanJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly scans: EvidenceScanService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('EVIDENCE_SCAN_WORKER_ENABLED')) return;
    this.log.log({
      msg: 'evidence.scan.worker.started',
      intervalMs: this.config.get('EVIDENCE_SCAN_INTERVAL_MS'),
      batch: this.config.get('EVIDENCE_SCAN_BATCH_SIZE'),
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
    await this.scans.scanPending({ limit: this.config.get('EVIDENCE_SCAN_BATCH_SIZE') });
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch((err) =>
          // A failed pass is logged and retried on the next tick. It must never
          // reject into the timer, which would leave the chain unscheduled and
          // silently stop the sweep for the lifetime of the process — putting
          // every later upload back in the state this job exists to prevent.
          this.log.warn({ msg: 'evidence.scan.sweep.failed', err: String(err) }),
        )
        .finally(() => this.schedule());
    }, this.config.get('EVIDENCE_SCAN_INTERVAL_MS'));
    // unref so a pending timer never holds the process open during shutdown or
    // keeps a Jest worker alive after its tests finish.
    this.timer.unref?.();
  }
}
