import { Inject, Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { STORAGE_PORT, StoragePort } from '../../infrastructure/storage/storage.port';
import {
  extensionForContentType,
  isAllowedContentType,
  MAX_BYTES_PER_FILE,
} from '../../infrastructure/storage/content-type';
import { isAvatarMimeType } from '../../infrastructure/storage/image-signature';
import {
  MEDIA_SIGNATURE_PROBE_BYTES,
  verifyMediaSignature,
} from '../../infrastructure/storage/media-signature';
import { AppError } from '../../shared/errors/app-error';
import { AVATAR_MAX_BYTES } from '../provider/onboarding/avatar/avatar-policy';

export interface PublicMediaStream {
  stream: Readable;
  contentType: string;
  sizeBytes: number;
}

// Only current server-minted avatar/request keys can use this read authority.
// Legacy objects without a durable finalized claim must be reuploaded or
// migrated with verified provenance; a matching prefix alone is not publication.
const PUBLIC_KEY =
  /^(avatars|requests)\/[a-f0-9]{24}\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[a-z0-9]+$/;

/** Anonymous reads from private S3 use publication facts, never bucket ACLs. */
@Injectable()
export class PublicMediaReadService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async openPublic(key: string): Promise<PublicMediaStream> {
    if (!PUBLIC_KEY.test(key)) throw missing();
    const avatar = key.startsWith('avatars/');
    const row = await this.prisma.client.mediaAsset.findUnique({
      where: { storageKey: key },
      select: {
        storageKey: true,
        visibility: true,
        purpose: true,
        declaredMimeType: true,
        detectedMimeType: true,
        sizeBytes: true,
        scanState: true,
        uploadCompletedAt: true,
        deletedAt: true,
        retainUntil: true,
        erasureStartedAt: true,
        verificationCaseId: true,
        verificationDocument: { select: { id: true } },
        portfolioItems: { select: { id: true }, take: 1 },
        serviceRequestId: true,
        requestClaimedAt: true,
        ownerUserId: true,
        owner: {
          select: {
            deletedAt: true,
            providerProfile: {
              select: { deletedAt: true, profileImageUrl: true, avatarUrl: true },
            },
          },
        },
        serviceRequest: { select: { deletedAt: true, seekerUserId: true } },
      },
    });
    if (
      !row ||
      row.storageKey !== key ||
      row.visibility !== 'PUBLIC' ||
      !row.uploadCompletedAt ||
      row.deletedAt ||
      row.retainUntil ||
      row.erasureStartedAt ||
      // Public finalizers validate signatures, not identity-scanner verdicts.
      // They leave PENDING; never manufacture CLEAN or admit failed scans.
      !['PENDING', 'CLEAN'].includes(row.scanState) ||
      row.verificationCaseId ||
      row.verificationDocument ||
      row.portfolioItems.length > 0 ||
      !row.ownerUserId ||
      !row.owner ||
      row.owner.deletedAt ||
      !isAllowedContentType(row.declaredMimeType) ||
      !key.endsWith(`.${extensionForContentType(row.declaredMimeType)}`) ||
      !Number.isSafeInteger(row.sizeBytes) ||
      row.sizeBytes <= 0 ||
      row.sizeBytes > (avatar ? AVATAR_MAX_BYTES : MAX_BYTES_PER_FILE)
    ) {
      throw missing();
    }

    if (avatar) {
      const profile = row.owner.providerProfile;
      if (
        row.purpose !== null ||
        row.serviceRequestId !== null ||
        row.requestClaimedAt !== null ||
        !isAvatarMimeType(row.declaredMimeType) ||
        !profile ||
        profile.deletedAt ||
        !referencesKey(profile.profileImageUrl ?? profile.avatarUrl, key)
      ) {
        throw missing();
      }
    } else if (
      row.purpose !== 'REQUEST_ATTACHMENT' ||
      !row.requestClaimedAt ||
      !row.serviceRequestId ||
      !row.serviceRequest ||
      row.serviceRequest.deletedAt ||
      row.serviceRequest.seekerUserId !== row.ownerUserId ||
      row.detectedMimeType !== row.declaredMimeType
    ) {
      throw missing();
    }

    let stored;
    try {
      stored = await this.storage.readObjectHead(key, MEDIA_SIGNATURE_PROBE_BYTES);
    } catch {
      throw unavailable();
    }
    if (
      !stored ||
      stored.sizeBytes !== row.sizeBytes ||
      !verifyMediaSignature(row.declaredMimeType, stored.head).ok
    ) {
      throw missing();
    }
    let stream;
    try {
      stream = await this.storage.readObjectStream(key);
    } catch {
      throw unavailable();
    }
    if (!stream) throw missing();
    return { stream, contentType: row.declaredMimeType, sizeBytes: row.sizeBytes };
  }
}

/** A URL origin may change, but the persisted current avatar must name this
 * exact key as a path suffix, never in a query, fragment, or lookalike segment. */
function referencesKey(value: string | null, key: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      decodeURIComponent(url.pathname).endsWith(`/${key}`)
    );
  } catch {
    return false;
  }
}

function missing(): AppError {
  return new AppError('NOT_FOUND', 'File not found.', 404);
}

function unavailable(): AppError {
  return new AppError(
    'DEPENDENCY_UNAVAILABLE',
    'Media access is temporarily unavailable. Please try again.',
    503,
  );
}
