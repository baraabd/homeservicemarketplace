import type { AdminAccessRequestReviewItem } from './admin-access-request-review-item';

export interface ListAdminAccessRequestsResponse {
  items: AdminAccessRequestReviewItem[];
  nextCursor: string | null;
}
