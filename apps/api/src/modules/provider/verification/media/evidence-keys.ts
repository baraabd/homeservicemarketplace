import { createHash, randomUUID } from 'node:crypto';

import { extensionForEvidenceMime, type EvidenceMimeType } from './file-signature';

// Sprint 9B — where restricted evidence lives, and how it is named.
//
// docs/adr/0009-restricted-identity-media.md §3
//
// The public request-media route resolves ANY key from the URL path, is
// @Public(), and sets `Cache-Control: public, max-age=31536000, immutable`.
// Identity evidence must therefore be unreachable from it. That is enforced
// twice, on purpose: by configuration (a distinct bucket/root) and by code
// (the prefix check below). One of those is the control; the other is what
// catches a misconfiguration.

/** The namespace restricted evidence lives under. Nothing public may resolve a
 *  key beginning with this. */
export const RESTRICTED_NAMESPACE = 'verification';

/** Namespaces the PUBLIC media route must refuse outright. Kept as a list
 *  rather than a single string so a future restricted namespace is one edit
 *  and cannot be forgotten at the call site. */
export const RESTRICTED_NAMESPACES: readonly string[] = Object.freeze([RESTRICTED_NAMESPACE]);

/**
 * True when a key belongs to a restricted namespace.
 *
 * Used by the public serve route to refuse, not by the restricted route to
 * accept — the restricted route authorises by database row, never by string
 * shape. A key check is a backstop against misconfiguration, not an
 * authorization mechanism, and treating it as one would be exactly the
 * "security by URL secrecy" the ADR rejects.
 */
export function isRestrictedKey(key: string): boolean {
  const normalised = key.replace(/^\/+/, '').toLowerCase();
  return RESTRICTED_NAMESPACES.some((ns) => normalised === ns || normalised.startsWith(`${ns}/`));
}

/**
 * The storage key for one piece of evidence.
 *
 * Built entirely from server-side values: the case id, a fresh asset id, and
 * the DETECTED type. No component comes from the client — not the filename,
 * not the declared type, not a caller-supplied path. That is what makes
 * traversal inexpressible rather than merely filtered.
 */
export function buildEvidenceKey(input: {
  caseId: string;
  assetId: string;
  detectedMime: EvidenceMimeType;
}): string {
  const ext = extensionForEvidenceMime(input.detectedMime);
  return `${RESTRICTED_NAMESPACE}/${input.caseId}/${input.assetId}.${ext}`;
}

/** A fresh asset id. Separate from the key so the id can be minted before the
 *  bytes arrive (and therefore before the type is known). */
export function newAssetId(): string {
  return randomUUID();
}

/**
 * SHA-256 of the received bytes.
 *
 * Survives deletion of the object (ADR 0012) and answers "was the document you
 * are showing me now the one we verified?" without keeping it. Also the
 * duplicate-identity fraud signal: the same file under two identities is
 * findable by hash alone.
 */
export function hashEvidence(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * When the BYTES become eligible for deletion.
 *
 * Per-outcome, because a rejected applicant and a quarantined malware sample
 * warrant opposite treatment: the first has the strongest claim to erasure, the
 * second is the evidence of an attack and is kept LONGEST.
 */
export function retainUntilFor(input: {
  outcome: 'VERIFIED' | 'REJECTED' | 'ABANDONED' | 'QUARANTINED';
  from: Date;
  days: { verified: number; rejected: number; abandoned: number; quarantine: number };
}): Date {
  const map = {
    VERIFIED: input.days.verified,
    REJECTED: input.days.rejected,
    ABANDONED: input.days.abandoned,
    QUARANTINED: input.days.quarantine,
  } as const;
  return new Date(input.from.getTime() + map[input.outcome] * 86_400_000);
}
