// Sprint 7 axis 1, exposed to clients in Sprint 8.
// docs/adr/0005-provider-lifecycle-axes.md
//
// Where the APPLICATION is, and nothing else. Deliberately says nothing about
// whether the provider may work — that is a capability, answered by
// GET /v1/me/provider/capabilities, and conflating the two is the exact
// mistake ADR 0005 exists to undo.
export const PROVIDER_ONBOARDING_LIFECYCLE_STATES = [
  /** A provider profile exists but the wizard has never been opened. */
  'NOT_STARTED',
  /** In progress. Editable. */
  'DRAFT',
  /** Handed in and queued. Not editable — withdraw first. */
  'SUBMITTED',
  /**
   * The wizard was completed and validated; identity documents are the only
   * thing outstanding.
   *
   * This is where a valid Sprint 8 submission lands, and it grants NOTHING:
   * no marketplace access, no work-access grant, no verified badge. It is a
   * distinct state rather than a flavour of SUBMITTED so that "application
   * complete" and "approved to work" can never be read as the same fact.
   */
  'DOCUMENTS_REQUIRED',
  /** Reviewed and accepted. Still not, by itself, permission to work. */
  'ACCEPTED',
  /**
   * Sent back for changes. NOT a conduct decision — a returned applicant is in
   * good standing and may edit and resubmit.
   */
  'RETURNED',
] as const;

export type ProviderOnboardingLifecycleState =
  (typeof PROVIDER_ONBOARDING_LIFECYCLE_STATES)[number];
