import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { PrismaTx } from '@homeservicemarketplace/database';
import type { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import type { RestrictedObjectStoragePort } from '../../../infrastructure/storage/restricted-object-storage.port';
import { AppError } from '../../../shared/errors/app-error';
import type { AuditService } from '../../iam/audit/audit.service';
import type { ManualReviewService } from './manual-review.service';
import { ReceiptReadService } from './receipt-read.service';

describe('R30 private receipt nondisclosure and current authority', () => {
  function fixture() {
    const bytes = Buffer.from('synthetic receipt');
    const asset = {
      id: 'asset',
      storageKey: 'financial-receipts/intent/asset.pdf',
      sizeBytes: bytes.length,
      purpose: 'FINANCIAL_RECEIPT',
      visibility: 'RESTRICTED',
      ownerUserId: 'owner',
      uploadCompletedAt: new Date(),
      scanState: 'CLEAN',
      detectedMimeType: 'application/pdf',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      deletedAt: null,
      erasureStartedAt: null,
    };
    const tx = {
      moneyManualReceiptVersion: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'receipt',
          paymentIntentId: 'intent',
          mediaAsset: asset,
        }),
      },
      mediaAsset: { findUnique: jest.fn().mockResolvedValue(asset) },
      moneyManualReceiptInspection: { create: jest.fn().mockResolvedValue({ id: 'inspection' }) },
    };
    const review = {
      authorize: jest.fn().mockResolvedValue(new Set(['money:receipt:view'])),
      context: jest.fn().mockResolvedValue({ ownerUserId: 'owner' }),
    };
    const objects = {
      openReadStream: jest.fn().mockImplementation(async () => Readable.from([bytes])),
    };
    const audit = { record: jest.fn() };
    const service = new ReceiptReadService(
      {
        run: (work: (client: PrismaTx) => Promise<unknown>) => work(tx as unknown as PrismaTx),
      } as unknown as TransactionRunner,
      review as unknown as ManualReviewService,
      audit as unknown as AuditService,
      objects as unknown as RestrictedObjectStoragePort,
    );
    return { service, tx, review, objects, audit, bytes };
  }

  it('makes an unauthorized existing receipt indistinguishable from a nonexistent receipt before storage I/O', async () => {
    const f = fixture();
    f.review.authorize.mockRejectedValue(new AppError('FORBIDDEN', 'Permission revoked.', 403));
    const denied = await f.service.read('outsider', 'asset').catch((error: AppError) => error);
    f.tx.moneyManualReceiptVersion.findUnique.mockResolvedValue(null);
    const absent = await f.service.read('outsider', 'missing').catch((error: AppError) => error);
    expect(denied).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(absent).toEqual(denied);
    expect(f.objects.openReadStream).not.toHaveBeenCalled();
    expect(f.tx.moneyManualReceiptInspection.create).not.toHaveBeenCalled();
    expect(f.audit.record).not.toHaveBeenCalled();
  });

  it.each([2, 3])(
    'returns the same private404 if authority is revoked at read phase %i',
    async (phase) => {
      const f = fixture();
      let calls = 0;
      f.review.authorize.mockImplementation(async () => {
        if (++calls === phase) throw new AppError('FORBIDDEN', 'Permission revoked.', 403);
        return new Set(['money:receipt:view']);
      });
      await expect(f.service.read('reviewer', 'asset')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect(f.objects.openReadStream).toHaveBeenCalledTimes(1);
      expect(f.tx.moneyManualReceiptInspection.create).not.toHaveBeenCalled();
      expect(f.audit.record).not.toHaveBeenCalled();
    },
  );

  it('preserves infrastructure failure instead of presenting an authorization denial as successful evidence', async () => {
    const f = fixture();
    f.review.authorize.mockRejectedValue(new Error('database unavailable'));
    await expect(f.service.read('reviewer', 'asset')).rejects.toThrow('database unavailable');
    expect(f.tx.moneyManualReceiptInspection.create).not.toHaveBeenCalled();
  });

  it('records inspection and allowlisted audit identities only after actual bytes and all three current checks', async () => {
    const f = fixture();
    await expect(f.service.read('reviewer', 'asset')).resolves.toEqual({
      bytes: f.bytes,
      contentType: 'application/pdf',
      inspectionId: 'inspection',
    });
    expect(f.review.authorize).toHaveBeenCalledTimes(3);
    expect(f.audit.record).toHaveBeenCalledWith(
      {
        type: 'MONEY_RECEIPT_VIEWED',
        userId: 'reviewer',
        metadata: {
          paymentIntentId: 'intent',
          receiptVersionId: 'receipt',
          receiptInspectionId: 'inspection',
        },
      },
      f.tx,
    );
  });
});
