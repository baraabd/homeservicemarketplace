import {
  PROVIDER_REVIEW_TASK_IDS,
  type ProviderOnboardingFeedback,
  type ProviderOnboardingFeedbackItem,
} from '@homeservicemarketplace/contracts';

/** Explicit projection from versioned JSON: never expose internal fields accidentally added to storage. */
export function readOnboardingFeedback(value: unknown): ProviderOnboardingFeedback | null {
  if (!isObject(value) || typeof value.requestedAt !== 'string' || !Array.isArray(value.items)) {
    return null;
  }
  const items: ProviderOnboardingFeedbackItem[] = [];
  for (const item of value.items) {
    if (
      !isObject(item) ||
      typeof item.id !== 'string' ||
      !PROVIDER_REVIEW_TASK_IDS.some((taskId) => taskId === item.taskId) ||
      typeof item.reasonCode !== 'string' ||
      typeof item.providerMessage !== 'string'
    ) {
      continue;
    }
    items.push({
      id: item.id,
      taskId: item.taskId as ProviderOnboardingFeedbackItem['taskId'],
      ...(typeof item.field === 'string' ? { field: item.field } : {}),
      ...(typeof item.itemId === 'string' ? { itemId: item.itemId } : {}),
      reasonCode: item.reasonCode,
      providerMessage: item.providerMessage,
    });
  }
  return items.length > 0 ? { requestedAt: value.requestedAt, items } : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
