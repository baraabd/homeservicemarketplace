// Body for POST /v1/me/admin-access.
//
// Deliberately minimal: the request carries NO role, status, userId, or
// permission field. Identity comes from the session and the outcome is decided
// by a reviewer, so there is nothing here a client could escalate with.
export interface SubmitAdminAccessRequestRequest {
  /**
   * Why the applicant needs admin access. Operator-facing context for the
   * reviewer; never rendered to other users.
   */
  justification?: string;
}
