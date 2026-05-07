import type { AdminUserSummary } from './admin-user-summary';

export interface ListAdminUsersResponse {
  items: AdminUserSummary[];
  nextCursor: string | null;
}
