import type { AdminUserStatus } from './list-admin-users.query';

// PATCH /v1/admin/users/:userId/status
//
// Sprint 6.1 canonical wire shape. Replaces the legacy POST
// /:userId/suspend + POST /:userId/restore pair (which stays callable
// for backward compat). The body's `status` is what the user is being
// flipped TO; the server resolves the corresponding `isActive` flag
// (ACTIVE → true; SUSPENDED / LOCKED / DELETED → false; PENDING_VERIFICATION
// is rejected because admins cannot un-verify a user from the UI).
//
// `reason` is optional free-text written into the audit metadata
// alongside the previous status.
export interface UpdateUserStatusRequest {
  status: Exclude<AdminUserStatus, 'PENDING_VERIFICATION' | 'DELETED'>;
  reason?: string | null;
}
