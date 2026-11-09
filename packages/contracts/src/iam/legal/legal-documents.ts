// K02 — versioned public policy documents and their acceptance contract.
//
// The server owns which version is current and records acceptance with its
// own clock. A client names the exact versions it showed the user; a stale or
// unknown version is refused (409) so a person is never recorded as having
// accepted text they were not shown.
//
// `status` is DRAFT until the accountable owner approves the text. A DRAFT
// document can be shown and reviewed, but production refuses to record
// acceptance of it regardless of the draft rehearsal flag.
// Approval is a reviewed change to this file:
// status → APPROVED, `approvalReference` set, and a NEW version id whenever
// the text changes. Never edit the text of a version that users accepted.
//
// Provider onboarding consent (ProviderProfile.acceptedConsentVersion,
// setting `provider_consent_policy_version`) is a different agreement with
// its own version and is intentionally not part of this registry.

export const LEGAL_DOCUMENT_KINDS = ['TERMS_OF_SERVICE', 'PRIVACY_NOTICE'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export type LegalDocumentStatus = 'DRAFT' | 'APPROVED';

export interface LegalDocumentVersion {
  kind: LegalDocumentKind;
  version: string;
  status: LegalDocumentStatus;
  /** Owner approval record (decision id / date). Null while DRAFT. */
  approvalReference: string | null;
  /** Public route that renders this document in Arabic and English. */
  path: string;
}

export const CURRENT_LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentKind, LegalDocumentVersion>> =
  Object.freeze({
    TERMS_OF_SERVICE: Object.freeze({
      kind: 'TERMS_OF_SERVICE',
      version: 'ksa-terms-2026-11-03.draft-1',
      status: 'DRAFT',
      approvalReference: null,
      path: '/legal/terms',
    }),
    PRIVACY_NOTICE: Object.freeze({
      kind: 'PRIVACY_NOTICE',
      version: 'ksa-privacy-2026-11-03.draft-1',
      status: 'DRAFT',
      approvalReference: null,
      path: '/legal/privacy',
    }),
  });

/** Public informational pages that are not accepted, only published. */
export const PUBLIC_INFO_PATHS = Object.freeze({
  operator: '/legal/operator',
  contact: '/legal/contact',
  subscriptions: '/legal/subscriptions',
});

export const LEGAL_LOCALES = ['en', 'ar'] as const;
export type LegalLocale = (typeof LEGAL_LOCALES)[number];

/** Signup body addition: the exact versions shown next to the consent box. */
export interface LegalAcceptanceInput {
  termsVersion: string;
  privacyVersion: string;
  locale: LegalLocale;
}

/** GET /v1/legal/documents — what the signup form must show and send. */
export interface LegalDocumentsResponse {
  documents: LegalDocumentVersion[];
  /** False when the server will refuse acceptance (DRAFT in production). */
  acceptanceOpen: boolean;
}

/** Body of a 409 LEGAL_VERSION_STALE error, so the client can refresh. */
export interface LegalVersionStaleDetails {
  termsVersion: string;
  privacyVersion: string;
}
