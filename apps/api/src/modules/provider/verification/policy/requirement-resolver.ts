// Sprint 9B — resolving "what must this provider prove?"
//
// docs/adr/0010-policy-versioned-verification.md
//
// A pure function over candidate policy rows. It performs NO I/O: the caller
// supplies the policies it read, exactly as ProviderCapabilityService keeps its
// rules free of queries. That is what makes the whole cross-product testable
// without a database, and what stops a requirement rule quietly growing a
// network call.

import type { VerificationDocumentKind } from '@homeservicemarketplace/database';

/** One published policy row, reduced to what resolution needs. */
export interface CandidatePolicy {
  version: string;
  /** ISO-3166-1 alpha-2, or null for the global default. */
  country: string | null;
  /** null = applies to both INDIVIDUAL and BUSINESS. */
  providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  /** null = applies to every category. */
  categoryId: string | null;
  requirements: PolicyRequirements;
  publishedAt: Date;
  retiredAt: Date | null;
}

/** The JSON payload on a policy row. Versioned by `version`, not by the schema
 *  — a new document kind must not require a migration (ADR 0010). */
export interface PolicyRequirements {
  /** Document kinds this policy demands. */
  documents: VerificationDocumentKind[];
  /** When false, this country/type needs no identity verification at all and
   *  rank 6 must not deny. Explicit rather than inferred from an empty list,
   *  because "no documents configured yet" and "genuinely not required" are
   *  different facts and only one of them is safe. */
  verificationRequired: boolean;
}

export interface ResolvedRequirement {
  kind: VerificationDocumentKind;
  /** Set only for CATEGORY_LICENSE: which trade this satisfies. */
  serviceCategoryId: string | null;
  /** The policy version that demanded it, so a checklist row can be traced. */
  fromVersion: string;
}

export interface ResolvedRequirements {
  /** The version stamped onto the case. The most specific NON-category policy
   *  wins — category rows add requirements, they do not redefine the base. */
  policyVersion: string;
  verificationRequired: boolean;
  requirements: ResolvedRequirement[];
}

export class RequirementResolutionError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_POLICY_IN_FORCE' | 'AMBIGUOUS_POLICY' | 'INVALID_POLICY',
  ) {
    super(message);
    this.name = 'RequirementResolutionError';
  }
}

/** Live at `at`: published, and not yet retired. */
function isLive(p: CandidatePolicy, at: Date): boolean {
  if (p.publishedAt.getTime() > at.getTime()) return false;
  return p.retiredAt === null || p.retiredAt.getTime() > at.getTime();
}

/**
 * Specificity, high to low:
 *
 *   3  country + type
 *   2  country
 *   1  type
 *   0  global default
 *
 * Category is NOT part of this score. Category policies are additive — a
 * provider offering two licensed trades must produce both licences, because
 * holding an electrician's licence says nothing about gas — so they are
 * unioned rather than competing for "most specific".
 */
function baseSpecificity(p: CandidatePolicy): number {
  return (p.country !== null ? 2 : 0) + (p.providerType !== null ? 1 : 0);
}

function appliesToBase(
  p: CandidatePolicy,
  country: string | null,
  providerType: 'INDIVIDUAL' | 'BUSINESS' | null,
): boolean {
  if (p.categoryId !== null) return false;
  if (p.country !== null && p.country !== country) return false;
  if (p.providerType !== null && p.providerType !== providerType) return false;
  return true;
}

/**
 * Resolve the requirement set.
 *
 * Throws rather than returning an empty set when nothing applies. "No policy in
 * force" must never read as "verified with no evidence" — resolving to nothing
 * is the single most dangerous silent success available here, so it is an error.
 */
export function resolveRequirements(input: {
  country: string | null;
  providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
  categoryIds: readonly string[];
  policies: readonly CandidatePolicy[];
  at: Date;
}): ResolvedRequirements {
  const { country, providerType, categoryIds, at } = input;
  const live = input.policies.filter((p) => isLive(p, at));

  // ── the base policy ────────────────────────────────────────────────────
  const baseCandidates = live.filter((p) => appliesToBase(p, country, providerType));
  if (baseCandidates.length === 0) {
    throw new RequirementResolutionError(
      'No verification policy is in force for this provider.',
      'NO_POLICY_IN_FORCE',
    );
  }

  const topScore = Math.max(...baseCandidates.map(baseSpecificity));
  const winners = baseCandidates.filter((p) => baseSpecificity(p) === topScore);
  if (winners.length > 1) {
    // Two policies at equal specificity is a PUBLICATION error. Picking one
    // would make the requirement set depend on row order, which is not a rule
    // anybody could review.
    throw new RequirementResolutionError(
      `Ambiguous verification policy: ${winners.map((w) => w.version).join(', ')}`,
      'AMBIGUOUS_POLICY',
    );
  }

  const base = winners[0];
  if (!Array.isArray(base.requirements?.documents)) {
    throw new RequirementResolutionError(
      `Policy ${base.version} has no document list.`,
      'INVALID_POLICY',
    );
  }

  const out: ResolvedRequirement[] = base.requirements.documents.map((kind) => ({
    kind,
    serviceCategoryId: null,
    fromVersion: base.version,
  }));

  // ── category policies, unioned ─────────────────────────────────────────
  //
  // Deduplicated on (kind, categoryId): two policies naming the same licence
  // for the same category is a duplicate requirement, not two of them.
  const seen = new Set(out.map((r) => `${r.kind}:${r.serviceCategoryId ?? ''}`));

  for (const categoryId of categoryIds) {
    const catPolicies = live.filter(
      (p) =>
        p.categoryId === categoryId &&
        (p.country === null || p.country === country) &&
        (p.providerType === null || p.providerType === providerType),
    );
    for (const p of catPolicies) {
      for (const kind of p.requirements?.documents ?? []) {
        const key = `${kind}:${categoryId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ kind, serviceCategoryId: categoryId, fromVersion: p.version });
      }
    }
  }

  return {
    policyVersion: base.version,
    verificationRequired: base.requirements.verificationRequired,
    requirements: out,
  };
}

/**
 * What is still outstanding.
 *
 * Compares the resolved requirement set against the documents actually held.
 * Recomputed server-side at submission AND at decision time — a client that
 * posts "I have satisfied everything" is ignored (ADR 0010 §5).
 */
export function missingRequirements(
  resolved: ResolvedRequirements,
  held: ReadonlyArray<{
    kind: VerificationDocumentKind;
    serviceCategoryId: string | null;
    /** Sprint 9B.4 — the scan state of the evidence behind this document.
     *  Required, not optional: an optional field here would let a caller
     *  satisfy a requirement by simply not mentioning it. */
    scanState: string;
  }>,
): ResolvedRequirement[] {
  return resolved.requirements.filter(
    (req) =>
      !held.some(
        (doc) =>
          doc.kind === req.kind &&
          (doc.serviceCategoryId ?? null) === req.serviceCategoryId &&
          // Sprint 9B.4 — ONLY a scanned, clean document counts.
          //
          // Without this, a provider is verified on the strength of a file
          // nobody has cleared, and in the QUARANTINED case on the strength of
          // one a scanner positively flagged. That is the entire point of
          // scanning, and it has to be enforced HERE rather than in the UI:
          // this function is what a submission and a reviewer decision are
          // recomputed against (ADR 0010 §5).
          //
          // Compared against CLEAN rather than a denylist, so a scan state
          // invented later fails closed without anyone remembering to add it.
          doc.scanState === 'CLEAN',
      ),
  );
}
