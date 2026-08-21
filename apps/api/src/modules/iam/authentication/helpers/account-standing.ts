import type { User } from '@homeservicemarketplace/database';

// Sprint 01 hardening — single definition of "may this account hold a
// live session right now?". Used by both the refresh path (before
// minting a new access token) and the per-request cached session check
// (immediate access-token blocking) so the two can never drift.
//
// Good standing requires ALL of:
//   - the user row exists
//   - it is not soft-deleted (deletedAt is null)
//   - it is active (isActive is true)
//   - its AccountStatus is exactly ACTIVE — which excludes
//     PENDING_VERIFICATION, LOCKED, SUSPENDED, and DELETED
//
// A user missing any of these is rejected: deleted / inactive /
// suspended / locked accounts cannot refresh and cannot keep using an
// already-issued access token past the cache window.
export type AccountStandingSnapshot = Pick<User, 'status' | 'isActive' | 'deletedAt'>;

export function isInGoodStanding(user: AccountStandingSnapshot | null | undefined): boolean {
  if (!user) return false;
  if (user.deletedAt !== null) return false;
  if (!user.isActive) return false;
  return user.status === 'ACTIVE';
}
