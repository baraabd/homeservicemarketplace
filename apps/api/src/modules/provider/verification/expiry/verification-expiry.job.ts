import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { AppConfigService } from '../../../../config/app-config.service';
import { VerificationExpiryService } from './verification-expiry.service';

// Sprint 9B.7 — the scheduled adapter for the expiry command.
//
// Deliberately the NARROWEST thing that will do the job, and shaped exactly
// like OutboxCleanupJob, which is this repository's existing convention for a
// recurring background pass: an unref'd setTimeout chain, a public `runOnce`
// for deterministic tests, and a config flag that decides whether it runs at
// all. No new scheduling dependency was introduced for it — @nestjs/schedule,
// a queue, or a cron container would each be a new failure domain and a new
// thing to operate, for a pass that is not load-bearing for authorization.
//
// HOW IT IS ACTIVATED
//
// `VERIFICATION_EXPIRY_WORKER_ENABLED=true`, per environment. Default OFF.
//
// WHY DEFAULT OFF IS SAFE HERE
//
// Access is denied at read time by the grant's own timestamps, so a lapsed
// verification stops authorising work whether or not this ever runs. What the
// sweep adds is the truthful record — case state, provider evidence axis,
// decision, audit, notification, event. Off means the record goes stale; it
// never means access is granted that nobody authorised. That is the correct
// direction for a background job to fail, and it is why arming it is an
// operational decision rather than a prerequisite for the feature.
//
// WHY IT IS SAFE TO RUN ON EVERY REPLICA
//
// Selection is not a claim. Two replicas may pick the same case; the
// conditional update inside `expireCase` lets exactly one write, and the other
// records it as `alreadyDone`. There is no leader election to get wrong.
@Injectable()
export class VerificationExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(VerificationExpiryJob.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly expiry: VerificationExpiryService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('VERIFICATION_EXPIRY_WORKER_ENABLED')) return;
    this.log.log({
      msg: 'verification.expiry.worker.started',
      intervalMs: this.config.get('VERIFICATION_EXPIRY_INTERVAL_MS'),
      batch: this.config.get('VERIFICATION_EXPIRY_BATCH_SIZE'),
    });
    this.schedule();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.expiry
        .runOnce({ limit: this.config.get('VERIFICATION_EXPIRY_BATCH_SIZE') })
        .catch((err) =>
          // A failed pass is logged and retried on the next tick. It must never
          // reject into the timer, which would leave the chain unscheduled and
          // silently stop the sweep for the lifetime of the process.
          this.log.warn({ msg: 'verification.expiry.sweep.failed', err: String(err) }),
        )
        .finally(() => this.schedule());
    }, this.config.get('VERIFICATION_EXPIRY_INTERVAL_MS'));
    // unref so a pending timer never holds the process open during shutdown or
    // keeps a Jest worker alive after its tests finish.
    this.timer.unref?.();
  }
}
