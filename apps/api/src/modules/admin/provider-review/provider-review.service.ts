import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@homeservicemarketplace/database';
import { ProviderCapability } from '@homeservicemarketplace/contracts';
import type {
  AdminProviderReview,
  AdminProviderReviewMutationResponse,
  ApproveAdminProviderReviewRequest,
  RequestAdminProviderReviewChangesRequest,
  ProviderOnboardingFeedback,
} from '@homeservicemarketplace/contracts';

import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { ProviderProfileRepository } from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { OutboxRepository } from '../../../infrastructure/outbox/outbox.repository';
import { AppError } from '../../../shared/errors/app-error';
import { SecurityEventsBus } from '../../../shared/security-events/security-events.bus';
import { PermissionResolverService } from '../../iam/authorization/services/permission-resolver.service';
import type { AuthenticatedUser } from '../../iam/authentication/types/authenticated-user';
import { ProviderCapabilityService } from '../../provider/capability/provider-capability.service';
import { VerificationCaseWorkflowService } from '../../provider/verification/case/verification-case-workflow.service';
import { AdminAuditService } from '../admin-audit.service';
import { AdminVerificationCaseService } from '../verification/admin-verification-case.service';
import { AdminProviderReviewRepository } from './provider-review.repository';
import { validateReviewFeedback } from './provider-review-feedback';
import {
  canRequestChanges,
  needsEvidenceView,
  reviewBlockers,
  reviewHash,
  reviewRevision,
  savedReviewSnapshot,
} from './provider-review.policy';

export const PROVIDER_REVIEW_DECIDED_EVENT = 'provider.review.decided';

