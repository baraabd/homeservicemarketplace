import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';

// Sprint 09B.29 Phase 4 — an upload is a row before it is an object.
//
// docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md §4.3 (O-1…O-4)
//
// WHAT WAS WRONG
//
// `POST /v1/media/presigned-url` minted a key, handed back an upload URL, and
// recorded NOTHING. The database learned an object existed only if the client
// came back to finalize. So an upload abandoned between the PUT and the
// finalize — a closed tab, a dead connection, a provider who changed their
// mind — left an object in the bucket that no query could find and therefore
// no sweep could ever retire. Not a leak that needed a cleaner: a leak that
// was invisible.
//
// The reservation is created BEFORE the upload URL is returned, so the row
// exists even for an upload that never happens. That ordering is the whole
// point; a row written after the PUT would have exactly the same hole.
//
// OWNERSHIP LIVES HERE, NOT IN THE KEY
//
// `ownerUserId` is the authorization fact. The key contains an opaque owner
// ref so a public URL does not publish an internal id, but no code path
// derives permission by parsing it — the cleanup sweep never lists a bucket,
// and `claim` matches on the owner column.

/** How long a reservation is considered claimable. Comfortably longer than the
 *  presign TTL, because the clock that matters is the provider's upload, not
 *  the signature's validity: a slow upload that finishes after the URL expires
 *  should still find its reservation and fail on the SIGNATURE, with a message
 *  about the upload, rather than silently find no row. */
export const RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface ReserveInput {
  userId: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
}

@Injectable()
export class PublicMediaLedgerService {
  private readonly log = new Logger(PublicMediaLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a public upload the server has just authorised.
   *
   * Idempotent on `storageKey`, which is unique: a retried presign for the same
   * key updates the reservation rather than colliding. In practice keys carry a
   * fresh uuid so this is defensive, but a create that can throw on a retry
   * would turn a harmless duplicate into a failed upload.
   */
  async reserve(input: ReserveInput, now = new Date()): Promise<void> {
    const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
    await this.prisma.client.mediaAsset.upsert({
      where: { storageKey: input.storageKey },
      create: {
        visibility: 'PUBLIC',
        storageKey: input.storageKey,
        declaredMimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        ownerUserId: input.userId,
        // NULL is the point: this is what makes the row a reservation rather
        // than an attachment, and what the sweep looks for.
        uploadCompletedAt: null,
        uploadExpiresAt: expiresAt,
      },
      update: { uploadExpiresAt: expiresAt },
    });
    // No key, and no URL. This line is written on every presign.
    this.log.log({ msg: 'public.media.reserved', userId: input.userId });
  }

  /**
   * Claim a reservation at finalize. Returns the asset id, or null.
   *
   * CONDITIONAL, and every condition is load-bearing:
   *
   *   storageKey        the exact key the server minted. A client cannot
   *                     finalize an arbitrary key, because there is no row for
   *                     one it did not receive from presign.
   *   ownerUserId       provider B cannot claim provider A's reservation, even
   *                     knowing the key — which is the case a key-prefix check
   *                     alone would miss if the prefix were ever guessable.
   *   visibility PUBLIC restricted evidence is a different lifecycle with a
   *                     different sweep; this must never cross into it.
   *   uploadCompletedAt already-claimed matches nothing, so two concurrent
   *     IS NULL         finalizations produce one winner and one null rather
   *                     than two attachments of one object.
   *
   * `updateMany` rather than `update` so a miss is a count of zero rather than
   * a thrown record-not-found: "somebody else's, or already claimed" is an
   * ordinary answer here, not an exception.
   */
  async claim(
    input: { userId: string; storageKey: string },
    now = new Date(),
  ): Promise<{ id: string } | null> {
    const claimed = await this.prisma.client.mediaAsset.updateMany({
      where: {
        storageKey: input.storageKey,
        ownerUserId: input.userId,
        visibility: 'PUBLIC',
        uploadCompletedAt: null,
        deletedAt: null,
      },
      data: { uploadCompletedAt: now },
    });
    if (claimed.count !== 1) {
      this.log.warn({ msg: 'public.media.claim.refused', userId: input.userId });
      return null;
    }
    const asset = await this.prisma.client.mediaAsset.findUnique({
      where: { storageKey: input.storageKey },
      select: { id: true },
    });
    return asset ? { id: asset.id } : null;
  }

  /**
   * Mark an attached asset for byte deletion.
   *
   * `retainUntil`, never `deletedAt` — the schema reserves the latter for
   * "confirmed gone from storage", and `PublicMediaCleanupService` is the only
   * thing entitled to write it. Scoped to a PUBLIC asset owned by this user so
   * a retirement can never reach another provider's media or an evidence row.
   */
  async retire(
    input: { userId: string; storageKey: string; reason: string },
    now = new Date(),
  ): Promise<void> {
    await this.prisma.client.mediaAsset.updateMany({
      where: {
        storageKey: input.storageKey,
        ownerUserId: input.userId,
        visibility: 'PUBLIC',
        deletedAt: null,
      },
      data: { retainUntil: now, deletionReason: input.reason },
    });
  }
}
