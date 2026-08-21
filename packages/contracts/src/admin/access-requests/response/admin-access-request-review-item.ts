import type { AdminAccessRequestStatus } from '../../../iam/admin-access/enums/admin-access-request-status';
import type { AdminUserStatus } from '../../users/request/list-admin-users.query';

// One admin-access request as the REVIEWER sees it.
//
// Carries all three axes side by side, deliberately, so the review screen can
// never collapse them into a single "status" column:
//   - accountStatus  — may this identity authenticate at all?
//   - roles          — what can it do today?
//   - status         — where this ACCESS REQUEST stands.
export interface AdminAccessRequestReviewItem {
  id: string;
  status: AdminAccessRequestStatus;
  justification: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  decidedByUserId: string | null;
  createdAt: string;
  updatedAt: string;

  applicant: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    /** Axis 1: authentication standing. NOT admin standing. */
    accountStatus: AdminUserStatus;
    /** Axis 2: what the applicant can currently do. */
    roles: string[];
    emailVerifiedAt: string | null;
  };
}
