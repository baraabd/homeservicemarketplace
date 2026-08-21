// Body for POST /v1/admin/access-requests/:id/approve | /reject.
//
// The decision itself is encoded in the ROUTE, not in the body: a client can
// never flip an approve into something else by editing a payload field, and
// the two routes can carry different permission requirements if that ever
// diverges.
export interface DecideAdminAccessRequestRequest {
  /**
   * Reviewer's note. Surfaced to the applicant on rejection so they are told
   * why rather than seeing a generic account-problem message.
   */
  decisionNote?: string;
}
