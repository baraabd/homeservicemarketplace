import { Injectable } from '@nestjs/common';
import type { AuditEventType, Prisma } from '@homeservicemarketplace/database';
import type {
  AdminProviderReviewHistoryKind,
  AdminProviderReviewHistoryQuery,
  AdminProviderReviewHistoryResponse,
} from '@homeservicemarketplace/contracts';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AppError } from '../../../shared/errors/app-error';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import { readOnboardingFeedback } from '../../provider/onboarding/review/provider-onboarding-feedback';

const KINDS = {
  ADMIN_PROVIDER_APPROVED: 'APPROVED',
  ADMIN_PROVIDER_REJECTED: 'REJECTED',
  ADMIN_PROVIDER_SUSPENDED: 'SUSPENDED',
  ADMIN_PROVIDER_NOTES_UPDATED: 'NOTES_UPDATED',
  ADMIN_CATEGORY_APPLICATION_APPROVED: 'CATEGORY_APPROVED',
  ADMIN_CATEGORY_APPLICATION_REJECTED: 'CATEGORY_REJECTED',
  VERIFICATION_CASE_SUBMITTED: 'IDENTITY_SUBMITTED',
  VERIFICATION_CASE_ASSIGNED: 'IDENTITY_ASSIGNED',
  VERIFICATION_CASE_ACTION_REQUESTED: 'IDENTITY_CHANGES_REQUESTED',
  VERIFICATION_CASE_REJECTED: 'IDENTITY_REJECTED',
  VERIFICATION_CASE_APPROVED: 'IDENTITY_APPROVED',
  VERIFICATION_CASE_REVOKED: 'IDENTITY_REVOKED',
  VERIFICATION_CASE_REVERIFY_REQUIRED: 'IDENTITY_REVERIFY_REQUIRED',
  VERIFICATION_CASE_EXPIRED: 'IDENTITY_EXPIRED',
  ADMIN_PORTFOLIO_APPROVED: 'PORTFOLIO_APPROVED',
  ADMIN_PORTFOLIO_REJECTED: 'PORTFOLIO_REJECTED',
  PORTFOLIO_CONTENT_UPDATED: 'PORTFOLIO_UPDATED',
  PROVIDER_ONBOARDING_SUBMITTED: 'SUBMITTED',
} satisfies Partial<Record<AuditEventType, AdminProviderReviewHistoryKind>>;

/** A bounded, provider-scoped projection of the append-only audit trail.
 * No raw metadata, evidence labels/URLs, credentials, IPs or user agents leave this service. */
