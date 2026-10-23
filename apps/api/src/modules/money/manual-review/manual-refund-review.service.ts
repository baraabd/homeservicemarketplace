import { Injectable } from '@nestjs/common';
import { fromMoneyWire, type MoneyWire } from '@homeservicemarketplace/contracts';
import { AuditService } from '../../iam/audit/audit.service';
import { ManualRailConfiguration } from '../adapters/manual/manual-rail.config';
import {
  ManualReviewService,
  manualConflict,
  manualDigest,
  manualInvalid,
  manualNotFound,
} from './manual-review.service';

export interface ManualRefundEvidenceInput {
  type: 'DISPATCH' | 'CONFIRM_SUCCEEDED' | 'CONFIRM_FAILED';
  externalOperationId: string;
  reference?: string;
  amount: MoneyWire;
  evidenceSource: 'SANDBOX_OPERATOR_SIMULATION';
  internalNote?: string;
}

@Injectable()
export class ManualRefundReviewService {
  constructor(
    private readonly review: ManualReviewService,
    private readonly config: ManualRailConfiguration,
    private readonly audit: AuditService,
  ) {}

  async record(
    userId: string,
    key: string,
    refundId: string,
    input: ManualRefundEvidenceInput,
  ): Promise<{ refundId: string; state: string }> {
    const reference = input.reference?.trim() || null;
    if (
      !['DISPATCH', 'CONFIRM_SUCCEEDED', 'CONFIRM_FAILED'].includes(input.type) ||
      input.evidenceSource !== 'SANDBOX_OPERATOR_SIMULATION' ||
      typeof input.externalOperationId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(input.externalOperationId) ||
      (input.type !== 'DISPATCH' &&
        (!reference || reference.length > 200 || /\p{Cc}/u.test(reference))) ||
      (input.internalNote?.length ?? 0) > 2000
    )
      throw manualInvalid('INVALID_REFUND_EVIDENCE');
    let amount;
    try {
      amount = fromMoneyWire(input.amount);
    } catch {
      throw manualInvalid('INVALID_REFUND_AMOUNT');
    }
    const request = {
      refundId,
      ...input,
      reference,
      internalNote: input.internalNote?.trim() || null,
    };
    return this.review.runMutation(
      userId,
      key,
      'R30_REFUND_EVIDENCE',
      request,
      'money:refund:review',
      async (tx) => {
        if (!(await tx.moneyManualRefundOperation.findUnique({ where: { refundId } })))
          throw manualNotFound();
      },
      async (tx) => {
        await tx.$queryRaw`SELECT "refundId" FROM "MoneyManualRefundOperation" WHERE "refundId" = ${refundId} FOR UPDATE`;
        const operation = await tx.moneyManualRefundOperation.findUniqueOrThrow({
          where: { refundId },
          include: { refund: { include: { paymentConfirmation: true } } },
        });
        const context = await this.review.context(
          operation.refund.paymentConfirmation.paymentIntentId,
          tx,
        );
        await this.config.instruction(context.binding, tx);
        if (
          userId === context.ownerUserId ||
          operation.amountMinor !== amount.amountMinor ||
          operation.currency !== amount.currency ||
          ['SUCCEEDED', 'FAILED'].includes(operation.state)
        )
          throw manualConflict('REFUND_EVIDENCE_CONFLICT');
        if (input.type === 'DISPATCH') {
          if (operation.dispatchUserId || operation.externalOperationId)
            throw manualConflict('REFUND_ALREADY_DISPATCHED');
          await tx.moneyManualRefundOperation.update({
            where: { refundId },
            data: {
              dispatchUserId: userId,
              externalOperationId: input.externalOperationId,
              state: 'UNKNOWN',
            },
          });
        } else {
          if (
            !operation.dispatchUserId ||
            operation.dispatchUserId === userId ||
            operation.externalOperationId !== input.externalOperationId ||
            operation.state !== 'UNKNOWN'
          )
            throw manualConflict('INDEPENDENT_REFUND_CONFIRMATION_REQUIRED');
          await this.review.authorize(operation.dispatchUserId, 'money:refund:review', tx);
          await tx.moneyManualRefundOperation.update({
            where: { refundId },
            data: {
              confirmationUserId: userId,
              reference,
              state: input.type === 'CONFIRM_SUCCEEDED' ? 'SUCCEEDED' : 'FAILED',
            },
          });
        }
        await tx.moneyManualRefundEvent.create({
          data: {
            refundId,
            type: input.type,
            recordedByUserId: userId,
            reference,
            externalOperationId: input.externalOperationId,
            evidenceSource: input.evidenceSource,
            internalNote: request.internalNote,
            idempotencyKey: key,
            requestDigest: manualDigest(request),
          },
        });
        await this.audit.record(
          {
            type: 'MONEY_MANUAL_REFUND_RECORDED',
            userId,
            metadata: { refundId, reason: input.type },
          },
          tx,
        );
        return {
          refundId,
          state:
            input.type === 'DISPATCH'
              ? 'UNKNOWN'
              : input.type === 'CONFIRM_SUCCEEDED'
                ? 'SUCCEEDED'
                : 'FAILED',
        };
      },
    );
  }
}
