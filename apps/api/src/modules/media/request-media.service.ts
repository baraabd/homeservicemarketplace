import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ContentType,
  extensionForContentType,
  isAllowedContentType,
} from '../../infrastructure/storage/content-type';
import {
  MEDIA_SIGNATURE_PROBE_BYTES,
  verifyMediaSignature,
} from '../../infrastructure/storage/media-signature';
import {
  REQUEST_ATTACHMENT_PREFIX,
  requestAttachmentOwnerRef,
} from '../../infrastructure/storage/request-attachment-storage-policy';
import {
  PresignedUpload,
  STORAGE_PORT,
  StoragePort,
} from '../../infrastructure/storage/storage.port';
import { AppError } from '../../shared/errors/app-error';
import { RESERVATION_TTL_MS } from './public-media-ledger.service';

// R06 — server-owned authority for service-request attachments.
//
// WHAT WAS WRONG
//
// The request presign minted a key and recorded nothing, and request creation
// stored whatever URL list the client sent. Nothing knew who uploaded an
// object, whether it existed, what it contained, or whether it was already
// attached to another request. A seeker could attach an external URL, another
// user's object, or the same object twice.
//
// THE LIFECYCLE
//
//   reserve   A MediaAsset row is written BEFORE the upload URL is returned:
//             owner, purpose, server-minted key, expected type and size, and an
//             expiry. The client receives the asset id.
//   upload    The browser PUTs the bytes to storage. Uploads are write-once.
//   finalize  The server reads the stored object back and checks it exists,
//             is the reserved size, and carries the reserved type's signature.
//   claim     Request creation attaches finalized assets inside its own
//             transaction. The claim is conditional, so an asset is attached to
//             at most one request and a rollback leaves it unclaimed.
//
// Ownership is `MediaAsset.ownerUserId`. No code path here derives authority
// from a storage key or a URL.

export type PresignedRequestAttachment = PresignedUpload & { assetId: string };

export interface ReserveRequestAttachmentInput {
  contentType: ContentType;
  sizeBytes: number;
}

export interface FinalizedRequestAttachment {
  assetId: string;
  fileUrl: string;
}

/** A finalized asset the caller may attach, in the order it was requested. */
export interface ClaimableRequestAttachment {
  id: string;
  fileUrl: string;
}

/** Why an attachment was refused. Safe to return: none of these reveal whether
 *  an asset exists for a different user. */
export type RequestAttachmentRefusal =
  | 'ATTACHMENT_UNAVAILABLE'
  | 'ATTACHMENT_EXPIRED'
  | 'FILE_MISSING'
  | 'SIZE_MISMATCH'
  | 'CONTENT_MISMATCH';

const PURPOSE = 'REQUEST_ATTACHMENT' as const;

const REFUSAL_MESSAGES: Record<RequestAttachmentRefusal, string> = {
  ATTACHMENT_UNAVAILABLE: 'One or more attachments are not available.',
  ATTACHMENT_EXPIRED: 'That upload has expired. Please upload the file again.',
  FILE_MISSING: 'We could not find that upload. Please try again.',
  SIZE_MISMATCH: 'That file does not match what was reserved for upload.',
  CONTENT_MISMATCH: 'That file does not match what was reserved for upload.',
};

function refuse(reason: RequestAttachmentRefusal): AppError {
  // Unknown, foreign, already-claimed and retired assets all produce the same
  // 409, so the response cannot be used to probe for another user's uploads.
  return reason === 'ATTACHMENT_UNAVAILABLE'
    ? new AppError('CONFLICT', REFUSAL_MESSAGES[reason], 409, { reason })
    : new AppError('VALIDATION_ERROR', REFUSAL_MESSAGES[reason], 400, { reason });
}

