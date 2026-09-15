import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';
import type {
  AdminPortfolioItem,
  AdminPortfolioListResponse,
  ReviewAdminPortfolioItemRequest,
} from '@homeservicemarketplace/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppConfigService } from '../../../config/app-config.service';
import {
  isPortfolioStorageKey,
  isStagedPortfolioKey,
} from '../../../infrastructure/storage/portfolio-storage-policy';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';

const SELECT = {
  id: true,
  title: true,
  description: true,
  serviceCategoryId: true,
  position: true,
  moderationState: true,
  moderationReason: true,
  moderatedAt: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  publicationRightAckAt: true,
  providerProfile: { select: { userId: true } },
  mediaAsset: {
    select: { storageKey: true, declaredMimeType: true, visibility: true, deletedAt: true },
  },
} as const;
type Row = Prisma.ProviderPortfolioItemGetPayload<{ select: typeof SELECT }>;
const HISTORY_TYPES = [
  'ADMIN_PORTFOLIO_APPROVED',
  'ADMIN_PORTFOLIO_REJECTED',
  'PORTFOLIO_CONTENT_UPDATED',
] as const;

@Injectable()
export class AdminPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tx: TransactionRunner,
    private readonly config: AppConfigService,
    private readonly permissions: PermissionResolverService,
  ) {}

  async list(actorId: string, providerProfileId: string): Promise<AdminPortfolioListResponse> {
    const rights = await this.permissions.resolveFreshForUser(actorId);
    this.requirePermission(rights, 'portfolio:read');
    const profile = await this.prisma.client.providerProfile.findFirst({
      where: { id: providerProfileId, deletedAt: null },
      select: { id: true },
    });
    if (!profile) throw missing();
    const rows = await this.prisma.client.providerPortfolioItem.findMany({
      where: { providerProfileId, deletedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: SELECT,
    });
    const history = await this.history(this.prisma.client, providerProfileId);
    return {
      items: rows.map((row) => this.project(row, actorId, providerProfileId, rights, history)),
    };
  }

  async review(
    actorId: string,
    providerProfileId: string,
    itemId: string,
    input: ReviewAdminPortfolioItemRequest,
  ): Promise<AdminPortfolioItem> {
    const rights = await this.permissions.resolveFreshForUser(actorId);
    this.requirePermission(rights, 'portfolio:review');
    const reason = input.reason?.trim();
    if (input.action === 'REJECT' && !reason)
      throw new AppError(
        'VALIDATION_ERROR',
        'Explain the change needed before rejecting this image.',
        400,
      );
    try {
      return await this.tx.run(
        async (client) => {
          const currentRights = await this.permissions.resolveFreshForUser(actorId, client);
          this.requirePermission(currentRights, 'portfolio:review');
          const before = await client.providerPortfolioItem.findFirst({
            where: {
              id: itemId,
              providerProfileId,
              deletedAt: null,
              providerProfile: { deletedAt: null },
            },
            select: SELECT,
          });
          if (!before) throw missing();
          if (before.providerProfile.userId === actorId)
            throw new AppError('FORBIDDEN', 'You cannot review your own portfolio.', 403);
          if (before.revision !== input.expectedRevision) throw stale();
          if (this.blocked(before))
            throw new AppError('CONFLICT', 'This image needs media migration before review.', 409, {
              reason: 'MEDIA_MIGRATION_REQUIRED',
            });
          if (!before.publicationRightAckAt)
            throw new AppError(
              'CONFLICT',
              'Publication permission must be recorded before review.',
              409,
              { reason: 'PUBLICATION_ACK_REQUIRED' },
            );
          const next = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
          if (before.moderationState === next)
            throw new AppError('CONFLICT', 'This image already has that decision.', 409, {
              reason: 'ALREADY_REVIEWED',
            });
          const changed = await client.providerPortfolioItem.updateMany({
            where: {
              id: itemId,
              providerProfileId,
              deletedAt: null,
              revision: input.expectedRevision,
            },
            data: {
              moderationState: next,
              moderatedAt: new Date(),
              moderatedByUserId: actorId,
              moderationReason: next === 'REJECTED' ? reason : null,
              revision: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw stale();
          await client.auditEvent.create({
            data: {
              userId: actorId,
              type: next === 'APPROVED' ? 'ADMIN_PORTFOLIO_APPROVED' : 'ADMIN_PORTFOLIO_REJECTED',
              metadata: {
                providerProfileId,
                itemId,
                previousRevision: before.revision,
                revision: before.revision + 1,
                previousState: before.moderationState,
                newState: next,
                ...(reason ? { reason } : {}),
              },
            },
          });
          const row = await client.providerPortfolioItem.findUniqueOrThrow({
            where: { id: itemId },
            select: SELECT,
          });
          const history = await this.history(client, providerProfileId);
          return this.project(row, actorId, providerProfileId, currentRights, history);
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') throw stale();
      throw error;
    }
  }

  private async history(client: PrismaTx, providerProfileId: string) {
    return client.auditEvent.findMany({
      where: {
        type: { in: [...HISTORY_TYPES] },
        metadata: { path: ['providerProfileId'], equals: providerProfileId },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
      select: { id: true, type: true, createdAt: true, metadata: true },
    });
  }

  private project(
    row: Row,
    actorId: string,
    profileId: string,
    rights: Set<string>,
    history: Awaited<ReturnType<AdminPortfolioService['history']>>,
  ): AdminPortfolioItem {
    const blocked = this.blocked(row);
    const mayReview =
      rights.has('portfolio:review') &&
      row.providerProfile.userId !== actorId &&
      !blocked &&
      !!row.publicationRightAckAt;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      serviceCategoryId: row.serviceCategoryId,
      position: row.position,
      moderationState: row.moderationState,
      moderationReason: row.moderationReason,
      media: {
        url: `/v1/admin/providers/${encodeURIComponent(profileId)}/portfolio/${encodeURIComponent(row.id)}/media`,
        contentType: row.mediaAsset.declaredMimeType,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      moderatedAt: row.moderatedAt?.toISOString() ?? null,
      revision: row.revision,
      reviewBlockedReason: blocked
        ? 'MEDIA_MIGRATION_REQUIRED'
        : !row.publicationRightAckAt
          ? 'PUBLICATION_ACK_REQUIRED'
          : null,
      availableActions: mayReview
        ? (['APPROVE', 'REJECT'] as const).filter(
            (action) => row.moderationState !== (action === 'APPROVE' ? 'APPROVED' : 'REJECTED'),
          )
        : [],
      history: history.flatMap((entry) => {
        const metadata = entry.metadata as Record<string, unknown>;
        if (metadata.itemId !== row.id) return [];
        return [
          {
            id: entry.id,
            action:
              entry.type === 'PORTFOLIO_CONTENT_UPDATED'
                ? ('CONTENT_UPDATED' as const)
                : entry.type === 'ADMIN_PORTFOLIO_APPROVED'
                  ? ('APPROVED' as const)
                  : ('REJECTED' as const),
            at: entry.createdAt.toISOString(),
            revision: typeof metadata.revision === 'number' ? metadata.revision : null,
            reason: typeof metadata.reason === 'string' ? metadata.reason : null,
          },
        ];
      }),
    };
  }

  private blocked(row: Row): boolean {
    return (
      row.mediaAsset.visibility !== 'PUBLIC' ||
      !!row.mediaAsset.deletedAt ||
      !isPortfolioStorageKey(row.mediaAsset.storageKey) ||
      (this.config.get('STORAGE_DRIVER') === 's3' &&
        !isStagedPortfolioKey(row.mediaAsset.storageKey))
    );
  }

  private requirePermission(rights: Set<string>, permission: string) {
    if (!rights.has(permission))
      throw new AppError('FORBIDDEN', 'You do not have permission to review this portfolio.', 403);
  }
}
function missing() {
  return new AppError('NOT_FOUND', 'Portfolio not found.', 404);
}
function stale() {
  return new AppError('CONFLICT', 'This portfolio changed. Reload before reviewing it.', 409, {
    reason: 'STALE_REVISION',
  });
}
