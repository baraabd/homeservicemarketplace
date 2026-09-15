import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@homeservicemarketplace/database';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';
import { isPortfolioStorageKey } from '../../infrastructure/storage/portfolio-storage-policy';
import { ALLOWED_IMAGE_TYPES } from '../../infrastructure/storage/content-type';
import { AppError } from '../../shared/errors/app-error';

export interface PortfolioMediaStream {
  stream: Readable;
  contentType: string;
}

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

  private async open(where: Prisma.ProviderPortfolioItemWhereInput): Promise<PortfolioMediaStream> {
    const row = await this.prisma.client.providerPortfolioItem.findFirst({
      where: {
        AND: [where, { deletedAt: null, mediaAsset: { visibility: 'PUBLIC', deletedAt: null } }],
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
    const stream = await this.storage.readObjectStream(row.mediaAsset.storageKey);
    if (!stream) throw missing();
    return { stream, contentType: row.mediaAsset.declaredMimeType };
  }
}

function missing(): AppError {
  return new AppError('NOT_FOUND', 'File not found.', 404);
}
