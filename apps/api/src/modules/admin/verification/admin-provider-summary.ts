import {
  availableAdminProviderActions,
  ProviderCapability,
  type AdminProviderAttentionReason,
  type AdminProviderSummary,
  type ProviderCapabilitiesResponse,
} from '@homeservicemarketplace/contracts';
import type { AdminProviderDirectoryRow } from '../../../infrastructure/persistence/bids/admin-provider-directory.query';

/** Metadata only. Identity bytes, storage keys and URLs never enter a directory. */
export function toAdminProviderSummary(
  row: AdminProviderDirectoryRow,
  capabilities: ProviderCapabilitiesResponse,
): AdminProviderSummary {
  const account = {
    status: row.user?.status ?? null,
    isActive: row.user?.isActive ?? false,
    deletedAt: row.user?.deletedAt?.toISOString() ?? null,
  };
  const identityCase = row.verificationCases?.[0];
  const portfolio = row.portfolioSummary ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
  const work = capabilities.capabilities.find(
    (item) => item.capability === ProviderCapability.SubmitBid,
  );
  const attentionReasons: AdminProviderAttentionReason[] = [];
  if (account.status !== 'ACTIVE' || !account.isActive || account.deletedAt)
    attentionReasons.push('ACCOUNT_UNAVAILABLE');
  if (
    row.status === 'DRAFT' ||
    row.onboardingState === 'NOT_STARTED' ||
    row.onboardingState === 'DRAFT'
  )
    attentionReasons.push('APPLICATION_NOT_SUBMITTED');
  if (row.status === 'REJECTED' || row.onboardingState === 'RETURNED')
    attentionReasons.push('APPLICATION_RETURNED');
  if (
    identityCase?.state === 'ACTION_REQUIRED' ||
    row.verificationState === 'REJECTED' ||
    row.verificationState === 'EXPIRED'
  )
    attentionReasons.push('IDENTITY_CHANGES_REQUIRED');
  else if (
    row.verificationState === 'PENDING' ||
    identityCase?.state === 'SUBMITTED' ||
    identityCase?.state === 'IN_REVIEW'
  )
    attentionReasons.push('IDENTITY_IN_REVIEW');
  else if (!row.verificationState || row.verificationState === 'UNVERIFIED')
    attentionReasons.push('IDENTITY_REQUIRED');
  if (portfolio.pending > 0) attentionReasons.push('PORTFOLIO_REVIEW_REQUIRED');
  if (row.status === 'PENDING_REVIEW') attentionReasons.push('APPLICATION_REVIEW_REQUIRED');

  return {
    id: row.id,
    status: row.status,
    availableActions: availableAdminProviderActions(row.status),
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
    reviewNotes: row.reviewNotes ?? null,
    submittedForReviewAt: row.submittedForReviewAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId ?? null,
    rejectionReason: row.rejectionReason ?? null,
    headline: row.headline ?? null,
    bio: row.bio ?? null,
    phoneNumber: row.phoneNumber ?? null,
    serviceAreaRadiusKm: row.serviceAreaRadiusKm ?? null,
    serviceCategories: row.serviceCategories?.map((entry) => entry.serviceCategory) ?? [],
    account,
    onboardingState: row.onboardingState ?? null,
    verificationState: row.verificationState ?? null,
    standingState: row.standingState ?? null,
    verificationCase: identityCase
      ? {
          id: identityCase.id,
          state: identityCase.state,
          submittedAt: identityCase.submittedAt?.toISOString() ?? null,
          assignedTo: identityCase.assignedTo
            ? {
                id: identityCase.assignedTo.id,
                name: [identityCase.assignedTo.firstName, identityCase.assignedTo.lastName]
                  .filter(Boolean)
                  .join(' '),
              }
            : null,
        }
      : null,
    portfolio,
    workAccess: {
      hasLiveGrant: (row.workAccessGrants?.length ?? 0) > 0,
      canWork: work?.allowed ?? false,
      denialReason: work?.reason ?? null,
    },
    attentionReasons,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
