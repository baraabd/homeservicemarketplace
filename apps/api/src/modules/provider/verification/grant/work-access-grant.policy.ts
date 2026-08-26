import type {
  ProviderWorkAccessSource,
  ProviderWorkAccessStatus,
} from '@homeservicemarketplace/database';

import type { VerificationCaseAction } from '../policy/case-transitions';

// Sprint 9B.7 — does this grant authorize work RIGHT NOW?
//
// docs/adr/0013-evidence-to-work-access-capability-transition.md
//
// One question, one place. Every enforcement point will ask it, and none of
// them should be re-deriving the answer from columns — that is how three
// slightly different definitions of "verified" end up in one codebase.
//
// Pure, and FAILS CLOSED: a grant authorizes work only when it positively says
// so. Anything unrecognised, absent or ambiguous authorizes nothing.

export interface WorkAccessGrantSnapshot {
  status: ProviderWorkAccessStatus;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/** The only source an APPROVAL may write.
 *
 *  MANUAL_OVERRIDE and LEGACY_BACKFILL exist so that a grant somebody was given
 *  stays distinguishable from one they earned by having documents checked. A
 *  single shared source would erase that difference permanently. */
export const GRANT_SOURCE_FOR_APPROVAL: ProviderWorkAccessSource = 'VERIFIED_DOCUMENTS';

/**
 * May this grant authorize work at `now`?
 *
 * Three independent refusals, and the second is the one that matters most:
 *
 *   no row          nothing was ever granted
 *   status          REVOKED and EXPIRED are terminal; an unknown status is
 *                   refused rather than assumed benign
 *   expiry / clock  an ACTIVE grant whose expiry has PASSED authorizes nothing,
 *                   even though a background sweep has not relabelled it yet.
 *                   A grant lapses at its expiry, not when a job gets round to
 *                   it — the gap between those two moments would otherwise be
 *                   unauthorised work the system believes is authorised.
 *
 * The expiry instant itself counts as expired: a grant valid "until 12:00" is
 * not valid AT 12:00.
 */
export function authorizesWork(
  grant: WorkAccessGrantSnapshot | null | undefined,
  now: Date,
): boolean {
  if (!grant) return false;
  if (grant.status !== 'ACTIVE') return false;
  // A revocation timestamp on an ACTIVE row means somebody revoked it and the
  // status write did not land. Believe the timestamp.
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/**
 * What closing the grant should record, for the action that closed it.
 *
 * `reverify` deliberately closes as EXPIRED rather than REVOKED. Asking a
 * provider for fresh evidence is not a sanction, and filing it as a revocation
 * puts a mark against someone who did nothing wrong — in the very table a
 * future reviewer reads when judging them.
 *
 * `reject` closes nothing because rejection never granted anything: it is only
 * reachable from states that never held a grant.
 */
export function grantClosureFor(
  action: VerificationCaseAction,
): Extract<ProviderWorkAccessStatus, 'REVOKED' | 'EXPIRED'> | null {
  switch (action) {
    case 'revoke':
      return 'REVOKED';
    case 'expire':
    case 'reverify':
      return 'EXPIRED';
    default:
      return null;
  }
}
