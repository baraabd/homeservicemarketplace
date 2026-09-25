import type { AdminProviderReviewTaskId } from '@homeservicemarketplace/contracts';
import { WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS } from './runtime-constants';

export const REVIEW_TAB_QUERY = 'reviewTab';
const SECTION_PREFIX = '#review-section-';

/** URL values select presentation only; they never determine review eligibility. */
export function parseReviewTask(value: string | null | undefined): AdminProviderReviewTaskId | null {
  return WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS.find((task) => task === value) ?? null;
}

export function reviewTaskFromHash(hash: string): AdminProviderReviewTaskId | null {
  return hash.startsWith(SECTION_PREFIX) ? parseReviewTask(hash.slice(SECTION_PREFIX.length)) : null;
}

export function selectedReviewTask(search: string, hash: string): AdminProviderReviewTaskId {
  return reviewTaskFromHash(hash)
    ?? parseReviewTask(new URLSearchParams(search).get(REVIEW_TAB_QUERY))
    ?? WEB_ADMIN_PROVIDER_REVIEW_TASK_IDS[0];
}

export function reviewTaskSearch(search: string, task: AdminProviderReviewTaskId): string {
  const params = new URLSearchParams(search);
  params.set(REVIEW_TAB_QUERY, task);
  return `?${params.toString()}`;
}
