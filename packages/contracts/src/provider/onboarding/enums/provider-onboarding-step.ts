// Sprint 8 — the provider onboarding wizard, as a contract.
//
// The ORDER of this array is the wizard order. It is defined once, server-side
// and shared, so the sidebar, the progress bar, the resume point, and the
// server's "what should you do next" answer cannot disagree about what comes
// after what.
//
// Codes, not labels. Every one of these is rendered from the client i18n
// bundle keyed by the code, so the wire format survives translation and an
// Arabic client and an English client are talking about the same step.
export const PROVIDER_ONBOARDING_STEPS = [
  /** Individual or registered business. First, because it changes what the
   *  later steps ask for. */
  'PROVIDER_TYPE',
  /** Name shown to seekers, profile image, verified phone. */
  'IDENTITY',
  /** Service city, the areas within it, workshop location and travel radius. */
  'LOCATION',
  /** Primary service groups and the LEAF specialties beneath them. */
  'SPECIALTIES',
  /** Years in the trade, equipment owned, how they travel to a job. */
  'EXPERIENCE',
  /** The weekly working schedule. */
  'AVAILABILITY',
  /** Headline, bio, anything else worth saying. */
  'PROFILE',
  /** Terms accepted, pinned to a document version. */
  'CONSENT',
  /** Read back everything above, then submit. Collects nothing of its own. */
  'REVIEW',
] as const;

export type ProviderOnboardingStep = (typeof PROVIDER_ONBOARDING_STEPS)[number];

/**
 * What the provider should do next, decided by the server.
 *
 * The client does not infer this from the step list, because the answer is not
 * always "fill in a step": once an application is submitted it becomes "wait",
 * and after Sprint 8 submission it becomes "send us your documents". A client
 * that guessed would invite a provider to withdraw a queued application in
 * order to fix nothing.
 */
export type ProviderOnboardingNextAction =
  /** Go to `step` and finish it. */
  | { kind: 'COMPLETE_STEP'; step: ProviderOnboardingStep }
  /** Everything is answered; the Submit button is live. */
  | { kind: 'SUBMIT' }
  /** Submitted and queued. Nothing to do. */
  | { kind: 'AWAIT_REVIEW' }
  /** Application accepted as COMPLETE — not approved. Documents outstanding. */
  | { kind: 'UPLOAD_DOCUMENTS' }
  /** Decided, one way or the other. */
  | { kind: 'NONE' };
