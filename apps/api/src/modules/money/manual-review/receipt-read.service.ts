import { Inject, Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../infrastructure/storage/restricted-object-storage.port';
import { AuditService } from '../../iam/audit/audit.service';
import { ManualReviewService, MANUAL_TX_OPTIONS, manualNotFound } from './manual-review.service';
import { readReceiptBytes } from './receipt-upload.service';

@Injectable()
export class ReceiptReadService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly review: ManualReviewService,
    private readonly audit: AuditService,
    @Inject(RESTRICTED_OBJECT_STORAGE) private readonly objects: RestrictedObjectStoragePort,
  ) {}

  async read(
    userId: string,
    assetId: string,
  ): Promise<{ bytes: Buffer; contentType: string; inspectionId: string | null }> {
    const authorize = async () =>
      this.transactions.run(async (tx) => {
        const receipt = await tx.moneyManualReceiptVersion.findUnique({
          where: { mediaAssetId: assetId },
          include: { mediaAsset: true },
        });
        if (!receipt) throw manualNotFound();
        const context = await this.review.context(receipt.paymentIntentId, tx);
        const reviewer = context.ownerUserId !== userId;
        await this.authorizeRead(userId, reviewer ? 'money:receipt:view' : 'money:read:self', tx);
        if (!reviewer) await this.review.context(receipt.paymentIntentId, tx, userId);
        const asset = receipt.mediaAsset;
        if (
          asset.purpose !== 'FINANCIAL_RECEIPT' ||
          asset.visibility !== 'RESTRICTED' ||
          asset.ownerUserId !== context.ownerUserId ||
          !asset.uploadCompletedAt ||
          asset.scanState !== 'CLEAN' ||
          !asset.sha256 ||
          !asset.detectedMimeType ||
          asset.deletedAt ||
          asset.erasureStartedAt
        )
          throw manualNotFound();
        return { receipt, reviewer };
      }, MANUAL_TX_OPTIONS);
    const initial = await authorize();
    let bytes: Buffer;
    try {
      bytes = await readReceiptBytes(this.objects, initial.receipt.mediaAsset);
    } catch {
      throw manualNotFound();
    }
    // Storage can be slow: resolve permission/revision again after the real bytes
    // have been read. Inspection is never recorded for a failed storage read.
    const current = await authorize();
    if (current.receipt.mediaAsset.sha256 !== initial.receipt.mediaAsset.sha256)
      throw manualNotFound();
    const inspectionId = await this.transactions.run(async (tx) => {
      await this.authorizeRead(
        userId,
        current.reviewer ? 'money:receipt:view' : 'money:read:self',
        tx,
      );
      const asset = await tx.mediaAsset.findUnique({ where: { id: assetId } });
      if (
        !asset ||
        asset.scanState !== 'CLEAN' ||
        asset.deletedAt ||
        asset.erasureStartedAt ||
        asset.sha256 !== initial.receipt.mediaAsset.sha256
      )
        throw manualNotFound();
      const inspection = current.reviewer
        ? await tx.moneyManualReceiptInspection.create({
            data: {
              receiptId: current.receipt.id,
              reviewerUserId: userId,
              sha256: asset.sha256!,
            },
          })
        : null;
      await this.audit.record(
        {
          type: 'MONEY_RECEIPT_VIEWED',
          userId,
          metadata: {
            paymentIntentId: current.receipt.paymentIntentId,
            receiptVersionId: current.receipt.id,
            ...(inspection ? { receiptInspectionId: inspection.id } : {}),
          },
        },
        tx,
      );
      return inspection?.id ?? null;
    }, MANUAL_TX_OPTIONS);
    return { bytes, contentType: initial.receipt.mediaAsset.detectedMimeType!, inspectionId };
  }

  /** Receipt existence is private too. Authentication still runs at the HTTP
   * boundary; missing current ownership/finance authority has the same response
   * as a missing receipt, including revocation during a slow storage read. */
  private async authorizeRead(userId: string, permission: string, tx: PrismaTx): Promise<void> {
    try {
      await this.review.authorize(userId, permission, tx);
    } catch (error) {
      if (error instanceof AppError && ['FORBIDDEN', 'UNAUTHORIZED'].includes(error.code))
        throw manualNotFound();
      throw error;
    }
  }
}