@Injectable()
export class RequestMediaService {
  private readonly log = new Logger(RequestMediaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /**
   * Reserve one attachment and return its upload authority.
   *
   * The row is committed before the storage adapter is asked for a URL, so an
   * upload that is abandoned is still visible to the cleanup sweep. A ledger
   * failure rejects the presign rather than authorising an object nothing can
   * account for.
   */
  async reserve(
    userId: string,
    input: ReserveRequestAttachmentInput,
    now = new Date(),
  ): Promise<PresignedRequestAttachment> {
    const ref = requestAttachmentOwnerRef(userId, String(this.config.get('JWT_ACCESS_SECRET')));
    const ext = extensionForContentType(input.contentType);
    const storageKey = `${REQUEST_ATTACHMENT_PREFIX}${ref}/${randomUUID()}.${ext}`;

    const asset = await this.prisma.client.mediaAsset.create({
      data: {
        visibility: 'PUBLIC',
        purpose: PURPOSE,
        storageKey,
        declaredMimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        ownerUserId: userId,
        uploadCompletedAt: null,
        uploadExpiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
      },
      select: { id: true },
    });

    let upload: PresignedUpload;
    try {
      upload = await this.storage.presignUpload({
        key: storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
    } catch {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Upload storage is not available. Please try again later.',
        503,
      );
    }
    // No key and no URL: this line is written on every presign.
    this.log.log({ msg: 'request.media.reserved', userId, assetId: asset.id });
    return { ...upload, assetId: asset.id };
  }

  /**
   * Verify the stored objects for a batch of reservations.
   *
   * Idempotent: an asset that was already finalized is returned again without
   * touching storage, so a client that lost the response can repeat the call.
   */
  async finalize(
    userId: string,
    assetIds: readonly string[],
    now = new Date(),
  ): Promise<FinalizedRequestAttachment[]> {
    assertDistinct(assetIds);
    const rows = await this.prisma.client.mediaAsset.findMany({
      where: {
        id: { in: [...assetIds] },
        ownerUserId: userId,
        purpose: PURPOSE,
        visibility: 'PUBLIC',
        deletedAt: null,
        retainUntil: null,
        requestClaimedAt: null,
      },
      select: {
        id: true,
        storageKey: true,
        declaredMimeType: true,
        sizeBytes: true,
        uploadCompletedAt: true,
        uploadExpiresAt: true,
      },
    });
    if (rows.length !== assetIds.length) {
      this.log.warn({ msg: 'request.media.finalize.unavailable', userId });
      throw refuse('ATTACHMENT_UNAVAILABLE');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));

    const result: FinalizedRequestAttachment[] = [];
    for (const id of assetIds) {
      const row = byId.get(id)!;
      if (!row.uploadExpiresAt || row.uploadExpiresAt.getTime() <= now.getTime()) {
        throw refuse('ATTACHMENT_EXPIRED');
      }
      if (row.uploadCompletedAt === null) {
        const detected = await this.verifyStoredObject(userId, row);
        // Conditional, so two concurrent finalizations record one completion.
        await this.prisma.client.mediaAsset.updateMany({
          where: { id: row.id, ownerUserId: userId, purpose: PURPOSE, uploadCompletedAt: null },
          data: { uploadCompletedAt: now, detectedMimeType: detected },
        });
      }
      result.push({ assetId: row.id, fileUrl: this.storage.publicUrlForKey(row.storageKey) });
    }
    this.log.log({ msg: 'request.media.finalized', userId, count: result.length });
    return result;
  }

  /**
   * Resolve the assets a request is about to claim, inside its transaction.
   *
   * Read first so the request row can be created with the server-derived URL
   * projection; `claim` below is what actually takes them.
   */
  async resolveClaimable(
    tx: PrismaTx,
    userId: string,
    assetIds: readonly string[],
    now = new Date(),
  ): Promise<ClaimableRequestAttachment[]> {
    if (assetIds.length === 0) return [];
    assertDistinct(assetIds);
    const rows = await tx.mediaAsset.findMany({
      where: { id: { in: [...assetIds] }, ...claimableWhere(userId, now) },
      select: { id: true, storageKey: true },
    });
    if (rows.length !== assetIds.length) {
      this.log.warn({ msg: 'request.media.claim.unavailable', userId });
      throw refuse('ATTACHMENT_UNAVAILABLE');
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return assetIds.map((id) => ({
      id,
      fileUrl: this.storage.publicUrlForKey(byId.get(id)!.storageKey),
    }));
  }

  /**
   * Attach the assets to a request, inside the request's transaction.
   *
   * Every predicate is repeated in the UPDATE itself. Two requests racing for
   * one asset both pass `resolveClaimable`; the second UPDATE then waits on the
   * first one's row lock, re-evaluates `serviceRequestId IS NULL`, matches
   * nothing and throws, which rolls its whole request back.
   */
  async claim(
    tx: PrismaTx,
    input: { userId: string; requestId: string; assetIds: readonly string[] },
    now = new Date(),
  ): Promise<void> {
    for (const [position, id] of input.assetIds.entries()) {
      const claimed = await tx.mediaAsset.updateMany({
        where: { id, ...claimableWhere(input.userId, now) },
        data: {
          serviceRequestId: input.requestId,
          requestClaimedAt: now,
          requestAttachmentPosition: position,
        },
      });
      if (claimed.count !== 1) {
        this.log.warn({ msg: 'request.media.claim.lost', userId: input.userId });
        throw refuse('ATTACHMENT_UNAVAILABLE');
      }
    }
  }

  private async verifyStoredObject(
    userId: string,
    row: { id: string; storageKey: string; declaredMimeType: string; sizeBytes: number },
  ): Promise<ContentType> {
    const stored = await this.storage.readObjectHead(row.storageKey, MEDIA_SIGNATURE_PROBE_BYTES);
    if (!stored) {
      this.log.warn({ msg: 'request.media.finalize.missing', userId, assetId: row.id });
      throw refuse('FILE_MISSING');
    }
    if (stored.sizeBytes !== row.sizeBytes) {
      this.log.warn({ msg: 'request.media.finalize.size_mismatch', userId, assetId: row.id });
      throw refuse('SIZE_MISMATCH');
    }
    const verdict = isAllowedContentType(row.declaredMimeType)
      ? verifyMediaSignature(row.declaredMimeType, stored.head)
      : { ok: false as const, detected: null };
    if (!verdict.ok) {
      this.log.warn({ msg: 'request.media.finalize.content_rejected', userId, assetId: row.id });
      throw refuse('CONTENT_MISMATCH');
    }
    return verdict.detected;
  }
}

/** What makes an asset attachable. Shared by the read and the UPDATE so the
 *  two cannot drift. */
function claimableWhere(userId: string, now: Date) {
  return {
    ownerUserId: userId,
    purpose: PURPOSE,
    visibility: 'PUBLIC' as const,
    uploadCompletedAt: { not: null },
    uploadExpiresAt: { gt: now },
    serviceRequestId: null,
    requestClaimedAt: null,
    retainUntil: null,
    deletedAt: null,
  };
}

function assertDistinct(assetIds: readonly string[]): void {
  if (new Set(assetIds).size !== assetIds.length) {
    throw new AppError('VALIDATION_ERROR', 'An attachment was listed more than once.', 400, {
      reason: 'DUPLICATE_ATTACHMENT',
    });
  }
}
