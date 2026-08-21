import { Injectable, Logger } from '@nestjs/common';
import type {
  ProviderOnboardingStatus,
  SubmitProviderForReviewResponse,
} from '@homeservicemarketplace/contracts';

import {
  ProviderProfileRepository,
  type ProviderProfileWithCategories,
} from '../../../infrastructure/persistence/bids/provider-profile.repository';
import { UserRepository } from '../../../infrastructure/persistence/iam/user.repository';
import { TransactionRunner } from '../../../infrastructure/prisma/transaction.runner';
import { AuditService } from '../../iam/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import { toProviderProfileSummary } from '../provider-profile.mapper';
import { evaluateOnboarding, type OnboardingCandidate } from './provider-onboarding.policy';

// Phase 4 — provider onboarding.
//
// The authoritative state machine:
//
//   DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ ACTIVE ⇄ SUSPENDED
//     │                     │                       │
//     └─────────────────────┴───────────────────────┴──reject──▶ REJECTED
//
// This service owns the provider-initiated half (DRAFT → PENDING_REVIEW).
// The admin-initiated half lives in AdminVerificationService.
//
// What changed and why:
//   - /upgrade used to stamp PENDING_REVIEW directly, so an empty profile
//     entered the review queue the moment someone clicked "become a provider".
//     Reviewers saw rows with no headline, no bio, no service area, and no
//     categories, and PENDING_REVIEW stopped meaning "a complete application
//     was submitted". Upgrade now creates DRAFT and submission is explicit.
//   - Submission validates an explicit, single-source completeness policy and
//     returns 422 with machine-readable missing-field codes rather than a
//     generic 400.
//
// Editing while PENDING_REVIEW is BLOCKED (not "returns to DRAFT"). The
// alternative — silently reverting a queued application to DRAFT on any edit —
// makes a provider's application vanish from the queue without telling them,
// and lets someone change what a reviewer is looking at mid-review. Blocking
// is visible: the provider is told the application is locked and can withdraw
// it if they need to change something.
@Injectable()
export class ProviderOnboardingService {
  private readonly logger = new Logger(ProviderOnboardingService.name);

  constructor(
    private readonly providers: ProviderProfileRepository,
    private readonly users: UserRepository,
    private readonly audit: AuditService,
    private readonly tx: TransactionRunner,
  ) {}

  /**
   * GET /v1/me/provider/onboarding
   *
   * Gives the Provider app the SERVER's answer to "can I submit?" so the app
   * does not re-derive the completeness policy and end up with a Submit button
   * that is enabled and then 422s.
   */
  async getStatus(userId: string): Promise<ProviderOnboardingStatus> {
    const { profile, emailVerified } = await this.load(userId);
    const missing = evaluateOnboarding(toCandidate(profile, emailVerified));

    return {
      complete: missing.length === 0,
      missing,
      submittedForReviewAt: profile.submittedForReviewAt?.toISOString() ?? null,
      reviewedAt: profile.reviewedAt?.toISOString() ?? null,
      rejectionReason: profile.rejectionReason ?? null,
      editable: profile.status !== 'PENDING_REVIEW',
    };
  }

