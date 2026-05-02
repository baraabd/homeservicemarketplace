import type { AdminUserSummary } from './admin-user-summary';

// Returned by /suspend and /restore. Echoes the post-mutation state.
export interface AdminUserMutationResponse {
  user: AdminUserSummary;
}
