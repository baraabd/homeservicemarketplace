// User account status the admin search filter accepts. Mirrors the
// Prisma `AccountStatus` enum so the wire shape is identical.
export const AdminUserStatus = {
  PendingVerification: 'PENDING_VERIFICATION',
  Active: 'ACTIVE',
  Locked: 'LOCKED',
  Suspended: 'SUSPENDED',
  Deleted: 'DELETED',
} as const;
export type AdminUserStatus = (typeof AdminUserStatus)[keyof typeof AdminUserStatus];

export interface ListAdminUsersQuery {
  // Free-text search. Server matches case-insensitively against
  // email / firstName / lastName.
  q?: string;
  status?: AdminUserStatus;
  // Role name filter. Common values: 'admin', 'provider', 'customer'.
  role?: string;
  limit?: number;
  cursor?: string;
}
