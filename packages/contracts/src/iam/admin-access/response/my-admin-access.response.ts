import type { AdminAccessRequestSummary } from './admin-access-request-summary';

// GET /v1/me/admin-access — what the signed-in user should be shown about
// their admin access, on all three axes at once.
//
// This exists so no screen has to infer admin standing from `User.status`.
// "My account is ACTIVE" and "I have admin access" are different questions and
// this response answers the second one directly.
export interface MyAdminAccessResponse {
  /**
   * Whether the user CURRENTLY holds the admin role. This is the only field a
   * client may use to decide whether to offer admin navigation — and even then
   * the server re-checks on every admin endpoint.
   */
  hasAdminRole: boolean;
  /** The user's most recent request, or null if they have never submitted one. */
  latestRequest: AdminAccessRequestSummary | null;
  /** True when `latestRequest` is PENDING — i.e. a decision is outstanding. */
  isPending: boolean;
  /** True when the user may submit a (new) request right now. */
  canSubmit: boolean;
}
