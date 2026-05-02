import { Injectable } from '@nestjs/common';
import type {
  AdminProviderMutationResponse,
  AdminProviderSummary,
  ListAdminProvidersQuery,
  ListAdminProvidersResponse,
} from '@homeservicemarketplace/contracts';
import {
  NotificationResourceType,
  NotificationType,
  type AuditEventType,
  type ProviderProfile,
  type ProviderProfileStatus,
} from '@homeservicemarketplace/database';

import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AppError } from '../../../shared/errors/app-error';
import { NotificationsService } from '../../notifications/notifications.service';
import { AdminAuditService } from '../admin-audit.service';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class AdminVerificationService {
  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly tx: TransactionRunner,
  ) {}

  async list(query: ListAdminProvidersQuery): Promise<ListAdminProvidersResponse> {
    const take = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_SIZE, 1), 100);
    const status = query.status ?? ('PENDING_REVIEW' as ProviderProfileStatus);
    const rows = await this.providers.listForAdmin({
      status,
      take: take + 1,
      cursor: query.cursor,
    });
    const page = rows.slice(0, take);
    const items = page.map(toSummary);
    const nextCursor = rows.length > take ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async detail(id: string): Promise<AdminProviderSummary> {
    const row = await this.providers.findByIdForAdmin(id);
    if (!row) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    return toSummary(row);
  }

  async approve(
    adminUserId: string,
    providerProfileId: string,
    note: string | null | undefined,
  ): Promise<AdminProviderMutationResponse> {
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ['DRAFT', 'PENDING_REVIEW'] as ProviderProfileStatus[],
      to: 'ACTIVE' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_APPROVED' as AuditEventType,
      auditMetadata: note ? { note } : {},
      notification: {
        type: NotificationType.SYSTEM,
        title: 'You are approved',
        body: 'Your provider account is now active.',
      },
      conflictMessage: 'Only DRAFT or PENDING_REVIEW providers can be approved.',
    });
  }

  async reject(
    adminUserId: string,
    providerProfileId: string,
    reason: string,
  ): Promise<AdminProviderMutationResponse> {
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED'] as ProviderProfileStatus[],
      to: 'REJECTED' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_REJECTED' as AuditEventType,
      auditMetadata: { reason },
      notification: {
        type: NotificationType.SYSTEM,
        title: 'Provider account rejected',
        body: `Your provider application was rejected: ${reason}`,
      },
      conflictMessage: 'Provider is already rejected.',
    });
  }

  async suspend(
    adminUserId: string,
    providerProfileId: string,
    reason: string,
  ): Promise<AdminProviderMutationResponse> {
    return this.transition({
      adminUserId,
      providerProfileId,
      from: ['ACTIVE'] as ProviderProfileStatus[],
      to: 'SUSPENDED' as ProviderProfileStatus,
      auditType: 'ADMIN_PROVIDER_SUSPENDED' as AuditEventType,
      auditMetadata: { reason },
      notification: {
        type: NotificationType.SYSTEM,
        title: 'Provider account suspended',
        body: `Your provider account was suspended: ${reason}`,
      },
      conflictMessage: 'Only an ACTIVE provider can be suspended.',
    });
  }

  // ─── helper ─────────────────────────────────────────────────────────────────
  private async transition(args: {
    adminUserId: string;
    providerProfileId: string;
    from: ProviderProfileStatus[];
    to: ProviderProfileStatus;
    auditType: AuditEventType;
    auditMetadata: Record<string, unknown>;
    notification: { type: NotificationType; title: string; body: string };
    conflictMessage: string;
  }): Promise<AdminProviderMutationResponse> {
    const result = await this.tx.run(async (tx) => {
      const existing = await this.providers.findByIdForAdmin(args.providerProfileId, tx);
      if (!existing) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      if (!args.from.includes(existing.status as ProviderProfileStatus)) {
        throw new AppError('CONFLICT', args.conflictMessage, 409);
      }
      await this.providers.updateStatusById(args.providerProfileId, args.to, tx);
      await this.audit.record(
        {
          adminUserId: args.adminUserId,
          type: args.auditType,
          metadata: {
            providerProfileId: args.providerProfileId,
            targetUserId: existing.user?.id ?? null,
            previousStatus: existing.status,
            newStatus: args.to,
            ...args.auditMetadata,
          },
        },
        tx,
      );
      if (existing.user?.id) {
        await this.notifications.createForUser(
          {
            userId: existing.user.id,
            type: args.notification.type,
            title: args.notification.title,
            body: args.notification.body,
            resourceType: NotificationResourceType.REVIEW,
            resourceId: args.providerProfileId,
            deepLink: `/provider/profile`,
            metadata: { providerProfileId: args.providerProfileId, status: args.to },
          },
          tx,
        );
      }
      const reloaded = await this.providers.findByIdForAdmin(args.providerProfileId, tx);
      if (!reloaded) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
      return reloaded;
    });
    return { provider: toSummary(result) };
  }
}

function toSummary(
  row: ProviderProfile & { user: { id: string; email: string } | null },
): AdminProviderSummary {
  return {
    id: row.id,
    status: row.status,
    userId: row.user?.id ?? null,
    email: row.user?.email ?? null,
    displayName: row.displayName,
    initials: row.initials,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    completedJobs: row.completedJobs,
    verified: row.verified,
    topPro: row.topPro,
    serviceAreaCity: row.serviceAreaCity,
    serviceAreaCountry: row.serviceAreaCountry,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
