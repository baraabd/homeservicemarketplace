import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type {
  ManualReceiptReservationRequestV1,
  ManualReceiptReservationV1,
  ManualPaymentDetailV1,
} from '@homeservicemarketplace/contracts';
import type { PrismaTx } from '@homeservicemarketplace/database';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectAlreadyExistsError,
  RestrictedObjectStoragePort,
} from '../../../infrastructure/storage/restricted-object-storage.port';
import { AuditService } from '../../iam/audit/audit.service';
import { validateEvidenceBytes } from '../../provider/verification/media/evidence-validation';
import {
  extensionForEvidenceMime,
  isEvidenceMimeType,
  safeDisplayFilename,
} from '../../provider/verification/media/file-signature';
import {
  MALWARE_SCANNER_PORT,
  MalwareScannerPort,
  scanStateForVerdict,
} from '../../provider/verification/media/malware-scanner.port';
import {
  MANUAL_TX_OPTIONS,
  ManualReviewService,
  manualConflict,
  manualInvalid,
  manualNotFound,
} from './manual-review.service';

/** Bounded reads use the backend's expected size and verify the full digest before
 * a clean receipt may be inspected. A timeout or truncated stream is no evidence. */
export async function readReceiptBytes(
  objects: RestrictedObjectStoragePort,
  asset: {
    storageKey: string;
    sizeBytes: number;
    sha256: string | null;
  },
): Promise<Buffer> {
  if (asset.sizeBytes <= 0 || asset.sizeBytes > 10 * 1024 * 1024) throw manualNotFound();
  const stream = await objects.openReadStream(asset.storageKey, { sizeBytes: asset.sizeBytes });
  const chunks: Buffer[] = [];
  let total = 0;
  const timeout = setTimeout(() => stream.destroy(new Error('receipt-read-timeout')), 15_000);
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      total += bytes.length;
      if (total > asset.sizeBytes) throw manualNotFound();
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (
      total !== asset.sizeBytes ||
      (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    )
      throw manualNotFound();
    return bytes;
  } finally {
    clearTimeout(timeout);
    stream.destroy();
  }
}

