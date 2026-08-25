import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import {
  RESTRICTED_OBJECT_STORAGE,
  RestrictedObjectStoragePort,
} from '../../../../infrastructure/storage/restricted-object-storage.port';
import {
  CLEANUP_GRACE_SECONDS,
  cleanupDeletionReason,
  isSweepable,
} from './evidence-cleanup-policy';

// Sprint 9B.3 — the sweep for abandoned evidence preparations.
//
// docs/adr/0009-restricted-identity-media.md · docs/adr/0012
//
// A provider who starts an upload and closes the tab leaves bytes in the
// restricted bucket that no document references and no reviewer will ever see.
// They are still identity documents, so leaving them is a data-protection
// problem, not a housekeeping one.
//
// This is the PERIODIC half of cleanup. The in-request half already exists in
// EvidenceUploadService: when the object lands and the row write then fails,
// the object is deleted before the error surfaces. This handles the case
// nothing can compensate for synchronously — the client that simply never
// came back.
//
// NOT exposed over HTTP. A route that deletes evidence in bulk is a weapon; it
// is invoked by an operator process or a scheduler, and the batch bound below
// is what stops one invocation from becoming an outage.

/** Batch ceiling. A sweep is a background chore, not a migration: bounded work
 *  per invocation keeps it off the critical path and makes a runaway
 *  impossible rather than merely unlikely. */
const DEFAULT_BATCH = 100;
const MAX_BATCH = 500;

export interface SweepResult {
  /** Rows that matched and were processed. */
  examined: number;
  /** Rows whose bytes are now gone and whose row is marked. */
  deleted: number;
  /** Rows another sweep marked first. Not an error — see the claim below. */
  raced: number;
  /** Rows whose storage delete failed. Left untouched for the next run. */
  failed: number;
}

@Injectable()
export class EvidenceCleanupService {
  private readonly log = new Logger(EvidenceCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RESTRICTED_OBJECT_STORAGE)
    private readonly objects: RestrictedObjectStoragePort,
  ) {}

  /**
   * Delete the bytes of expired, never-finalized preparations.
   *
   * ORDER IS THE DESIGN. The object is deleted FIRST, and only then is the row
   * marked. MediaAsset.deletedAt is documented as "set only after the object is
   * confirmed gone from storage", because marking first produces rows that
   * claim a deletion which never happened — and those rows are what a
   * data-protection answer would later be built from.
   *
   * The consequence of this order is an object that may be deleted twice
   * (harmless: deleteObject is idempotent) rather than a row that lies.
   */
  async sweepExpiredPreparations(
    options: { limit?: number; now?: Date } = {},
  ): Promise<SweepResult> {
    const now = options.now ?? new Date();
    const limit = Math.min(Math.max(1, options.limit ?? DEFAULT_BATCH), MAX_BATCH);

    // The grace period is applied in SQL as well as in the pure rule. The rule
    // is the authority and is re-checked per row below; doing it here too keeps
    // the batch from being filled with rows that will all be refused.
    const cutoff = new Date(now.getTime() - CLEANUP_GRACE_SECONDS * 1000);

    const candidates = await this.prisma.client.mediaAsset.findMany({
      where: {
        visibility: 'RESTRICTED',
        uploadCompletedAt: null,
        deletedAt: null,
        uploadExpiresAt: { not: null, lt: cutoff },
      },
      select: {
        id: true,
        storageKey: true,
        uploadCompletedAt: true,
        deletedAt: true,
        uploadExpiresAt: true,
      },
      orderBy: { uploadExpiresAt: 'asc' },
      take: limit,
    });

    const result: SweepResult = { examined: 0, deleted: 0, raced: 0, failed: 0 };

    for (const asset of candidates) {
      // Re-checked against the pure rule rather than trusting the query. The
      // two can only disagree if the WHERE clause drifts from the rule, and
      // this is a delete.
      if (!isSweepable({ asset, now })) continue;
      result.examined += 1;

      try {
        await this.objects.deleteObject(asset.storageKey);
      } catch {
        // Leave the row alone. The next sweep retries, and the bytes are still
        // unreachable meanwhile: the asset never completed, so no document
        // references it and the read route refuses anything not CLEAN.
        result.failed += 1;
        this.log.warn({ msg: 'evidence.cleanup.storage_delete_failed', assetId: asset.id });
        continue;
      }

      // Conditional claim. Two sweeps running together both delete the object
      // (idempotent) and exactly one marks the row, so the count is honest
      // rather than double-reported.
      const { count } = await this.prisma.client.mediaAsset.updateMany({
        where: { id: asset.id, deletedAt: null, uploadCompletedAt: null },
        data: { deletedAt: now, deletionReason: cleanupDeletionReason() },
      });

      if (count === 1) result.deleted += 1;
      else result.raced += 1;
    }

    if (result.examined > 0) {
      // Counts only. No key, no filename, no owner — this line exists to show
      // the sweep is alive, not to identify whose document went.
      this.log.log({
        msg: 'evidence.cleanup.swept',
        examined: result.examined,
        deleted: result.deleted,
        raced: result.raced,
        failed: result.failed,
      });
    }

    return result;
  }
}
