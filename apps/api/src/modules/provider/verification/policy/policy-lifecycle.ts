// Sprint 9B.2 — when a policy version may be published, retired, or changed.
//
// docs/adr/0010-policy-versioned-verification.md
//
// Policies are APPEND-ONLY. Nothing about a published version is ever edited
// except its retirement date: correcting a policy means publishing a new
// version and retiring the old one. That is stricter than "do not mutate a
// version a case references", and deliberately so — the weaker rule makes
// immutability depend on whether anyone happened to use the policy yet, so the
// first case silently changes the rules for editing it.
//
// Pure, like requirement-resolver.ts: no I/O, so the whole cross-product is
// testable without a database and a rule cannot quietly grow a query.

/** The subset of a policy row these rules read. */
export interface PolicyScopeRow {
  version: string;
  country: string | null;
  providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  categoryId: string | null;
  publishedAt: Date;
  retiredAt: Date | null;
}

export type PolicyLifecycleErrorCode =
  | 'INVALID_VERSION'
  | 'BACKDATED_PUBLICATION'
  | 'ALREADY_RETIRED'
  | 'NOT_YET_PUBLISHED'
  | 'OVERLAPPING_POLICY';

export class PolicyLifecycleError extends Error {
  constructor(
    message: string,
    readonly code: PolicyLifecycleErrorCode,
  ) {
    super(message);
    this.name = 'PolicyLifecycleError';
  }
}

/**
 * `YYYY.MM-scope-vN`, lower case.
 *
 * Opaque to the code, sortable as a plain string, and readable in a log line.
 * The fixed `YYYY.MM` prefix is what makes a lexical sort chronological, the
 * same trick the migration timestamps use.
 *
 * Constrained rather than free text because this value is a foreign key, is
 * echoed into audit metadata, and appears in operator-facing output.
 */
const VERSION = /^\d{4}\.\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*-v\d+$/;

export function assertVersionFormat(version: string): void {
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new PolicyLifecycleError(
      `Invalid policy version ${JSON.stringify(version)}. Expected YYYY.MM-scope-vN, e.g. 2026.08-sy-v1.`,
      'INVALID_VERSION',
    );
  }
}

/**
 * Live at `at`: published, and not yet retired.
 *
 * Half-open, [publishedAt, retiredAt). A case opened at the retirement instant
 * belongs to the next policy — the only reading that cannot put one case under
 * two policies. Matches `isLive` in requirement-resolver.ts exactly; if one
 * changes the other must.
 */
export function isLiveAt(policy: PolicyScopeRow, at: Date): boolean {
  if (policy.publishedAt.getTime() > at.getTime()) return false;
  return policy.retiredAt === null || policy.retiredAt.getTime() > at.getTime();
}

export function assertPublishable(policy: { publishedAt: Date }, at: Date): void {
  if (policy.publishedAt.getTime() < at.getTime()) {
    throw new PolicyLifecycleError(
      'A policy cannot be back-dated: it would retroactively change what an already-open case was resolved against.',
      'BACKDATED_PUBLICATION',
    );
  }
}

export function assertRetirable(policy: PolicyScopeRow, at: Date): void {
  if (policy.retiredAt !== null) {
    throw new PolicyLifecycleError(
      `Policy ${policy.version} was already retired at ${policy.retiredAt.toISOString()}.`,
      'ALREADY_RETIRED',
    );
  }
  if (policy.publishedAt.getTime() > at.getTime()) {
    throw new PolicyLifecycleError(
      `Policy ${policy.version} is scheduled for ${policy.publishedAt.toISOString()} and has not been published yet.`,
      'NOT_YET_PUBLISHED',
    );
  }
}

/** Same country / type / category triple — the thing the resolver scores. */
function sameScope(a: PolicyScopeRow, b: PolicyScopeRow): boolean {
  return (
    a.country === b.country && a.providerType === b.providerType && a.categoryId === b.categoryId
  );
}

/** Do [publishedAt, retiredAt) windows intersect at all, now or later? */
function windowsOverlap(a: PolicyScopeRow, b: PolicyScopeRow): boolean {
  const aEnd = a.retiredAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bEnd = b.retiredAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return a.publishedAt.getTime() < bEnd && b.publishedAt.getTime() < aEnd;
}

/**
 * Refuse a publication that would put two policies of identical scope in force
 * at the same time.
 *
 * `resolveRequirements` already throws AMBIGUOUS_POLICY when two live policies
 * tie on specificity. That is the right behaviour at the wrong MOMENT: it fails
 * a provider trying to start a case, over a mistake an admin made days earlier
 * and has no way to see. Checking here moves the failure to the person who can
 * fix it, while the resolver keeps its check as the backstop.
 *
 * Windows are compared rather than "is it live right now", so a scheduled
 * publication that would collide next Tuesday is refused today.
 */
export function assertNoLiveOverlap(
  candidate: PolicyScopeRow,
  existing: readonly PolicyScopeRow[],
  _at: Date,
): void {
  const clash = existing.find(
    (p) =>
      p.version !== candidate.version && sameScope(p, candidate) && windowsOverlap(p, candidate),
  );
  if (clash) {
    throw new PolicyLifecycleError(
      `Policy ${clash.version} already covers this country/type/category for an overlapping period. ` +
        'Retire it first, or schedule this one to start when that one ends.',
      'OVERLAPPING_POLICY',
    );
  }
}
