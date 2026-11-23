import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { MONEY_CONTRACT_VERSION } from '@homeservicemarketplace/contracts';
import { AppConfigService } from '../../../config/app-config.service';
import { AppError } from '../../../shared/errors/app-error';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MoneyCommandService } from '../application/money-command.service';
import { ReceiptUploadService } from './receipt-upload.service';
import { manualDigest } from './manual-review.service';

/** Durable pending reviews survive API restarts. Duplicate replicas may attempt
 * the same immutable key; the R24 command/intent locks serialize its effects. */
@Injectable()
export class ManualEventProcessingJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ManualEventProcessingJob.name);
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private active: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: MoneyCommandService,
    private readonly uploads: ReceiptUploadService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('OUTBOX_WORKER_ENABLED')) return;
    this.timer = setInterval(() => {
      if (!this.running) this.active = this.sweep();
    }, 30_000);
    this.timer.unref();
    this.active = this.sweep();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }

  async process(paymentIntentId: string): Promise<boolean> {
    const state = await this.prisma.client.moneyManualReview.findUnique({
      where: { paymentIntentId },
      include: { pendingDecision: { include: { receipt: true } } },
    });
    if (
      !state ||
      state.state !== 'CONFIRMING' ||
      state.reconciliationRequired ||
      state.attemptCount >= 8 ||
      !state.pendingDecision
    )
      return false;
    const decision = state.pendingDecision;
    try {
      // These methods own their separate R24 transactions. Never call them
      // from a surrounding notification/review transaction.
      const accepted = await this.commands.acceptReceipt(
        decision.reviewerUserId,
        `r30_accept_${manualDigest(decision.id)}`,
        {
          contractVersion: MONEY_CONTRACT_VERSION,
          paymentIntentId,
          receiptMediaAssetId: decision.receipt.mediaAssetId,
        },
      );
      await this.commands.processExternalEvent(accepted.resourceId);
      return true;
    } catch (error) {
      const detail =
        error instanceof AppError ? (error.details as { reason?: unknown } | undefined) : undefined;
      const reason =
        typeof detail?.reason === 'string' && /^[A-Z0-9_]{1,80}$/u.test(detail.reason)
          ? detail.reason
          : error instanceof AppError
            ? error.code
            : 'TRANSIENT_FAILURE';
      const permanent =
        error instanceof AppError &&
        ['FORBIDDEN', 'UNAUTHORIZED', 'NOT_FOUND', 'VALIDATION_ERROR', 'CONFLICT'].includes(
          error.code,
        );
      const reconciliationRequired = permanent || state.attemptCount + 1 >= 8;
      await this.prisma.client.moneyManualReview.updateMany({
        // Only the attempt's original operational snapshot may transition.
        // A stale replica must not clear another failure's halt, cross the
        // retry cap without halting, or modify an explicitly reset retry cycle.
        where: {
          paymentIntentId,
          state: 'CONFIRMING',
          pendingDecisionId: decision.id,
          attemptCount: state.attemptCount,
          reconciliationRequired: false,
          updatedAt: state.updatedAt,
        },
        data: {
          nextAttemptAt: reconciliationRequired
            ? null
            : new Date(
                Date.now() + Math.min(3_600_000, 30_000 * 2 ** Math.min(state.attemptCount, 7)),
              ),
          attemptCount: { increment: 1 },
          lastErrorCode: reason,
          reconciliationRequired,
        },
      });
      this.log.warn({ msg: 'money.manual.confirmation.pending', paymentIntentId });
      return false;
    }
  }

  async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pending = await this.prisma.client.moneyManualReview.findMany({
        where: {
          state: 'CONFIRMING',
          reconciliationRequired: false,
          attemptCount: { lt: 8 },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        orderBy: [{ nextAttemptAt: 'asc' }, { paymentIntentId: 'asc' }],
        take: 10,
      });
      for (const state of pending) await this.process(state.paymentIntentId);
      await this.uploads.retryScans(10);
    } catch {
      this.log.warn({ msg: 'money.manual.worker.retry' });
    } finally {
      this.running = false;
    }
  }
}
