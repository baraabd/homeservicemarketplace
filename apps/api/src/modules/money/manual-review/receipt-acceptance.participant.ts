import { Injectable } from '@nestjs/common';
import { MONEY_CONTRACT_VERSION, toMoneyWire } from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { AuditService } from '../../iam/audit/audit.service';
import { ManualRailConfiguration, isManualBinding } from '../adapters/manual/manual-rail.config';
import type {
  MoneyReceiptAcceptancePort,
  MoneyTransportBinding,
  NormalizedMoneyExternalEvent,
} from '../ports/collection.port';
import { ManualReviewService, manualConflict, manualDigest } from './manual-review.service';

/** R24 owns the transaction. Staging never changes ledger or entitlements;
 * final validation/claim/decision/notice enlist in R24's activation transaction. */
@Injectable()
export class ReceiptAcceptanceParticipant implements MoneyReceiptAcceptancePort {
  constructor(
    private readonly review: ManualReviewService,
    private readonly config: ManualRailConfiguration,
    private readonly audit: AuditService,
  ) {}

  isConfigured(binding: MoneyTransportBinding): boolean {
    return isManualBinding(binding);
  }

  private async candidate(
    paymentIntentId: string,
    reviewerUserId: string,
    receiptMediaAssetId: string,
    tx: PrismaTx,
  ) {
    await this.review.authorize(reviewerUserId, 'money:receipt:review', tx);
    await this.review.authorize(reviewerUserId, 'money:receipt:view', tx);
    const context = await this.review.context(paymentIntentId, tx);
    const instruction = await this.config.instruction(context.binding, tx);
    if (
      context.ownerUserId === reviewerUserId ||
      context.intent.totalMinor > instruction.maxAmountMinor ||
      context.intent.expiresAt <= new Date() ||
      !['CREATED', 'AWAITING_PAYMENT', 'PROCESSING'].includes(context.intent.status)
    )
      throw manualConflict('MANUAL_CONFIRMATION_NOT_ELIGIBLE');
    const state = await tx.moneyManualReview.findUnique({ where: { paymentIntentId } });
    if (
      !state ||
      state.state !== 'CONFIRMING' ||
      !state.pendingDecisionId ||
      !state.currentReceiptId
    )
      throw manualConflict('PENDING_REVIEW_REQUIRED');
    const decision = await tx.moneyManualReviewDecision.findUniqueOrThrow({
      where: { id: state.pendingDecisionId },
    });
    const receipt = await tx.moneyManualReceiptVersion.findUniqueOrThrow({
      where: { id: state.currentReceiptId },
      include: { mediaAsset: true },
    });
    if (
      decision.action !== 'PENDING_APPROVAL' ||
      decision.reviewerUserId !== reviewerUserId ||
      decision.receiptId !== receipt.id ||
      decision.paymentIntentId !== paymentIntentId ||
      state.version !== decision.expectedVersion + 1 ||
      !decision.settlementId ||
      receipt.mediaAssetId !== receiptMediaAssetId ||
      !receipt.submittedAt ||
      receipt.mediaAsset.purpose !== 'FINANCIAL_RECEIPT' ||
      receipt.mediaAsset.visibility !== 'RESTRICTED' ||
      receipt.mediaAsset.ownerUserId !== context.ownerUserId ||
      !receipt.mediaAsset.uploadCompletedAt ||
      receipt.mediaAsset.scanState !== 'CLEAN' ||
      !receipt.mediaAsset.sha256 ||
      receipt.mediaAsset.deletedAt ||
      receipt.mediaAsset.erasureStartedAt
    )
      throw manualConflict('STALE_RECEIPT_REVISION');
    const inspection = await tx.moneyManualReceiptInspection.findUnique({
      where: { id: decision.inspectionId },
    });
    if (
      !inspection ||
      inspection.receiptId !== receipt.id ||
      inspection.reviewerUserId !== reviewerUserId ||
      inspection.sha256 !== receipt.mediaAsset.sha256
    )
      throw manualConflict('CURRENT_RECEIPT_INSPECTION_REQUIRED');
    const settlement = await this.review.validateSettlement(
      decision.settlementId,
      reviewerUserId,
      { ...context, instruction },
      tx,
    );
    return { ...context, instruction, state, decision, receipt, settlement };
  }

