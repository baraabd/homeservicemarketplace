import type { AdminPortfolioItem } from '@homeservicemarketplace/contracts';
import { reviewFixture, STAMP } from './fixtures';

export const PORTFOLIO_PATH = '/v1/admin/providers/provider-1/portfolio';
export const portfolioItem: AdminPortfolioItem = {
  id: 'image-1', title: 'Kitchen lighting', description: 'Private installation detail',
  serviceCategoryId: null, position: 0, moderationState: 'PENDING', moderationReason: null,
  revision: 3, media: { url: `${PORTFOLIO_PATH}/image-1/media`, contentType: 'image/png' },
  createdAt: STAMP, updatedAt: STAMP, moderatedAt: null, reviewBlockedReason: null,
  availableActions: ['APPROVE', 'REJECT'], history: [],
};

export function actionableReview() {
  const review = reviewFixture();
  review.verification = {
    id: 'case-1', providerProfileId: 'provider-1', state: 'SUBMITTED', policyVersion: 'v1',
    country: 'SY', providerType: 'INDIVIDUAL', submittedAt: STAMP,
    assignedToUserId: null, assignedAt: null, decidedAt: null, requirements: [],
    documents: [], decisions: [], availableActions: ['assign', 'approve'],
    blockedReason: null, workAccess: null,
  };
  review.categoryApplications = [{
    id: 'category-1', providerProfileId: 'provider-1', providerDisplayName: 'Current provider',
    serviceCategoryId: 'electrical', serviceCategorySlug: 'electrical',
    serviceCategoryLabelEn: 'Electrical work', serviceCategoryLabelAr: 'أعمال الكهرباء',
    status: 'PENDING', createdAt: STAMP, updatedAt: STAMP, supersededAt: null,
    availableActions: ['APPROVE', 'REJECT'],
  }];
  return review;
}
