import { Injectable } from '@nestjs/common';
import type { PrismaTx } from '@homeservicemarketplace/database';
import {
  resolveRequirements,
  type CandidatePolicy,
} from '../../provider/verification/policy/requirement-resolver';

import { AppError } from '../../../shared/errors/app-error';
import { readProviderReviewSnapshot } from '../../provider/onboarding/review/provider-review-snapshot';

/** One consistent read of the reviewed content and its authorization inputs. */
@Injectable()
export class AdminProviderReviewRepository {
  async load(db: PrismaTx, providerProfileId: string) {
    const profile = await db.providerProfile.findFirst({
      where: { id: providerProfileId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        displayName: true,
        status: true,
        onboardingState: true,
        verificationState: true,
        standingState: true,
        updatedAt: true,
        submittedForReviewAt: true,
        user: { select: { id: true, email: true, status: true, isActive: true, deletedAt: true } },
        onboardingSubmissions: { orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 1 },
        categoryApplications: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            serviceCategoryId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            supersededAt: true,
            serviceCategory: {
              select: { slug: true, labelEn: true, labelAr: true, isActive: true },
            },
          },
        },
        serviceCategories: {
          select: { serviceCategoryId: true, serviceCategory: { select: { isActive: true } } },
          orderBy: { serviceCategoryId: 'asc' },
        },
        workAccessGrants: {
          orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            caseId: true,
            status: true,
            source: true,
            grantedAt: true,
            revokedAt: true,
            expiresAt: true,
            updatedAt: true,
          },
        },
        verificationCases: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            state: true,
            country: true,
            providerType: true,
            policyVersion: true,
            requirementsSnapshot: true,
            createdAt: true,
            updatedAt: true,
            assignedToUserId: true,
            documents: {
              orderBy: { id: 'asc' },
              select: {
                id: true,
                kind: true,
                serviceCategoryId: true,
                supersededAt: true,
                expiresOn: true,
                updatedAt: true,
                mediaAsset: {
                  select: {
                    id: true,
                    scanState: true,
                    visibility: true,
                    deletedAt: true,
                    uploadCompletedAt: true,
                    sha256: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!profile) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    const current = await readProviderReviewSnapshot(db, providerProfileId);
    if (!current) throw new AppError('NOT_FOUND', 'Provider profile not found.', 404);
    const verificationCase = profile.verificationCases[0] ?? null;
    // Old cases did not stamp their selected trade scope. Reconstruct ONLY at
    // the original instant, never against today's policies. The policy layer
    // accepts this proof only if every pinned version and requirement matches.
    let historicalRequirements: ReturnType<typeof resolveRequirements> | null = null;
    const raw = verificationCase?.requirementsSnapshot;
    if (
      verificationCase &&
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      !raw.subjectScope
    ) {
      const policies = await db.verificationRequirementPolicy.findMany({
        where: {
          publishedAt: { lte: verificationCase.createdAt },
          OR: [{ retiredAt: null }, { retiredAt: { gt: verificationCase.createdAt } }],
        },
      });
      try {
        historicalRequirements = resolveRequirements({
          country: verificationCase.country,
          providerType: verificationCase.providerType,
          categoryIds: current.services.specialties
            .filter((s) => s.state !== 'REJECTED')
            .map((s) => s.id),
          at: verificationCase.createdAt,
          policies: policies as unknown as CandidatePolicy[],
        });
      } catch {
        // Ambiguous/missing historical policy is a reviewer-visible blocker.
      }
    }
    return {
      profile,
      current,
      submission: profile.onboardingSubmissions[0] ?? null,
      verificationCase,
      historicalRequirements,
    };
  }
}

export type AdminProviderReviewData = Awaited<ReturnType<AdminProviderReviewRepository['load']>>;