  async accept(
    input: Parameters<MoneyReceiptAcceptancePort['accept']>[0],
    tx: PrismaTx,
  ): Promise<NormalizedMoneyExternalEvent> {
    if (!this.isConfigured(input.binding)) throw manualConflict('METHOD_DISABLED');
    const candidate = await this.candidate(
      input.paymentIntentId,
      input.reviewerUserId,
      input.receiptMediaAssetId,
      tx,
    );
    if (
      candidate.ownerUserId !== input.ownerUserId ||
      Object.entries(input.binding).some(
        ([key, value]) => candidate.binding[key as keyof MoneyTransportBinding] !== value,
      )
    )
      throw manualConflict('MANUAL_BINDING_MISMATCH');
    const attempt = await tx.moneyPaymentAttempt.findFirst({
      where: {
        paymentIntentId: input.paymentIntentId,
        status: 'STARTED',
        dispatch: { isNot: null },
      },
      orderBy: { attemptNo: 'desc' },
    });
    return {
      contractVersion: MONEY_CONTRACT_VERSION,
      adapterId: candidate.binding.adapterId,
      mode: candidate.binding.mode,
      accountReference: candidate.binding.accountReference,
      externalEventId: `manual-decision:${candidate.decision.id}`,
      externalConfirmationId: candidate.settlement.referenceCanonical,
      externalOperationId: null,
      paymentIntentId: input.paymentIntentId,
      paymentAttemptId: attempt?.id ?? null,
      source: 'MANUAL_REVIEW',
      amount: toMoneyWire({
        amountMinor: candidate.settlement.amountMinor,
        currency: candidate.settlement.currency,
      }),
      confirmedAt: candidate.settlement.occurredAt.toISOString(),
      receiptMediaAssetId: input.receiptMediaAssetId,
      reviewerUserId: input.reviewerUserId,
    };
  }

  async finalizeConfirmation(event: NormalizedMoneyExternalEvent, tx: PrismaTx): Promise<void> {
    if (event.source !== 'MANUAL_REVIEW' || !event.reviewerUserId || !event.receiptMediaAssetId)
      throw manualConflict('MANUAL_CONFIRMATION_REQUIRED');
    const candidate = await this.candidate(
      event.paymentIntentId,
      event.reviewerUserId,
      event.receiptMediaAssetId,
      tx,
    );
    const { intent, binding, state, decision, settlement, receipt } = candidate;
    if (
      event.externalEventId !== `manual-decision:${decision.id}` ||
      event.externalConfirmationId !== settlement.referenceCanonical ||
      event.externalOperationId !== null ||
      event.adapterId !== binding.adapterId ||
      event.mode !== binding.mode ||
      event.accountReference !== binding.accountReference ||
      event.amount.amountMinor !== settlement.amountMinor.toString() ||
      event.amount.currency !== settlement.currency ||
      event.confirmedAt !== settlement.occurredAt.toISOString()
    )
      throw manualConflict('MANUAL_EVENT_MISMATCH');
    // Serialize same-provider evidence reuse across different obligations; the
    // scoped deposit UNIQUE claim independently excludes financial duplicates.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r30.receipt-owner:${intent.providerProfileId}`}, 0))`;
    if (
      await tx.moneyManualReceiptVersion.findFirst({
        where: {
          paymentIntentId: { not: intent.id },
          mediaAsset: { sha256: receipt.mediaAsset.sha256 },
          paymentIntent: {
            providerProfileId: intent.providerProfileId,
            confirmation: { isNot: null },
          },
        },
        select: { id: true },
      })
    )
      throw manualConflict('APPROVED_RECEIPT_REUSE');
    const approved = await tx.moneyManualReviewDecision.create({
      data: {
        paymentIntentId: intent.id,
        receiptId: receipt.id,
        inspectionId: decision.inspectionId,
        reviewerUserId: decision.reviewerUserId,
        action: 'APPROVED',
        settlementId: settlement.id,
        expectedVersion: state.version,
        providerMessage: decision.providerMessage,
        internalNote: decision.internalNote,
        idempotencyKey: `r30_final_${manualDigest(decision.id)}`,
        requestDigest: manualDigest({ decisionId: decision.id, event }),
      },
    });
    await tx.moneyManualSettlementClaim.create({
      data: { settlementId: settlement.id, paymentIntentId: intent.id, decisionId: approved.id },
    });
    await tx.moneyManualReview.update({
      where: { paymentIntentId: intent.id },
      data: {
        state: 'APPROVED',
        version: { increment: 1 },
        pendingDecisionId: null,
        nextAttemptAt: null,
        reconciliationRequired: false,
        lastErrorCode: null,
      },
    });
    await this.audit.record(
      {
        type: 'MONEY_MANUAL_REVIEW_DECIDED',
        userId: decision.reviewerUserId,
        metadata: {
          paymentIntentId: intent.id,
          manualDecisionId: approved.id,
          manualSettlementId: settlement.id,
          reason: 'APPROVED',
        },
      },
      tx,
    );
    await this.review.notice(
      candidate.ownerUserId,
      intent.id,
      approved.id,
      decision.providerMessage,
      decision.reviewerUserId,
      tx,
    );
  }
}