@Injectable()
export class AdminProviderReviewHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionResolverService,
  ) {}

  async list(
    actorId: string,
    providerProfileId: string,
    query: AdminProviderReviewHistoryQuery,
  ): Promise<AdminProviderReviewHistoryResponse> {
    const rights = await this.permissions.resolveFreshForUser(actorId);
    if (!rights.has('user:read:any'))
      throw new AppError('FORBIDDEN', 'You cannot read this review history.', 403);
    const db = this.prisma.client;
    const profile = await db.providerProfile.findFirst({
      where: { id: providerProfileId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    const types = (Object.keys(KINDS) as AuditEventType[]).filter(
      (type) => rights.has('portfolio:read') || !type.includes('PORTFOLIO'),
    );
    const scope: Prisma.AuditEventWhereInput = {
      type: { in: types },
      OR: [
        { metadata: { path: ['providerProfileId'], equals: providerProfileId } },
        // Older onboarding writers recorded the owner but no provider id.
        ...(profile.userId
          ? [{ userId: profile.userId, type: 'PROVIDER_ONBOARDING_SUBMITTED' as const }]
          : []),
      ],
    };
    let before: Prisma.AuditEventWhereInput = {};
    if (query.cursor) {
      const cursor = await db.auditEvent.findFirst({
        where: { AND: [scope, { id: query.cursor }] },
        select: { id: true, createdAt: true },
      });
      if (!cursor)
        throw new AppError(
          'VALIDATION_ERROR',
          'The history cursor does not belong to this provider.',
          400,
        );
      before = {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }
    const limit = Math.min(50, Math.max(1, query.limit ?? 20));
    const found = await db.auditEvent.findMany({
      where: { AND: [scope, before] },
      take: limit + 1,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        type: true,
        createdAt: true,
        metadata: true,
        userId: true,
        user: { select: { firstName: true, lastName: true, deletedAt: true } },
      },
    });
    const rows = found.slice(0, limit);
    const metadata = rows.map((row) => object(row.metadata));
    const submissionIds = metadata
      .map((meta) => string(meta.submissionId))
      .filter((id): id is string => !!id);
    const categoryIds = metadata
      .map((meta) => string(meta.serviceCategoryId))
      .filter((id): id is string => !!id);
    const itemIds = metadata.map((meta) => string(meta.itemId)).filter((id): id is string => !!id);
    const [submissions, categories, images] = await Promise.all([
      submissionIds.length
        ? db.providerOnboardingSubmission.findMany({
            where: { providerProfileId, id: { in: submissionIds } },
            select: {
              id: true,
              submittedAt: true,
              policyVersion: true,
              reviewedRevision: true,
              reviewFeedback: true,
              ...(rights.has('verification:decide') ? { decisionNote: true } : {}),
            },
          })
        : [],
      categoryIds.length
        ? db.serviceCategory.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, labelEn: true, labelAr: true },
          })
        : [],
      itemIds.length
        ? db.providerPortfolioItem.findMany({
            where: { providerProfileId, id: { in: itemIds }, deletedAt: null },
            select: { id: true, title: true },
          })
        : [],
    ]);
    return {
      items: rows.map((row, index) => {
        const meta = metadata[index];
        const submission = submissions.find((item) => item.id === meta.submissionId);
        const category = categories.find((item) => item.id === meta.serviceCategoryId);
        const image = images.find((item) => item.id === meta.itemId);
        let kind: AdminProviderReviewHistoryKind = KINDS[row.type as keyof typeof KINDS];
        if (row.type === 'ADMIN_PROVIDER_REJECTED' && meta.reviewAction === 'REQUEST_CHANGES')
          kind = 'CHANGES_REQUESTED';
        if (row.type === 'ADMIN_PROVIDER_APPROVED' && meta.reactivate === true)
          kind = 'REACTIVATED';
        if (row.type === 'PROVIDER_ONBOARDING_SUBMITTED' && meta.outcome === 'withdrawn')
          kind = 'WITHDRAWN';
        const portfolio = kind.startsWith('PORTFOLIO_');
        return {
          id: row.id,
          kind,
          occurredAt: row.createdAt.toISOString(),
          actor: row.userId
            ? {
                id: row.userId,
                displayName:
                  row.user && !row.user.deletedAt
                    ? `${row.user.firstName} ${row.user.lastName}`.trim() || null
                    : null,
              }
            : null,
          submission: submission
            ? {
                id: submission.id,
                submittedAt: submission.submittedAt.toISOString(),
                policyVersion: submission.policyVersion,
                reviewedRevision: submission.reviewedRevision,
              }
            : null,
          subject: category
            ? { id: category.id, labelEn: category.labelEn, labelAr: category.labelAr }
            : image
              ? { id: image.id, labelEn: image.title, labelAr: image.title }
              : null,
          contentRevision:
            portfolio && Number.isSafeInteger(meta.revision) ? (meta.revision as number) : null,
          reason: portfolio ? string(meta.reason) : null,
          privateNote:
            rights.has('verification:decide') && submission
              ? string(submission.decisionNote)
              : null,
          feedback: submission ? readOnboardingFeedback(submission.reviewFeedback) : null,
        };
      }),
      nextCursor: found.length > limit ? rows.at(-1)!.id : null,
    };
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
