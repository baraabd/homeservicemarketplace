import type { ProviderReviewTaskId } from './provider-onboarding-feedback';

/** Supported correction targets. An omitted field means the whole task.
 * These are persisted domain fields, not arbitrary DOM selectors or URLs. */
export const PROVIDER_REVIEW_CORRECTION_FIELDS = {
  BASICS_IDENTITY: [
    'displayName',
    'phoneNumber',
    'profileImageUrl',
    'verificationDocuments',
    'identityDocument',
    'categoryLicense',
  ],
  SERVICES_EXPERIENCE: [
    'specialties',
    'yearsOfExperience',
    'professionSince',
    'transportModes',
    'categoryLicense',
  ],
  WORK_AREA: ['serviceAreaCity'],
  WORKING_HOURS: ['availability'],
  PORTFOLIO: ['bio', 'portfolio'],
  REVIEW_SUBMISSION: ['consent'],
} as const satisfies Record<ProviderReviewTaskId, readonly string[]>;

export function isProviderReviewCorrectionField(
  taskId: ProviderReviewTaskId,
  field: string,
): boolean {
  return (PROVIDER_REVIEW_CORRECTION_FIELDS[taskId] as readonly string[]).includes(field);
}
