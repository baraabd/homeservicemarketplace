/** Public instructions from a reviewer. Internal reviewer notes are never part of this DTO. */
export const PROVIDER_REVIEW_TASK_IDS = [
  'BASICS_IDENTITY',
  'SERVICES_EXPERIENCE',
  'WORK_AREA',
  'WORKING_HOURS',
  'PORTFOLIO',
  'REVIEW_SUBMISSION',
] as const;

export type ProviderReviewTaskId = (typeof PROVIDER_REVIEW_TASK_IDS)[number];

export interface ProviderOnboardingFeedbackItem {
  id: string;
  taskId: ProviderReviewTaskId;
  field?: string;
  itemId?: string;
  reasonCode: string;
  providerMessage: string;
}

export interface ProviderOnboardingFeedback {
  requestedAt: string;
  items: ProviderOnboardingFeedbackItem[];
}