  /**
   * POST /v1/me/provider/submit-for-review
   *
   * DRAFT → PENDING_REVIEW, atomically, only when the completeness policy
   * passes.
   */
  async submitForReview(userId: string): Promise<SubmitProviderForReviewResponse> {
    const result = await this.tx.run(async (trx) => {
      const { profile, emailVerified } = await this.load(userId, trx);

      // State-machine gate, with a DISTINCT message per illegal source state.
      // "Not submittable" is not actionable; "your application is already in
      // review" and "your application was rejected — update it and resubmit"
      // are.
      if (profile.status !== 'DRAFT') {
        throw notSubmittable(profile.status);
      }

      const missing = evaluateOnboarding(toCandidate(profile, emailVerified));
      if (missing.length > 0) {
        // 422, not 400: the payload is well-formed, the RESOURCE is
        // incomplete. `details.missing` is machine-readable so the app can
        // focus the offending fields.
        throw new AppError(
          'VALIDATION_ERROR',
          'Your provider application is not complete yet.',
          422,
          { missing },
        );
      }

      // Atomic DRAFT → PENDING_REVIEW. Scoped to DRAFT in the WHERE clause so
      // two concurrent submissions produce exactly one winner and a profile an
      // admin has since suspended cannot be dragged into the queue by a stale
      // client.
      const moved = await this.providers.submitForReviewIfDraft(profile.id, trx);
      if (moved === 0) {
        throw new AppError(
          'CONFLICT',
          'This application is no longer in a submittable state.',
          409,
        );
      }

      await this.audit.record(
        {
          type: 'PROVIDER_ONBOARDING_SUBMITTED',
          userId,
          metadata: { previousStatus: 'DRAFT', newStatus: 'PENDING_REVIEW' },
        },
        trx,
      );

      const fresh = await this.providers.findByIdWithCategories(profile.id, trx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload provider profile.', 500);
      return fresh;
    });

    this.logger.log({ msg: 'provider.onboarding.submitted', providerProfileId: result.id });
    return { profile: toProviderProfileSummary(result) };
  }

  /**
   * POST /v1/me/provider/withdraw-review
   *
   * PENDING_REVIEW → DRAFT, by the provider's own act.
   *
   * This is the counterpart to the edit lock. Blocking edits on a queued
   * application is only reasonable if there is a visible way out of the queue;
   * otherwise a provider who spots a typo after submitting is stuck waiting for
   * a reviewer to reject them.
   */
  async withdrawFromReview(userId: string): Promise<SubmitProviderForReviewResponse> {
    const result = await this.tx.run(async (trx) => {
      const { profile } = await this.load(userId, trx);

      if (profile.status !== 'PENDING_REVIEW') {
        throw new AppError('CONFLICT', 'There is no application awaiting review to withdraw.', 409);
      }

      // Scoped to PENDING_REVIEW in the WHERE clause: if a reviewer decided
      // the application between the read and the write, they win and the
      // provider is told so rather than silently undoing the decision.
      const moved = await this.providers.withdrawFromReviewIfPending(profile.id, trx);
      if (moved === 0) {
        throw new AppError(
          'CONFLICT',
          'This application has already been reviewed and can no longer be withdrawn.',
          409,
        );
      }

      await this.audit.record(
        {
          type: 'PROVIDER_ONBOARDING_SUBMITTED',
          userId,
          metadata: {
            previousStatus: 'PENDING_REVIEW',
            newStatus: 'DRAFT',
            outcome: 'withdrawn',
          },
        },
        trx,
      );

      const fresh = await this.providers.findByIdWithCategories(profile.id, trx);
      if (!fresh) throw new AppError('INTERNAL_ERROR', 'Failed to reload provider profile.', 500);
      return fresh;
    });

    this.logger.log({ msg: 'provider.onboarding.withdrawn', providerProfileId: result.id });
    return { profile: toProviderProfileSummary(result) };
  }

  /**
   * Guard used by the profile-edit path: a queued application is locked so a
   * reviewer is never looking at a moving target.
   */
  assertEditable(status: string): void {
    if (status === 'PENDING_REVIEW') {
      throw new AppError(
        'CONFLICT',
        'Your application is being reviewed and cannot be edited. Withdraw it first if you need to make changes.',
        409,
      );
    }
  }

  private async load(
    userId: string,
    tx?: Parameters<ProviderProfileRepository['findByUserIdWithCategories']>[1],
  ): Promise<{ profile: ProviderProfileWithCategories; emailVerified: boolean }> {
    const [profile, user] = await Promise.all([
      this.providers.findByUserIdWithCategories(userId, tx),
      this.users.findById(userId, tx),
    ]);
    if (!profile) {
      throw new AppError(
        'NOT_FOUND',
        'Provider profile not found. Upgrade to a provider account first.',
        404,
      );
    }
    return { profile, emailVerified: user?.emailVerifiedAt != null };
  }
}

function toCandidate(
  profile: ProviderProfileWithCategories,
  emailVerified: boolean,
): OnboardingCandidate {
  return {
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    phoneNumber: profile.phoneNumber,
    serviceAreaCity: profile.serviceAreaCity,
    serviceAreaCountry: profile.serviceAreaCountry,
    serviceAreaRadiusKm: profile.serviceAreaRadiusKm,
    serviceCategoryCount: profile.serviceCategories.length,
    emailVerified,
  };
}

// Distinct, actionable messages per illegal source state.
function notSubmittable(status: string): AppError {
  switch (status) {
    case 'PENDING_REVIEW':
      return new AppError('CONFLICT', 'Your application is already being reviewed.', 409);
    case 'ACTIVE':
      return new AppError('CONFLICT', 'Your provider account is already approved.', 409);
    case 'SUSPENDED':
      return new AppError(
        'CONFLICT',
        'Your provider account is suspended. Contact support before reapplying.',
        409,
      );
    case 'REJECTED':
      // REJECTED is deliberately terminal for THIS application: an admin must
      // return the profile to DRAFT before it can be resubmitted, so a
      // rejected applicant cannot re-queue the same rejected content on loop.
      return new AppError(
        'CONFLICT',
        'Your application was rejected. Contact support to reopen it.',
        409,
      );
    default:
      return new AppError('CONFLICT', 'This application cannot be submitted right now.', 409);
  }
}
