import type { ProviderOnboardingFeedbackItem } from '@homeservicemarketplace/contracts';

/** URL fragments reuse the existing task sub-screens. */
export function feedbackTaskPath(item: ProviderOnboardingFeedbackItem): string {
  if (['identityDocument', 'verificationDocuments', 'categoryLicense'].includes(item.field ?? '')) {
    return '/provider/verification';
  }
  const path = `/provider/onboarding/${item.taskId}`;
  if (item.taskId === 'PORTFOLIO' && item.itemId) return `${path}#portfolio`;
  if (
    item.taskId === 'SERVICES_EXPERIENCE' &&
    ['yearsOfExperience', 'professionSince', 'transportMode', 'transportModes'].includes(
      item.field ?? '',
    )
  ) {
    return `${path}#experience`;
  }
  return path;
}
