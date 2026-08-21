import type { AdminAccessRequestStatus } from '../enums/admin-access-request-status';

// One admin-access request as its APPLICANT sees it.
//
// `decidedByUserId` is intentionally absent: the applicant does not need to
// know which administrator reviewed them, and exposing it would leak the
// operator roster to anyone who can submit a request.
export interface AdminAccessRequestSummary {
  id: string;
  status: AdminAccessRequestStatus;
  justification: string | null;
  /** Reviewer's note. Populated on REJECTED so the applicant knows why. */
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
