// Sprint 9B — who may read one piece of restricted identity evidence.
//
// docs/adr/0009-restricted-identity-media.md §3
//
// A PURE decision over facts the caller has already loaded. No I/O, so the
// whole matrix is testable without a database — the same discipline ADR 0006
// holds ProviderCapabilityService to, and for the same reason: this is a
// security boundary, and a boundary you cannot enumerate is a boundary you
// cannot review.
//
// Deny-by-default: the function starts from a denial and only an explicitly
// matched allow rule overturns it. A fact added to the input and forgotten here
// denies, which is the direction an omission should fail in.

/** Everything the decision reads. Assembled by the caller so no rule can
 *  smuggle in an extra query. */
export interface EvidenceReadContext {
  /** The signed-in caller. */
  actorUserId: string;
  /** True when the actor holds the dedicated evidence-view permission. NOT the
   *  generic admin role: viewing a passport is a narrower capability than
   *  administering the platform, and conflating them means every admin can
   *  read every identity document. */
  actorHasEvidenceViewPermission: boolean;
  /** The user the provider profile belongs to. Null for an orphaned profile. */
  ownerUserId: string | null;
  /** Visibility recorded on the asset. Anything but RESTRICTED here is a
   *  routing mistake, and is refused rather than served. */
  visibility: 'PUBLIC' | 'PRIVATE' | 'RESTRICTED';
  /** Scan state recorded on the asset. */
  scanState: 'PENDING' | 'CLEAN' | 'QUARANTINED' | 'SCAN_FAILED';
  /** Set once the bytes have been destroyed under the retention schedule. */
  evidenceDeletedAt: Date | null;
  /** The case the document hangs off. Used only for the audit trail; a
   *  reviewer's right to read does not depend on assignment (assignment is
   *  workflow, not authorization — ADR 0013 §1), but it IS recorded. */
  caseId: string;
}

/** Stable denial codes. Read by whoever is being denied, including someone
 *  probing the boundary, so they carry no policy detail: no expiry date, no
 *  which-permission, no whether-the-case-exists. */
export type EvidenceReadDenial =
  | 'NOT_RESTRICTED_ASSET'
  | 'NOT_AUTHORIZED'
  | 'SELF_REVIEW'
  | 'NOT_SCANNED'
  | 'QUARANTINED'
  | 'EVIDENCE_DELETED';

export type EvidenceReadDecision =
  | { allowed: true; as: 'owner' | 'reviewer' }
  | { allowed: false; reason: EvidenceReadDenial };

/**
 * May this actor read these bytes?
 *
 * Order matters and is deliberate:
 *
 *   1. Is this even restricted evidence?      (routing sanity)
 *   2. Is the actor one of the two allowed?   (authorization)
 *   3. Is this a self-review?                 (integrity — see below)
 *   4. Is the object safe and present?        (availability)
 *
 * Self-review is checked AFTER authorization and BEFORE availability, because
 * a reviewer who is also the subject must be refused for being the subject —
 * not told "not scanned yet", which would leak the object's state to someone
 * who should not be evaluating it at all.
 *
 * The owner path is separate: a provider reading THEIR OWN document is not a
 * self-review. Self-review means judging your own application while wearing a
 * reviewer's permission, and the distinction is what stops the anti-self-review
 * rule from locking providers out of their own evidence.
 */
export function decideEvidenceRead(ctx: EvidenceReadContext): EvidenceReadDecision {
  // 1. Only RESTRICTED assets are served by this path. A PUBLIC or PRIVATE
  //    asset arriving here means a caller found the wrong route; serving it
  //    would make this endpoint a general file reader.
  if (ctx.visibility !== 'RESTRICTED') {
    return { allowed: false, reason: 'NOT_RESTRICTED_ASSET' };
  }

  const isOwner = ctx.ownerUserId !== null && ctx.ownerUserId === ctx.actorUserId;
  const isReviewer = ctx.actorHasEvidenceViewPermission;

  // 2. Exactly two roles may read. Anyone else — including an admin without
  //    the dedicated permission — is denied.
  if (!isOwner && !isReviewer) {
    return { allowed: false, reason: 'NOT_AUTHORIZED' };
  }

  // 3. Self-review needs no branch HERE, and that is the interesting part.
  //
  //    Someone who is both owner and reviewer resolves to `as: 'owner'` below,
  //    because reading your own passport is something you are entitled to do.
  //    What they must not do is DECIDE on it, and that is blocked separately by
  //    the case service via `isSelfReview` (exported beside this function so
  //    the two cannot drift apart).
  //
  //    Refusing the read outright would lock a provider who happens to hold a
  //    staff permission out of their own evidence, which is a support problem
  //    masquerading as a security control.

  // 4. Availability. Only a scanned, clean, still-present object is served.
  //    Compared against CLEAN rather than against a list of bad states, so a
  //    scan state added later is refused by default instead of becoming
  //    silently readable.
  if (ctx.evidenceDeletedAt !== null) {
    return { allowed: false, reason: 'EVIDENCE_DELETED' };
  }
  if (ctx.scanState === 'QUARANTINED') {
    // Held, not deleted (ADR 0012), and never served — serving a file a
    // scanner flagged would hand malware to the reviewer it was aimed at.
    return { allowed: false, reason: 'QUARANTINED' };
  }
  if (ctx.scanState !== 'CLEAN') {
    return { allowed: false, reason: 'NOT_SCANNED' };
  }

  return { allowed: true, as: isOwner ? 'owner' : 'reviewer' };
}

/**
 * The same decision, for an actor acting explicitly AS A REVIEWER on a case
 * they are the subject of.
 *
 * Used by the case/decision path rather than the read path. Kept beside its
 * sibling so the two cannot drift: reading your own evidence is fine, deciding
 * on it is not.
 */
export function isSelfReview(input: {
  actorUserId: string;
  subjectUserId: string | null;
}): boolean {
  return input.subjectUserId !== null && input.subjectUserId === input.actorUserId;
}

/** What gets written to VerificationAccessLog. Never the bytes, never the key,
 *  never a signed URL — ids and an outcome only (ADR 0009 §7). */
export function auditOutcomeFor(decision: EvidenceReadDecision): string {
  return decision.allowed ? `GRANTED_${decision.as.toUpperCase()}` : `DENIED_${decision.reason}`;
}
