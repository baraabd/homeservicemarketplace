import type { AdminAccessRequestStatus } from '../../../iam/admin-access/enums/admin-access-request-status';

export interface ListAdminAccessRequestsQuery {
  /** Defaults to PENDING — the review queue is the common case. */
  status?: AdminAccessRequestStatus;
  cursor?: string;
  limit?: number;
}