/** Coordinates independent domain decisions in one transaction; never invents a combined status. */
@Injectable()
export class AdminProviderReviewService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly repository: AdminProviderReviewRepository,
    private readonly permissions: PermissionResolverService,
    private readonly cases: AdminVerificationCaseService,
    private readonly capabilities: ProviderCapabilityService,
    private readonly providers: ProviderProfileRepository,
    private readonly workflow: VerificationCaseWorkflowService,
    private readonly audit: AdminAuditService,
    private readonly outbox: OutboxRepository,
    private readonly securityEvents: SecurityEventsBus,
  ) {}

  async get(actor: AuthenticatedUser, providerProfileId: string): Promise<AdminProviderReview> {
    const granted = await this.permissions.resolveFreshForUser(actor.id);
    if (!granted.has('user:read:any')) throw forbidden();
    const canDecide = granted.has('verification:decide');
    const { data, verification } = await this.transactions.run(
      async (db) => {
        const data = await this.repository.load(db, providerProfileId);
        const verification = await this.cases.forProvider(providerProfileId, actor.id, db);
        return { data, verification };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const { profile, submission } = data;
    const capabilities = await this.capabilities.for(profile.userId ?? '');
    const blockers = reviewBlockers(data, actor.id, canDecide);
    const changesAllowed = canRequestChanges(blockers);
    if (needsEvidenceView(data) && !granted.has('verification:evidence:view')) {
      blockers.push({ code: 'PERMISSION_REQUIRED', taskId: 'BASICS_IDENTITY' });
    }
    const availableActions: AdminProviderReview['availableActions'] = [];
    if (blockers.length === 0) availableActions.push('approve');
    if (changesAllowed) availableActions.push('requestChanges');
    return {
      provider: {
        id: profile.id,
        userId: profile.userId,
        displayName: profile.displayName,
        email: profile.user?.email ?? null,
        accountStatus: profile.user?.status ?? null,
        providerStatus: profile.status,
        onboardingState: profile.onboardingState,
        verificationState: profile.verificationState,
        standingState: profile.standingState,
      },
      revision: reviewRevision(data),
      submission: submission
        ? {
            id: submission.id,
            submittedAt: submission.submittedAt.toISOString(),
            policyVersion: submission.policyVersion,
            decision: submission.decision,
            decidedAt: submission.decidedAt?.toISOString() ?? null,
            snapshot: savedReviewSnapshot(submission.reviewSnapshot),
            feedback: submission.reviewFeedback as unknown as ProviderOnboardingFeedback | null,
          }
        : null,
      current: data.current,
      verification: verification
        ? {
            ...verification,
            availableActions: canDecide
              ? verification.availableActions.filter(
                  (action) => action !== 'approve' || granted.has('verification:evidence:view'),
                )
              : [],
            documents: verification.documents.map((doc) => ({
              ...doc,
              viewable: doc.viewable && granted.has('verification:evidence:view'),
            })),
          }
        : null,
      categoryApplications: profile.categoryApplications.map((row) => ({
        id: row.id,
        providerProfileId: profile.id,
        providerDisplayName: profile.displayName,
        serviceCategoryId: row.serviceCategoryId,
        serviceCategorySlug: row.serviceCategory.slug,
        serviceCategoryLabelEn: row.serviceCategory.labelEn,
        serviceCategoryLabelAr: row.serviceCategory.labelAr,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        supersededAt: row.supersededAt?.toISOString() ?? null,
        availableActions:
          canDecide &&
          profile.userId !== actor.id &&
          row.status === 'PENDING' &&
          row.supersededAt === null &&
          row.serviceCategory.isActive
            ? ['APPROVE', 'REJECT']
            : [],
      })),
      capabilities,
      canWork: capabilities.allowed.includes(ProviderCapability.SubmitBid),
      blockers,
      availableActions,
      permissions: {
        canDecide,
        canViewEvidence: granted.has('verification:evidence:view'),
        canModeratePortfolio: granted.has('portfolio:review'),
      },
    };
  }

  approve(actor: AuthenticatedUser, id: string, input: ApproveAdminProviderReviewRequest) {
    return this.decide(actor, id, 'APPROVE', input);
  }

  requestChanges(
    actor: AuthenticatedUser,
    id: string,
    input: RequestAdminProviderReviewChangesRequest,
  ) {
    return this.decide(actor, id, 'REQUEST_CHANGES', input);
  }

  private async decide(
    actor: AuthenticatedUser,
    providerProfileId: string,
    action: 'APPROVE' | 'REQUEST_CHANGES',
    input: ApproveAdminProviderReviewRequest | RequestAdminProviderReviewChangesRequest,
  ): Promise<AdminProviderReviewMutationResponse> {
    const granted = await this.permissions.resolveFreshForUser(actor.id);
    if (!granted.has('user:read:any') || !granted.has('verification:decide')) throw forbidden();
    const requestHash = reviewHash({ actorUserId: actor.id, providerProfileId, action, ...input });
    let changed: boolean;
    try {
      changed = await this.transactions.run(
        async (db) => {
          const currentPermissions = await this.permissions.resolveFreshForUser(actor.id, db);
          if (
            !currentPermissions.has('user:read:any') ||
            !currentPermissions.has('verification:decide')
          )
            throw forbidden();
          const receipt = await db.providerOnboardingSubmission.findFirst({
            where: { id: input.submissionId, providerProfileId },
          });
          if (!receipt) throw new AppError('NOT_FOUND', 'Submission not found.', 404);
          if (receipt.decisionIdempotencyKey === input.idempotencyKey) {
            if (
              receipt.decisionRequestHash !== requestHash ||
              receipt.decidedByUserId !== actor.id
            ) {
              throw conflict('IDEMPOTENCY_KEY_REUSED');
            }
            return false;
          }
          if (receipt.decidedAt) throw conflict('SUBMISSION_ALREADY_DECIDED');
          const data = await this.repository.load(db, providerProfileId);
          if (data.submission?.id !== input.submissionId) throw conflict('SUBMISSION_SUPERSEDED');
          if (reviewRevision(data) !== input.expectedRevision) throw conflict('STALE_REVIEW');
          if (action === 'REQUEST_CHANGES') {
            validateReviewFeedback(
              (input as RequestAdminProviderReviewChangesRequest).feedback,
              data,
            );
          }
          if (
            action === 'APPROVE' &&
            needsEvidenceView(data) &&
            !currentPermissions.has('verification:evidence:view')
          )
            throw forbidden();
          const blockers = reviewBlockers(data, actor.id, true);
          if (action === 'APPROVE' ? blockers.length > 0 : !canRequestChanges(blockers)) {
            throw new AppError(
              'CONFLICT',
              'This application is not ready for that decision.',
              409,
              { reason: 'REVIEW_BLOCKED', blockers },
            );
          }
          const now = new Date();
          const feedback: ProviderOnboardingFeedback | undefined =
            action === 'REQUEST_CHANGES'
              ? {
                  requestedAt: now.toISOString(),
                  items: (input as RequestAdminProviderReviewChangesRequest).feedback.map(
                    (item) => ({
                      ...item,
                      id: randomUUID(),
                    }),
                  ),
                }
              : undefined;
          const claimed = await db.providerOnboardingSubmission.updateMany({
            where: { id: input.submissionId, providerProfileId, decidedAt: null },
            data: {
              decision: action === 'APPROVE' ? 'ACCEPTED' : 'RETURNED',
              decidedAt: now,
              decidedByUserId: actor.id,
              decisionNote: input.note ?? null,
              decisionIdempotencyKey: input.idempotencyKey,
              decisionRequestHash: requestHash,
              reviewedRevision: input.expectedRevision,
              ...(feedback ? { reviewFeedback: feedback as unknown as Prisma.InputJsonValue } : {}),
            },
          });
          if (claimed.count !== 1) throw conflict('CONCURRENT_UPDATE');
          const to = action === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
          const moved = await this.providers.decideIfInStatus(
            providerProfileId,
            {
              from: ['PENDING_REVIEW'],
              to,
              reviewedByUserId: actor.id,
              onboardingState: action === 'APPROVE' ? 'ACCEPTED' : 'RETURNED',
              rejectionReason:
                action === 'APPROVE'
                  ? null
                  : 'Please review the requested changes in your application.',
            },
            db,
          );
          if (moved !== 1) throw conflict('CONCURRENT_UPDATE');
          if (
            action === 'APPROVE' &&
            data.verificationCase &&
            data.verificationCase.state !== 'VERIFIED'
          ) {
            await this.workflow.approve(
              actor.id,
              {
                caseId: data.verificationCase.id,
                expectedState: data.verificationCase.state,
                reasonCode: (input as ApproveAdminProviderReviewRequest).reasonCode,
                // Internal final-review prose belongs only on the submission.
              },
              { transaction: db, suppressNotification: true },
            );
          }
          if (
            feedback &&
            data.verificationCase &&
            feedback.items.some((item) =>
              ['verificationDocuments', 'identityDocument', 'categoryLicense'].includes(
                item.field ?? '',
              ),
            )
          ) {
            const caseInput = {
              caseId: data.verificationCase.id,
              expectedState: data.verificationCase.state,
              reasonCode: 'OTHER' as const,
            };
            const context = { transaction: db, suppressNotification: true };
            // Returning the application must also unlock the exact evidence
            // task we asked the provider to fix. Profile-only corrections do
            // not alter an independent identity decision.
            if (['SUBMITTED', 'IN_REVIEW'].includes(data.verificationCase.state)) {
              await this.workflow.requestAction(actor.id, caseInput, context);
            } else if (data.verificationCase.state === 'VERIFIED') {
              await this.workflow.reverify(actor.id, caseInput, context);
            }
          }
          await this.audit.record(
            {
              adminUserId: actor.id,
              type: action === 'APPROVE' ? 'ADMIN_PROVIDER_APPROVED' : 'ADMIN_PROVIDER_REJECTED',
              metadata: {
                providerProfileId,
                submissionId: input.submissionId,
                reviewAction: action,
                reviewedRevision: input.expectedRevision,
                previousStatus: data.profile.status,
                newStatus: to,
              },
            },
            db,
          );
          const notification = await db.notification.create({
            data: {
              userId: data.profile.userId!,
              type: 'SYSTEM',
              title:
                action === 'APPROVE'
                  ? 'Your application is approved'
                  : 'Your application needs changes',
              body:
                action === 'APPROVE'
                  ? 'Your application has been reviewed. Open your provider workspace to see your current access.'
                  : 'A reviewer has requested changes. Open your application to see the details.',
              resourceType: 'REVIEW',
              resourceId: providerProfileId,
              deepLink: '/provider/onboarding',
            },
          });
          await this.outbox.enqueue(
            {
              aggregateType: 'ProviderOnboardingSubmission',
              aggregateId: input.submissionId,
              eventType: PROVIDER_REVIEW_DECIDED_EVENT,
              dedupeKey: `${PROVIDER_REVIEW_DECIDED_EVENT}:${input.submissionId}`,
              payload: { notificationId: notification.id, actorUserId: actor.id },
            },
            db,
          );
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2034', 'P2002'].includes(error.code)
      ) {
        throw conflict('CONCURRENT_UPDATE');
      }
      throw error;
    }
    const review = await this.get(actor, providerProfileId);
    if (changed)
      this.securityEvents.emitProviderStatusChanged({
        providerProfileId,
        userId: review.provider.userId,
        status: action === 'APPROVE' ? 'ACTIVE' : 'REJECTED',
      });
    return { changed, review };
  }
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 'You do not have permission to review this application.', 403);
}

function conflict(reason: string): AppError {
  return new AppError('CONFLICT', 'This review changed. Reload it before deciding.', 409, {
    reason,
  });
}
