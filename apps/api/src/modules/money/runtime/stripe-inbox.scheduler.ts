import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { StripeInboxJob } from '../webhooks/stripe/stripe-inbox.job';
import { StripeSandboxConfiguration } from '../adapters/stripe/stripe-sandbox.config';

@Injectable()
export class StripeInboxScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private readonly logger = new Logger(StripeInboxScheduler.name);
  constructor(
    private readonly job: StripeInboxJob,
    private readonly config: AppConfigService,
    private readonly stripe: StripeSandboxConfiguration,
  ) {}
  onApplicationBootstrap() {
    if (!this.config.get('OUTBOX_WORKER_ENABLED') || !this.stripe.isEnabled()) return;
    const tick = () => {
      if (!this.active)
        this.active = this.run().finally(() => {
          this.active = undefined;
        });
    };
    this.timer = setInterval(tick, 30_000);
    this.timer.unref();
    tick();
  }
  private async run() {
    try {
      await this.job.runBatch();
    } catch {
      this.logger.warn({ msg: 'money.stripe.inbox.retry' });
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
}
