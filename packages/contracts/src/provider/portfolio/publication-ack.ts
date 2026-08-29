// Sprint 9B.22 — the publication-right acknowledgement, with a version.
//
// docs/sprint-09b22/PUBLIC_PROFILE_AND_PORTFOLIO.md
//
// WHAT WAS WRONG WITH IT BEFORE
//
// Sprint 9B.10 already did the important half: the acknowledgement is recorded
// SERVER-SIDE with a timestamp (`publicationRightAckAt`), so it was never the
// untraceable client-only checkbox the brief warns about. What it could not
// answer is *what the provider actually agreed to* — the text column held one
// fixed sentinel, `PROVIDER_CONFIRMED_RIGHT_TO_PUBLISH`, so the day the wording
// changes, every row before and after it reads identically.
//
// So the wording is versioned here, the version is what the server stamps, and
// the wording for any version stays in this file forever. A row recorded under
// `2026.09-portfolio-ack-v1` can be read back and rendered exactly as the
// provider saw it, in the language they saw it in.
//
// THE CLIENT DOES NOT CHOOSE THE WORDING. It sends the version it displayed and
// the server refuses anything that is not current — the same rule the CONSENT
// step already applies to the terms document, and for the same reason:
// accepting a stale document is not consent to the live one.

/** `YYYY.MM-scope-vN`, matching the version format the verification policies
 *  already use. Sortable as a plain string, readable in a log line. */
export type PublicationAckVersion = string;

export interface PublicationAckWording {
  en: string;
  ar: string;
}

/**
 * Every version ever published, newest last. APPEND-ONLY.
 *
 * Editing an existing entry would silently rewrite what past providers are
 * recorded as having agreed to, which is the whole thing this table exists to
 * prevent. Correcting the wording means adding a version.
 */
export const PUBLICATION_ACK_WORDINGS: Readonly<Record<string, PublicationAckWording>> =
  Object.freeze({
    '2026.09-portfolio-ack-v1': {
      en:
        'I have the right to publish this photo. If it shows a customer’s home or property, ' +
        'I have their permission to show it publicly.',
      ar:
        'أملك الحق في نشر هذه الصورة. وإذا كانت تُظهر منزل عميل أو ممتلكاته، ' +
        'فقد حصلت على إذنه لعرضها للعموم.',
    },
  });

/**
 * The version new acknowledgements are recorded under.
 *
 * A constant rather than a platform setting: the wording and its version have
 * to change together, and an operator who could point this at a version whose
 * text is not in the table above would produce records nobody can read back.
 * Publishing new wording is a code change, which is the correct weight for a
 * legal assertion.
 */
export const CURRENT_PUBLICATION_ACK_VERSION: PublicationAckVersion = '2026.09-portfolio-ack-v1';

/** The sentinel Sprint 9B.10 wrote before this table existed. Rows carrying it
 *  are genuine acknowledgements whose exact wording was not captured; they are
 *  reported as such rather than mapped onto a version they predate. */
export const LEGACY_PUBLICATION_ACK_TEXT = 'PROVIDER_CONFIRMED_RIGHT_TO_PUBLISH';

/** The wording for a recorded version, or null when the row predates the table
 *  (or names a version this build does not know). Null is a real answer here —
 *  inventing wording for an unknown version would be worse than admitting the
 *  record is opaque. */
export function publicationAckWording(
  version: string | null | undefined,
): PublicationAckWording | null {
  if (!version) return null;
  return PUBLICATION_ACK_WORDINGS[version] ?? null;
}

export function isCurrentPublicationAckVersion(version: unknown): boolean {
  return version === CURRENT_PUBLICATION_ACK_VERSION;
}
