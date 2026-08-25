import { Inject, Injectable, Logger } from '@nestjs/common';

import { type MediaScanState } from '@homeservicemarketplace/database';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../../infrastructure/prisma/transaction.runner';
import { OutboxRepository } from '../../../../infrastructure/outbox/outbox.repository';
import { OutboxEventType } from '../../../../infrastructure/outbox/outbox.tokens';
import { AuditService } from '../../../iam/audit/audit.service';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../../infrastructure/storage/restricted-object-storage.port';
import { VerificationSettingsService } from '../verification-settings.service';
import { MALWARE_SCANNER_PORT, MalwareScannerPort } from './malware-scanner.port';
import { validateEvidenceBytes } from './evidence-validation';
import { decideScanWrite, type PersistedScanState } from './scan-decision';

// Sprint 9B.4 — turning stored bytes into a scan state.
//
// docs/adr/0009-restricted-identity-media.md §5
//
// The decisions are already made elsewhere and are pure: evidence-validation.ts
// decides what a file IS, scan-decision.ts decides whether a verdict may
// overwrite what is recorded. This class does the I/O between them, so what it
// is responsible for is the ORDER and the failure handling:
//
//   validate BEFORE scanning   handing a malformed file to a scanner asks a
//                              question about bytes we have already decided not
//                              to accept, and the answer gets recorded as
//                              though it meant something
//   claim conditionally        two workers must not both write
//   never throw upward         one unreadable object must not abandon the rest
//                              of the batch
//   log counts only            this loop sees every identity document in the
//                              system; it is the last place that should be
//                              describing them
//
// NOT exposed over HTTP. It is driven by an operator process or a scheduler.

/** Batch ceiling. Scanning is background work with an unbounded queue behind
 *  it; bounded work per invocation keeps a backlog from becoming an outage. */
const DEFAULT_BATCH = 25;
const MAX_BATCH = 200;

/** How long a SCAN_FAILED asset is left alone before it is tried again.
 *  Without this, a permanently broken scanner turns the sweep into a hot loop
 *  over the same rows. */
const RETRY_AFTER_SECONDS = 300;

export interface ScanSweepResult {
  examined: number;
  cleared: number;
  quarantined: number;
  rejected: number;
  failed: number;
  /** Nothing to write: a duplicate verdict, an unconfigured scanner, or a race
   *  another worker won. */
  skipped: number;
}

interface ScannableAsset {
  id: string;
  storageKey: string;
  scanState: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  originalFilename: string | null;
  sizeBytes: number;
  ownerUserId: string | null;
  verificationCaseId: string | null;
}

const AUDIT_TYPE = {
  CLEAN: 'VERIFICATION_EVIDENCE_SCAN_CLEARED',
  QUARANTINED: 'VERIFICATION_EVIDENCE_SCAN_QUARANTINED',
  SCAN_FAILED: 'VERIFICATION_EVIDENCE_SCAN_FAILED',
  REJECTED: 'VERIFICATION_EVIDENCE_REJECTED',
} as const;