@Injectable()
export class ReceiptUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionRunner,
    private readonly review: ManualReviewService,
    private readonly audit: AuditService,
    @Inject(RESTRICTED_OBJECT_STORAGE) private readonly objects: RestrictedObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT) private readonly scanner: MalwareScannerPort,
  ) {}

  async reserve(
    userId: string,
    key: string,
    paymentIntentId: string,
    input: ManualReceiptReservationRequestV1,
  ): Promise<ManualReceiptReservationV1> {
    if (
      !isEvidenceMimeType(input.contentType) ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes < 1 ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0
    )
      throw manualInvalid('INVALID_RECEIPT_RESERVATION');
    const request = {
      paymentIntentId,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      expectedVersion: input.expectedVersion,
      filename: safeDisplayFilename(input.filename),
    };
    return this.review.runMutation(
      userId,
      key,
      'R30_RESERVE_RECEIPT',
      request,
      'money:purchase:self',
      (tx) => this.review.context(paymentIntentId, tx, userId),
      async (tx) => {
        await this.review.lockIntent(paymentIntentId, tx);
        const { instruction, intent } = await this.review.editable(paymentIntentId, tx, userId);
        if (input.sizeBytes > instruction.receiptMaxBytes) throw manualInvalid('RECEIPT_TOO_LARGE');
        const state = await tx.moneyManualReview.findUnique({ where: { paymentIntentId } });
        if (
          (state?.version ?? 0) !== input.expectedVersion ||
          (state && !['RECEIPT_REQUIRED', 'ACTION_REQUIRED'].includes(state.state))
        )
          throw manualConflict('STALE_RECEIPT_REVISION');
        const count = await tx.moneyManualReceiptVersion.count({ where: { paymentIntentId } });
        if (count >= 100) throw manualConflict('RECEIPT_HISTORY_LIMIT');
        const assetId = randomUUID();
        const expiresAt = new Date(
          Math.min(Date.now() + instruction.uploadTtlSeconds * 1000, intent.expiresAt.getTime()),
        );
        const asset = await tx.mediaAsset.create({
          data: {
            id: assetId,
            purpose: 'FINANCIAL_RECEIPT',
            visibility: 'RESTRICTED',
            ownerUserId: userId,
            storageKey: `financial-receipts/${paymentIntentId}/${assetId}.${extensionForEvidenceMime(input.contentType as 'image/png' | 'image/jpeg' | 'application/pdf')}`,
            declaredMimeType: input.contentType,
            sizeBytes: input.sizeBytes,
            originalFilename: request.filename,
            uploadExpiresAt: expiresAt,
            scanState: 'PENDING',
            retainUntil: new Date(Date.now() + instruction.retentionDays * 86_400_000),
          },
        });
        const receipt = await tx.moneyManualReceiptVersion.create({
          data: {
            paymentIntentId,
            mediaAssetId: asset.id,
            revision: count + 1,
            predecessorId: state?.currentReceiptId ?? null,
          },
        });
        const updated = await tx.moneyManualReview.upsert({
          where: { paymentIntentId },
          create: {
            paymentIntentId,
            instructionVersionId: instruction.id,
            currentReceiptId: receipt.id,
            version: 1,
          },
          update: { currentReceiptId: receipt.id, version: { increment: 1 } },
        });
        return {
          receiptVersionId: receipt.id,
          mediaAssetId: asset.id,
          version: updated.version,
          expiresAt: expiresAt.toISOString(),
          maxBytes: instruction.receiptMaxBytes,
        };
      },
    );
  }

  private async reservation(userId: string, assetId: string, tx: PrismaTx) {
    await this.review.authorize(userId, 'money:purchase:self', tx);
    const receipt = await tx.moneyManualReceiptVersion.findUnique({
      where: { mediaAssetId: assetId },
      include: { mediaAsset: true },
    });
    if (!receipt) throw manualNotFound();
    const context = await this.review.editable(receipt.paymentIntentId, tx, userId);
    const state = await tx.moneyManualReview.findUnique({
      where: { paymentIntentId: receipt.paymentIntentId },
    });
    if (
      !state ||
      state.currentReceiptId !== receipt.id ||
      !['RECEIPT_REQUIRED', 'ACTION_REQUIRED'].includes(state.state) ||
      receipt.submittedAt ||
      receipt.mediaAsset.purpose !== 'FINANCIAL_RECEIPT' ||
      receipt.mediaAsset.visibility !== 'RESTRICTED' ||
      receipt.mediaAsset.deletedAt ||
      receipt.mediaAsset.erasureStartedAt ||
      receipt.mediaAsset.ownerUserId !== userId ||
      !receipt.mediaAsset.uploadExpiresAt ||
      (!receipt.mediaAsset.uploadCompletedAt && receipt.mediaAsset.uploadExpiresAt <= new Date())
    )
      throw manualNotFound();
    return { receipt, ...context };
  }

  async upload(
    userId: string,
    assetId: string,
    input: Readable,
    contentType: string,
  ): Promise<{ mediaAssetId: string }> {
    const initial = await this.transactions.run(
      (tx) => this.reservation(userId, assetId, tx),
      MANUAL_TX_OPTIONS,
    );
    const asset = initial.receipt.mediaAsset;
    if (asset.uploadCompletedAt || contentType !== asset.declaredMimeType)
      throw manualConflict('IMMUTABLE_RECEIPT_CONTENT');
    const chunks: Buffer[] = [];
    let count = 0;
    const timeout = setTimeout(() => input.destroy(new Error('receipt-upload-timeout')), 30_000);
    try {
      for await (const chunk of input) {
        const bytes = Buffer.from(chunk as Uint8Array);
        count += bytes.length;
        if (count > Math.min(asset.sizeBytes, initial.instruction.receiptMaxBytes))
          throw manualInvalid('RECEIPT_TOO_LARGE');
        chunks.push(bytes);
      }
    } finally {
      clearTimeout(timeout);
    }
    if (count !== asset.sizeBytes) throw manualInvalid('RECEIPT_LENGTH_MISMATCH');
    const bytes = Buffer.concat(chunks);
    const validation = validateEvidenceBytes({
      declaredMime: contentType,
      filename: asset.originalFilename,
      bytes,
      maxBytes: initial.instruction.receiptMaxBytes,
    });
    if (!validation.ok) throw manualInvalid(validation.code);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const directory = await mkdtemp(join(tmpdir(), 'hsm-r30-upload-'));
    try {
      const sourcePath = join(directory, 'receipt');
      await writeFile(sourcePath, bytes, { mode: 0o600, flag: 'wx' });
      try {
        await this.objects.putObjectFromFile({
          key: asset.storageKey,
          sourcePath,
          contentType: validation.detected,
          sizeBytes: count,
        });
      } catch (error) {
        if (!(error instanceof RestrictedObjectAlreadyExistsError)) throw error;
        // Crash after write-before-metadata and concurrent identical PUT are
        // recoverable without overwriting even one immutable byte.
        const existing = await readReceiptBytes(this.objects, { ...asset, sha256: digest });
        if (!existing.equals(bytes)) throw manualConflict('IMMUTABLE_RECEIPT_CONTENT');
      }
      await this.transactions.run(async (tx) => {
        await this.review.lockIntent(initial.receipt.paymentIntentId, tx);
        const current = await this.reservation(userId, assetId, tx);
        if (current.receipt.mediaAsset.sha256 && current.receipt.mediaAsset.sha256 !== digest)
          throw manualConflict('IMMUTABLE_RECEIPT_CONTENT');
        await tx.mediaAsset.update({
          where: { id: assetId },
          data: { sha256: digest, detectedMimeType: validation.detected, sizeBytes: count },
        });
        await this.audit.record(
          {
            type: 'MONEY_RECEIPT_UPLOADED',
            userId,
            metadata: {
              paymentIntentId: initial.receipt.paymentIntentId,
              receiptVersionId: initial.receipt.id,
            },
          },
          tx,
        );
      }, MANUAL_TX_OPTIONS);
      return { mediaAssetId: assetId };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  async finalize(userId: string, assetId: string): Promise<ManualPaymentDetailV1> {
    const initial = await this.transactions.run(
      (tx) => this.reservation(userId, assetId, tx),
      MANUAL_TX_OPTIONS,
    );
    const asset = initial.receipt.mediaAsset;
    if (!asset.sha256 || !asset.detectedMimeType) throw manualConflict('RECEIPT_UPLOAD_INCOMPLETE');
    if (asset.uploadCompletedAt && ['CLEAN', 'QUARANTINED', 'REJECTED'].includes(asset.scanState))
      return this.review.detail(
        userId,
        initial.receipt.paymentIntentId,
      ) as Promise<ManualPaymentDetailV1>;
    let bytes: Buffer;
    try {
      bytes = await readReceiptBytes(this.objects, asset);
    } catch {
      throw manualNotFound();
    }
    const validation = validateEvidenceBytes({
      declaredMime: asset.detectedMimeType,
      filename: asset.originalFilename,
      bytes,
      maxBytes: initial.instruction.receiptMaxBytes,
    });
    if (!validation.ok) throw manualInvalid(validation.code);
    const verdict = await this.scanner.scan({ bytes, assetId }).catch(() => ({
      state: 'FAILED' as const,
      scannerId: this.scanner.scannerId,
      reason: 'SCAN_FAILED',
    }));
    // Finance does not accept the deterministic identity-test adapter as proof.
    const scanState = scanStateForVerdict(verdict, {
      isRealScanner: this.scanner.isRealScanner && this.scanner.scannerId !== 'deterministic-test',
    });
    await this.transactions.run(async (tx) => {
      await this.review.lockIntent(initial.receipt.paymentIntentId, tx);
      const current = await this.reservation(userId, assetId, tx);
      if (current.receipt.mediaAsset.sha256 !== asset.sha256)
        throw manualConflict('RECEIPT_DIGEST_CHANGED');
      if (['CLEAN', 'QUARANTINED', 'REJECTED'].includes(current.receipt.mediaAsset.scanState))
        return;
      if (scanState === 'CLEAN') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`r30.receipt-owner:${current.intent.providerProfileId}`}, 0))`;
        if (
          await tx.moneyManualReceiptVersion.findFirst({
            where: {
              paymentIntentId: { not: current.intent.id },
              mediaAsset: { sha256: asset.sha256 },
              paymentIntent: {
                providerProfileId: current.intent.providerProfileId,
                confirmation: { isNot: null },
              },
            },
            select: { id: true },
          })
        )
          throw manualConflict('APPROVED_RECEIPT_REUSE');
      }
      await tx.mediaAsset.update({
        where: { id: assetId },
        data: {
          uploadCompletedAt: current.receipt.mediaAsset.uploadCompletedAt ?? new Date(),
          scanState,
          scannedAt: new Date(),
          ...(verdict.state === 'INFECTED' ? { scanSignature: verdict.signature } : {}),
        },
      });
      await this.audit.record(
        {
          type: 'MONEY_RECEIPT_SCANNED',
          userId,
          metadata: {
            paymentIntentId: initial.receipt.paymentIntentId,
            receiptVersionId: initial.receipt.id,
            reason: scanState,
          },
        },
        tx,
      );
    }, MANUAL_TX_OPTIONS);
    return this.review.detail(
      userId,
      initial.receipt.paymentIntentId,
    ) as Promise<ManualPaymentDetailV1>;
  }

  async retryScans(limit = 10): Promise<number> {
    const now = new Date();
    const receipts = await this.prisma.client.moneyManualReceiptVersion.findMany({
      where: {
        submittedAt: null,
        currentFor: {
          is: {
            state: { in: ['RECEIPT_REQUIRED', 'ACTION_REQUIRED'] },
            instruction: {
              enabled: true,
              mode: 'SANDBOX',
              validFrom: { lte: now },
              validUntil: { gt: now },
              approvedAt: { lte: now },
            },
            paymentIntent: {
              status: { in: ['CREATED', 'AWAITING_PAYMENT'] },
              expiresAt: { gt: now },
              providerProfile: {
                deletedAt: null,
                status: { notIn: ['SUSPENDED', 'REJECTED'] },
                user: {
                  is: {
                    status: 'ACTIVE',
                    isActive: true,
                    deletedAt: null,
                    AND: [
                      { userRoles: { some: { role: { name: 'provider', deletedAt: null } } } },
                      {
                        userRoles: {
                          some: {
                            role: {
                              deletedAt: null,
                              rolePermissions: {
                                some: { permission: { key: 'money:purchase:self' } },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        mediaAsset: {
          purpose: 'FINANCIAL_RECEIPT',
          uploadCompletedAt: { not: null },
          scanState: { in: ['PENDING', 'SCAN_FAILED'] },
          deletedAt: null,
          erasureStartedAt: null,
          OR: [{ scannedAt: null }, { scannedAt: { lte: new Date(Date.now() - 300_000) } }],
        },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 25),
      include: { mediaAsset: true },
    });
    let completed = 0;
    for (const receipt of receipts) {
      if (!receipt.mediaAsset.ownerUserId) continue;
      try {
        await this.finalize(receipt.mediaAsset.ownerUserId, receipt.mediaAssetId);
        completed += 1;
      } catch {
        /* A denied or superseded row never becomes CLEAN. */
      }
    }
    return completed;
  }
}
