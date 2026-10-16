import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { MAIL_TRANSPORT, MailPort } from '../mail/mail.port';
import { STORAGE_PORT, StoragePort } from '../storage/storage.port';
import { MetricsService } from '../telemetry/metrics.service';
import {
  runDiagnostics,
  scannerProbe,
  storageProbe,
  paymentProbe,
  type DiagnosticProbe,
} from '../telemetry/dependency-diagnostics';
import { ClamAvMalwareScanner } from '../../modules/provider/verification/media/clamav-scanner.adapter';

/** Separate from HTTP liveness/readiness. Only the already-protected metrics expose results. */
@Injectable()
export class DiagnosticsScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private readonly probes: DiagnosticProbe[];

  constructor(
    config: AppConfigService,
    private readonly metrics: MetricsService,
    @Inject(MAIL_TRANSPORT) mail: MailPort & { verify?: (signal: AbortSignal) => Promise<void> },
    @Inject(STORAGE_PORT)
    storage: StoragePort & { headBuckets?: (signal: AbortSignal) => Promise<void> },
  ) {
    const scanner =
      config.get('EVIDENCE_SCANNER_DRIVER') === 'clamav' ? new ClamAvMalwareScanner(config) : null;
    this.probes = [
      {
        dependency: 'smtp',
        configured: Boolean(config.get('SMTP_HOST') && mail.verify),
        check: async (signal) => {
          await mail.verify?.(signal);
        },
      },
      storageProbe(storage.headBuckets ? (signal) => storage.headBuckets!(signal) : null),
      scannerProbe(scanner ? (signal) => scanner.ping(signal) : null),
      paymentProbe(null),
    ];
  }

  onApplicationBootstrap(): void {
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 60_000);
    this.timer.unref();
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    this.active = runDiagnostics(this.probes, { metrics: this.metrics, timeoutMs: 3000 })
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        this.active = undefined;
      });
    return this.active;
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
