import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { MoneyCommandService } from '../../application/money-command.service';
import {
  STRIPE_ADAPTER_ID,
  StripeSandboxConfiguration,
} from '../../adapters/stripe/stripe-sandbox.config';

/** Coordinator schedules this bounded handler. The existing R24 transactions
 * arbitrate duplicate workers; the existing durable inbox survives a restart. */
export class StripeInboxJob {
  private running = false;
  private after: string | undefined;
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: MoneyCommandService,
    private readonly config: StripeSandboxConfiguration,
  ) {}
  async runBatch(): Promise<{ processed: number; pending: number }> {
    if (this.running || !this.config.isEnabled()) return { processed: 0, pending: 0 };
    this.running = true;
    try {
      const settings = this.config.requireEnabled();
      const rows = await this.prisma.client.moneyExternalEvent.findMany({
        where: {
          adapterId: STRIPE_ADAPTER_ID,
          mode: 'SANDBOX',
          accountReference: settings.accountReference,
          source: 'PROVIDER_WEBHOOK',
          status: 'RECEIVED',
          ...(this.after ? { id: { gt: this.after } } : {}),
        },
        orderBy: { id: 'asc' },
        take: 25,
        select: { id: true },
      });
      let processed = 0;
      let pending = 0;
      for (const row of rows) {
        try {
          await this.commands.processExternalEvent(row.id);
          processed++;
        } catch {
          pending++;
        } // Keep durable evidence; no fabricated success or raw logs.
      }
      this.after = rows.length === 25 ? rows[rows.length - 1]!.id : undefined;
      return { processed, pending };
    } finally {
      this.running = false;
    }
  }
}
