import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';

// Sprint 09B.29 Phase 4 — the sweep that public media never had.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.3
//
// WHAT WAS WRONG
//
// `EvidenceCleanupService` deletes RESTRICTED bytes and has since Sprint 9B.
// Nothing did the same for PUBLIC ones, and five paths produced objects that
// nothing would ever remove:
//
//   O-1  an avatar uploaded and abandoned before finalize
//   O-2  the previous avatar, after a replacement
//   O-3  the avatar, after a removal
//   O-4  a portfolio image uploaded and abandoned before attach
//   O-5  a portfolio image after the provider deleted the item
//
// O-5 was the worst of them, and not because of the bytes: the delete path
// wrote `MediaAsset.deletedAt` immediately, so the database asserted the
// object was gone while it was still readable at its public URL. The schema
// says that column means "confirmed gone from storage". This service is what
// makes that true.
//
// ORDER IS THE DESIGN, and it is copied from the evidence sweep deliberately.
// The object is deleted FIRST, and only then is the row marked. The
// consequence is an object that may be deleted twice — harmless, because
// `deleteObject` treats absence as success — rather than a row that lies.
// The other order trades a harmless repeat for a false record.

/** What one pass did. Counts only: no keys, no URLs, no owner identifiers. */
export interface PublicMediaSweepResult {
  examined: number;
  deleted: number;
  /** Claimed by a concurrent worker between our delete and our write. */
  raced: number;
  /** Storage refused. The row is left eligible for the next pass. */
  failed: number;
}

export interface PublicMediaSweepOptions {
  /** Rows per pass. Bounded so one sweep cannot hold a connection for minutes. */
  limit: number;
  /**
   * How long an UNFINISHED reservation is left alone.
   *
   * A reservation with no `uploadCompletedAt` may be a dead upload — or a live
   * one, still transferring. Deleting the object out from under a provider who
   * is watching a progress bar would be a worse bug than the leak. So a
   * reservation is only eligible once `uploadExpiresAt` has passed AND this
   * grace period on top of it has elapsed.
   */
  reservationGraceMs: number;
  now?: Date;
}

@Injectable()
export class PublicMediaCleanupService {
  private readonly log = new Logger(PublicMediaCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly objects: StoragePort,
  ) {}

  /**
   * Delete the bytes for public assets that are due, then record it.
   *
   * Two populations, one query:
   *
   *   RETIRED       `retainUntil <= now` — a replaced avatar, a removed
   *                 avatar, a deleted portfolio item. The provider asked.
   *   ABANDONED     `uploadCompletedAt IS NULL` and the reservation expired
   *                 more than `reservationGraceMs` ago. Nobody asked, because
   *                 nobody ever came back.
   *
   * Both are scoped to `visibility: 'PUBLIC'`, so this can never touch
   * restricted evidence even if a row were mis-linked — the mirror of the
   * scope the evidence sweep applies in the other direction.
   *
   * ACTIVE assets match neither: they have `uploadCompletedAt` set and
   * `retainUntil` null.
   */
  async sweep(options: PublicMediaSweepOptions): Promise<PublicMediaSweepResult> {
    const now = options.now ?? new Date();
    const abandonedCutoff = new Date(now.getTime() - options.reservationGraceMs);

    const candidates = await this.prisma.client.mediaAsset.findMany({
      where: {
        visibility: 'PUBLIC',
        // Never re-examine something already recorded as gone.
        deletedAt: null,
        OR: [
          { retainUntil: { not: null, lte: now } },
          { uploadCompletedAt: null, uploadExpiresAt: { not: null, lte: abandonedCutoff } },
        ],
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: 'asc' },
      take: options.limit,
    });

    const result: PublicMediaSweepResult = {
      examined: candidates.length,
      deleted: 0,
      raced: 0,
      failed: 0,
    };

    for (const asset of candidates) {
      try {
        // 1. The bytes. Idempotent, so a second worker doing the same thing at
        //    the same time is not a conflict.
        await this.objects.deleteObject(asset.storageKey);
      } catch {
        // The object is still there. Leaving the row untouched keeps it
        // eligible for the next pass, which is the whole retry mechanism —
        // there is no dead-letter state to get stuck in.
        //
        // No key and no error detail in the log line: this runs on every pass
        // and a storage key locates somebody's photo.
        result.failed += 1;
        this.log.warn({ msg: 'public.media.cleanup.storage_delete_failed', assetId: asset.id });
        continue;
      }

      // 2. Only now. A conditional claim, so two workers that both deleted the
      //    same (absent-the-second-time) object produce ONE record between
      //    them rather than two writes racing.
      const claimed = await this.prisma.client.mediaAsset.updateMany({
        where: { id: asset.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (claimed.count === 1) result.deleted += 1;
      else result.raced += 1;
    }

    if (result.examined > 0) {
      this.log.log({ msg: 'public.media.cleanup.swept', ...result });
    }
    return result;
  }
}
