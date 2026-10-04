import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@homeservicemarketplace/database';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';
import { isPortfolioStorageKey } from '../../infrastructure/storage/portfolio-storage-policy';
import { ALLOWED_IMAGE_TYPES } from '../../infrastructure/storage/content-type';
import {
  PortfolioImageDecoderUnavailableError,
  validateStoredPortfolioImage,
} from '../../infrastructure/storage/portfolio-image-validation';
import { AppError } from '../../shared/errors/app-error';

export interface PortfolioMediaStream {
  stream: Readable;
  contentType: string;
}

/** PUBLIC is publication eligibility, never authority to read retired or unsafe bytes.
 * Portfolio finalization validates image signatures, independently from identity scanning. */
export const LIVE_PORTFOLIO_ASSET = {
  visibility: 'PUBLIC',
  deletedAt: null,
  retainUntil: null,
  erasureStartedAt: null,
  uploadCompletedAt: { not: null },
  scanState: { notIn: ['QUARANTINED', 'REJECTED', 'SCAN_FAILED'] },
} satisfies Prisma.MediaAssetWhereInput;

/** Resolves portfolio authorization before opening bytes; never signs a GET URL. */
@Injectable()
export class PortfolioMediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  openForOwner(userId: string, itemId: string): Promise<PortfolioMediaStream> {
    return this.open({ id: itemId, providerProfile: { userId, deletedAt: null } });
  }

  /** The controller separately requires the freshly-resolved portfolio:read permission. */
  openForReviewer(providerProfileId: string, itemId: string): Promise<PortfolioMediaStream> {
    return this.open({ id: itemId, providerProfileId, providerProfile: { deletedAt: null } });
  }

  openPublic(storageKey: string): Promise<PortfolioMediaStream> {
    return this.open({
      moderationState: 'APPROVED',
      providerProfile: { deletedAt: null },
      mediaAsset: { storageKey, visibility: 'PUBLIC', deletedAt: null },
    });
  }

  /** Check immutable stored bytes before the approval transaction, never during its lock.
   * The decision writer must still recheck revision and live media state in its transaction. */
  async assertAvailableForApproval(
    providerProfileId: string,
    itemId: string,
    expectedRevision: number,
  ): Promise<void> {
    const row = await this.prisma.client.providerPortfolioItem.findFirst({
      where: {
        id: itemId,
        providerProfileId,
        revision: expectedRevision,
        deletedAt: null,
        providerProfile: { deletedAt: null },
        mediaAsset: LIVE_PORTFOLIO_ASSET,
      },
      select: {
        mediaAsset: { select: { storageKey: true, declaredMimeType: true, sizeBytes: true } },
      },
    });
    // The candidate was already authorized and revision-checked by the writer.
    // If it changes before inspection, require a fresh review; never skip the
    // byte check and let a later eligibility recovery turn absence into success.
    if (!row || !isPortfolioStorageKey(row.mediaAsset.storageKey)) throw unavailable();
    try {
      await validateStoredPortfolioImage(this.storage, {
        storageKey: row.mediaAsset.storageKey,
        contentType: row.mediaAsset.declaredMimeType,
        sizeBytes: row.mediaAsset.sizeBytes,
      });
    } catch (error) {
      if (error instanceof PortfolioImageDecoderUnavailableError)
        throw new AppError('DEPENDENCY_UNAVAILABLE', error.message, 503);
      throw unavailable();
    }
  }

  private async open(where: Prisma.ProviderPortfolioItemWhereInput): Promise<PortfolioMediaStream> {
    const row = await this.prisma.client.providerPortfolioItem.findFirst({
      where: {
        AND: [where, { deletedAt: null, mediaAsset: LIVE_PORTFOLIO_ASSET }],
      },
      select: { mediaAsset: { select: { storageKey: true, declaredMimeType: true } } },
    });
    if (
      !row ||
      !isPortfolioStorageKey(row.mediaAsset.storageKey) ||
      !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(row.mediaAsset.declaredMimeType)
    ) {
      throw missing();
    }
    let stream;
    try {
      stream = await this.storage.readObjectStream(row.mediaAsset.storageKey);
    } catch {
      throw new AppError(
        'DEPENDENCY_UNAVAILABLE',
        'Portfolio image access is temporarily unavailable. Please try again.',
        503,
      );
    }
    if (!stream) throw missing();
    return { stream, contentType: row.mediaAsset.declaredMimeType };
  }
}

function missing(): AppError {
  return new AppError('NOT_FOUND', 'File not found.', 404);
}

function unavailable(): AppError {
  return new AppError(
    'CONFLICT',
    'This image cannot be opened safely. Restore its upload or request a replacement before approval.',
    409,
    { reason: 'MEDIA_UNAVAILABLE' },
  );
}