@Injectable()
export class EvidenceScanService {
  private readonly log = new Logger(EvidenceScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RESTRICTED_OBJECT_STORAGE)
    private readonly objects: RestrictedObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly scanner: MalwareScannerPort,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
    private readonly settings: VerificationSettingsService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Scan a bounded batch of evidence that has not been judged yet.
   *
   * Selects PENDING (never scanned) and SCAN_FAILED (the infrastructure failed,
   * nobody judged the file) — never a terminal state, because releasing one of
   * those is exactly what must not happen.
   */
  async scanPending(options: { limit?: number; now?: Date } = {}): Promise<ScanSweepResult> {
    const now = options.now ?? new Date();
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_BATCH), MAX_BATCH);
    const retryBefore = new Date(now.getTime() - RETRY_AFTER_SECONDS * 1000);

    const candidates = (await this.prisma.client.mediaAsset.findMany({
      where: {
        visibility: 'RESTRICTED',
        deletedAt: null,
        uploadCompletedAt: { not: null },
        OR: [
          { scanState: 'PENDING' },
          // A failed scan is retried, but not immediately: a permanently
          // broken scanner would otherwise turn this into a hot loop.
          { scanState: 'SCAN_FAILED', scannedAt: { lt: retryBefore } },
          { scanState: 'SCAN_FAILED', scannedAt: null },
        ],
      },
      select: {
        id: true,
        storageKey: true,
        scanState: true,
        declaredMimeType: true,
        detectedMimeType: true,
        originalFilename: true,
        sizeBytes: true,
        ownerUserId: true,
        verificationCaseId: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })) as ScannableAsset[];

    const result: ScanSweepResult = {
      examined: 0,
      cleared: 0,
      quarantined: 0,
      rejected: 0,
      failed: 0,
      skipped: 0,
    };

    if (candidates.length === 0) return result;

    const { maxBytes } = await this.settings.evidenceLimits();

    for (const asset of candidates) {
      result.examined += 1;
      try {
        await this.processOne(asset, maxBytes, now, result);
      } catch {
        // A defect in one asset's handling must not abandon the batch. The
        // asset keeps its current state and is picked up next sweep.
        result.failed += 1;
        this.log.warn({ msg: 'evidence.scan.unhandled', assetId: asset.id });
      }
    }

    // Counts only. This loop sees every identity document in the system; it is
    // the last place that should be describing one.
    this.log.log({
      msg: 'evidence.scan.swept',
      examined: result.examined,
      cleared: result.cleared,
      quarantined: result.quarantined,
      rejected: result.rejected,
      failed: result.failed,
      skipped: result.skipped,
    });

    return result;
  }

  private async processOne(
    asset: ScannableAsset,
    maxBytes: number,
    now: Date,
    result: ScanSweepResult,
  ): Promise<void> {
    // 1. Read the object. An unreadable object is a scan FAILURE, never a
    //    clean file and never a rejection — nobody judged the bytes.
    let bytes: Buffer;
    try {
      bytes = await this.readObject(asset.storageKey, maxBytes);
    } catch {
      await this.write(asset, 'SCAN_FAILED', now, result, { reason: 'STORAGE_UNREADABLE' });
      return;
    }

    // 2. Validate BEFORE the scanner is asked anything.
    //
    //    Checked against the type the SERVER detected at upload, not the type
    //    the client declared: a disagreement now means the stored object is not
    //    what we accepted.
    const validation = validateEvidenceBytes({
      declaredMime: asset.detectedMimeType ?? asset.declaredMimeType,
      filename: asset.originalFilename,
      bytes,
      maxBytes,
    });
    if (!validation.ok) {
      await this.write(asset, 'REJECTED', now, result, { reason: validation.code });
      return;
    }

    // 3. Scan. The port says adapters resolve rather than throw; this does not
    //    depend on that promise being kept.
    let verdict;
    try {
      verdict = await this.scanner.scan({ bytes, assetId: asset.id });
    } catch {
      verdict = {
        state: 'FAILED' as const,
        scannerId: this.scanner.scannerId,
        reason: 'scanner-threw',
      };
    }

    // 4. May this verdict overwrite what is recorded?
    const decision = decideScanWrite({
      current: asset.scanState as PersistedScanState,
      verdict,
      scanner: this.scanner,
    });

    if (!decision.write) {
      result.skipped += 1;
      return;
    }

    await this.write(asset, decision.next, now, result, {
      signature: verdict.state === 'INFECTED' ? verdict.signature : undefined,
    });
  }

  /**
   * Read at most `maxBytes + 1`.
   *
   * The extra byte is what makes "too large" detectable: reading exactly the
   * ceiling cannot distinguish a file that fits from one that was cut off at
   * it. Bounded because this runs against objects chosen by strangers.
   */
  private async readObject(key: string, maxBytes: number): Promise<Buffer> {
    const stream = await this.objects.openReadStream(key);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buf = Buffer.from(chunk as Buffer);
      total += buf.length;
      if (total > maxBytes + 1) {
        stream.destroy();
        break;
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Claim the row and record the outcome, in one transaction.
   *
   * The update is CONDITIONAL on the state we observed. Updating by id alone
   * would let two workers both write, with the second silently overwriting a
   * decision made from a different reading of the file.
   *
   * The audit row and the outbox event share the transaction with the state
   * change, so a crash cannot leave a document quarantined with nothing
   * announcing it.
   */
  private async write(
    asset: ScannableAsset,
    next: PersistedScanState,
    now: Date,
    result: ScanSweepResult,
    detail: { reason?: string; signature?: string } = {},
  ): Promise<void> {
    const claimed = await this.tx.run(async (trx) => {
      const client = trx as unknown as typeof this.prisma.client;

      const { count } = await client.mediaAsset.updateMany({
        // Conditional on the state we OBSERVED, so a racing worker's write
        // loses instead of silently overwriting a decision made from a
        // different reading of the file.
        where: { id: asset.id, scanState: asset.scanState as MediaScanState },
        data: {
          scanState: next as MediaScanState,
          scannedAt: now,
          ...(detail.signature ? { scanSignature: detail.signature } : {}),
        },
      });
      if (count !== 1) return false;

      await this.audit.record(
        {
          type: AUDIT_TYPE[next as keyof typeof AUDIT_TYPE],
          userId: asset.ownerUserId ?? null,
          // Ids and a code. No storage key, no filename, no hash: an audit
          // table outlives the document and is read by more people than may
          // ever open one.
          metadata: {
            caseId: asset.verificationCaseId,
            assetId: asset.id,
            ...(detail.reason ? { reason: detail.reason } : {}),
            ...(detail.signature ? { signature: detail.signature } : {}),
          },
        },
        trx,
      );

      // Enqueued through the repository rather than a raw create, so it
      // carries the aggregate identity and dedupe key the worker relies on.
      //
      // The dedupe key is (asset, state): a replay of the same scan announces
      // once, while a genuine rescan that CHANGES the state — clean today,
      // quarantined after a signature update — is a different key and is
      // announced properly.
      await this.outbox.enqueue(
        {
          aggregateType: 'MediaAsset',
          aggregateId: asset.id,
          eventType: OutboxEventType.EVIDENCE_SCANNED,
          payload: {
            assetId: asset.id,
            caseId: asset.verificationCaseId,
            scanState: next,
          },
          dedupeKey: `evidence.scanned:${asset.id}:${next}`,
        },
        trx,
      );

      return true;
    });

    if (!claimed) {
      result.skipped += 1;
      return;
    }

    switch (next) {
      case 'CLEAN':
        result.cleared += 1;
        break;
      case 'QUARANTINED':
        result.quarantined += 1;
        break;
      case 'REJECTED':
        result.rejected += 1;
        break;
      case 'SCAN_FAILED':
        result.failed += 1;
        break;
      default:
        break;
    }
  }
}
