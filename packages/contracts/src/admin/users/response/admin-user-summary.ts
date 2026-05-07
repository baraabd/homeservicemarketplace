import type { AdminUserStatus } from '../request/list-admin-users.query';

// Wire shape of one user row as the admin sees it. Deliberately omits
// passwordHash, mfaSecret, refreshToken, and any session columns —
// admin operations don't need them and exposing them would widen the
// blast radius of a token leak.
export interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AdminUserStatus;
  isActive: boolean;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}
