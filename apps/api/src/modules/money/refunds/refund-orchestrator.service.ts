import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { MoneyCommandService } from '../application/money-command.service';

export const REFUND_DISPATCH_EVENT = 'money.refund.dispatch-requested.v1';
const POLL_MS = 5_000;
const MAX_BATCH = 25;

export interface RefundRecoveryBatch {
  inspected: number;
  attempted: number;
  blocked: number;
}

/** R32 delivery protocol over R24's durable MoneyDispatch authority.
 * Outbox afterCommit accelerates one attempt; this bounded, restart-safe scan
 * covers loss of that callback and expired claims. The command service owns
 * authorization, leases, query-first uncertainty and transactional accounting.
 */
@Injectable()
export class RefundOrchestratorService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(RefundOrchestratorService.name);
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;
  private cursor: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: MoneyCommandService,
    private readonly config: AppConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get('OUTBOX_WORKER_ENABLED')) this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Do not hold shutdown forever if a transport violates its own deadline.
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.inFlight?.catch(() => undefined),
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, 5_000);
          deadline.unref?.();
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }

  deliver(refundId: string, commandId?: string): Promise<void> {
    return this.commands.deliverRefund(refundId, commandId);
  }

  /** Cursor movement keeps permanently blocked rows from starving newer work.
   * Cursor state is only scan progress; losing it never loses the DB intent.
   * Every replica may scan the same row: the database claim fences execution.
   */
  async recoverBatch(limit = 10): Promise<RefundRecoveryBatch> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH)
      throw new AppError('VALIDATION_ERROR', 'Invalid recovery batch size.', 400);
    const rows = await this.prisma.client.moneyDispatch.findMany({
      where: {
        kind: 'REFUND',
        status: { in: ['NOT_DISPATCHED', 'PENDING', 'UNKNOWN'] },
        OR: [{ claimId: null }, { leaseUntil: { lte: new Date() } }],
        ...(this.cursor ? { id: { gt: this.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, refundId: true },
    });
    this.cursor = rows.length === limit ? rows[rows.length - 1]!.id : undefined;
    const summary = { inspected: rows.length, attempted: 0, blocked: 0 };
    for (const row of rows) {
      if (this.stopped) break;
      if (!row.refundId) {
        summary.blocked += 1;
        continue;
      }
      try {
        await this.deliver(row.refundId);
        summary.attempted += 1;
      } catch {
        // Persisted financial state is never cancelled by an operational error.
        // No raw exception, provider payload, binding or private key is logged.
        summary.blocked += 1;
      }
    }
    return summary;
  }

  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.tick().finally(() => {
        this.inFlight = undefined;
        this.schedule(POLL_MS);
      });
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      const counts = await this.recoverBatch();
      if (counts.inspected) this.log.log({ msg: 'money.refund.recovery', ...counts });
    } catch {
      this.log.warn({ msg: 'money.refund.recovery_unavailable' });
    }
  }
}
