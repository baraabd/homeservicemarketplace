import {
  isProviderReviewCorrectionField,
  type ProviderOnboardingFeedbackItem,
} from '@homeservicemarketplace/contracts';

/** URL fragments reuse the existing task sub-screens. */
export function feedbackTaskPath(item: ProviderOnboardingFeedbackItem): string {
  if (['identityDocument', 'verificationDocuments', 'categoryLicense'].includes(item.field ?? '')) {
    return '/provider/verification';
  }
  const params = new URLSearchParams();
  if (item.field && isProviderReviewCorrectionField(item.taskId, item.field)) {
    const field = item.taskId === 'PORTFOLIO' && item.itemId ? 'portfolio' : item.field;
    params.set('reviewField', field);
    if (item.itemId && ['portfolio', 'specialties'].includes(field) && item.itemId.length <= 64)
      params.set('reviewItem', item.itemId);
  }
  const path = `/provider/onboarding/${item.taskId}${params.size ? `?${params}` : ''}`;
  if (item.taskId === 'PORTFOLIO' && item.itemId) return `${path}#portfolio`;
  if (item.taskId === 'PORTFOLIO' && item.field === 'portfolio') return `${path}#portfolio`;
  if (item.taskId === 'REVIEW_SUBMISSION' && item.field === 'consent') return `${path}#terms`;
  if (
    item.taskId === 'SERVICES_EXPERIENCE' &&
    [
      'yearsOfExperience',
      'professionSince',
      'transportMode',
      'transportModes',
      'equipmentCodes',
    ].includes(item.field ?? '')
  ) {
    return `${path}#experience`;
  }
  return path;
}
