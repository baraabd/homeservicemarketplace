import type { AdminAccessRequestStatus } from '../../../iam/admin-access/enums/admin-access-request-status';
import type { AdminUserStatus } from '../request/list-admin-users.query';

// Wire shape of one user row as the admin sees it. Deliberately omits
// passwordHash, mfaSecret, refreshToken, and any session columns —
// admin operations don't need them and exposing them would widen the
// blast radius of a token leak.
//
// Phase 4 — this shape carries all THREE account axes as separate fields,
// because they answer different questions and the dashboard must render them
// as separate columns:
//
//   status                    may this identity authenticate?
//   roles                     what may it do?
//   adminAccessRequestStatus  where does its request for admin stand?
export interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: AdminUserStatus;
  isActive: boolean;
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  /**
   * AXIS 2 — what this identity may do. Independent of `status`.
   *
   * A user with `status: 'ACTIVE'` and `roles: ['customer']` is an ACTIVE
   * CUSTOMER, not an "active admin". The dashboard must render this as its own
   * column; collapsing it into the status badge is what produced screens
   * describing ordinary users as "Admin active".
   */
  roles: string[];
  /**
   * AXIS 3 — where this user's request for admin access stands, or null if
   * they have never asked.
   *
   * Deliberately distinct from `roles`: PENDING means "asked, not granted",
   * and APPROVED is only meaningful alongside `roles` containing 'admin'
   * (a later revocation leaves the historical APPROVED row untouched).
   */
  adminAccessRequestStatus: AdminAccessRequestStatus | null;
  createdAt: string;
  updatedAt: string;
}
