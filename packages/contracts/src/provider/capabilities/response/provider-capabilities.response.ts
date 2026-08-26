// Sprint 7 — the provider capability contract.
// docs/adr/0006-provider-capability-service.md
//
// The Provider app renders from THIS, not from `profile.status`. Re-deriving
// gating on the client is what shipped the DRAFT "Continue onboarding" loop:
// the client's model of the rule and the server's disagreed, and neither was
// wrong about its own model.
//
// The server still enforces independently on every mutation. This endpoint
// exists so the UI stops guessing, not so the server can stop checking.

/** What a provider may attempt. Named for the ACTION, never for a status, so
 *  adding a lifecycle axis changes the rules in one file rather than every
 *  call site that used to compare an enum. */
export const ProviderCapability = {
  ViewOwnProfile: 'VIEW_OWN_PROFILE',
  EditOwnProfile: 'EDIT_OWN_PROFILE',
  /** Enter and progress the onboarding surface. Held by DRAFT providers —
   *  this is the capability whose absence made onboarding unreachable. */
  CompleteOnboarding: 'COMPLETE_ONBOARDING',
  SubmitForReview: 'SUBMIT_FOR_REVIEW',
  ViewMarketplace: 'VIEW_MARKETPLACE',
  SubmitBid: 'SUBMIT_BID',
  ManageBookings: 'MANAGE_BOOKINGS',
  ViewEarnings: 'VIEW_EARNINGS',
  /** Sprint 9B.8 — submit a verification case and manage its evidence.
   *
   *  A capability of its own because none of the existing ones fit. It is not
   *  CompleteOnboarding: that is withheld once onboarding reaches ACCEPTED, and
   *  re-verification is precisely something an ACCEPTED provider does. It is
   *  not EditOwnProfile: evidence goes to restricted storage and is scanned,
   *  which is a different blast radius from changing a headline.
   *
   *  Held from rank 4 downward — a RESTRICTED provider may keep their
   *  verification current — and withheld from SUSPENDED and TERMINATED, who
   *  should not be uploading documents into a pipeline that will not act on
   *  them. */
  ManageVerification: 'MANAGE_VERIFICATION',
  /** Sprint 9B.9 — see a heavily redacted slice of the marketplace while
   *  waiting for work access.
   *
   *  Held ONLY by a provider who has finished onboarding and is being denied
   *  work — the two states where "you may not work yet" is the whole message.
   *  Deliberately NOT held by a provider who already has work access (they get
   *  the real feed) nor by one still in onboarding (they have a task in front
   *  of them and a preview is a distraction from it), and never by a suspended,
   *  terminated or restricted provider.
   *
   *  Holding it is necessary but NOT sufficient: the preview also has to be
   *  switched on by policy, which is off by default. */
  PreviewMarketplace: 'PREVIEW_MARKETPLACE',
  AppealDecision: 'APPEAL_DECISION',
} as const;
export type ProviderCapability = (typeof ProviderCapability)[keyof typeof ProviderCapability];

/** Why a capability is withheld.
 *
 *  Stable codes with NO policy detail. They are read by the person being
 *  denied — including someone probing the boundary — so they never disclose
 *  which threshold failed, when a grant expires, or which internal rule fired.
 *  The client maps each to localised copy. */
export const ProviderCapabilityDenialReason = {
  /** The ACCOUNT is ineligible (suspended, locked, deleted, deactivated).
   *  Outranks every provider-side consideration. */
  AccountIneligible: 'ACCOUNT_INELIGIBLE',
  /** No provider profile exists yet. */
  NoProviderProfile: 'NO_PROVIDER_PROFILE',
  OnboardingIncomplete: 'ONBOARDING_INCOMPLETE',
  /** Submitted and awaiting a decision. */
  AwaitingReview: 'AWAITING_REVIEW',
  ProviderRestricted: 'PROVIDER_RESTRICTED',
  ProviderSuspended: 'PROVIDER_SUSPENDED',
  ProviderTerminated: 'PROVIDER_TERMINATED',
  VerificationRequired: 'VERIFICATION_REQUIRED',
  /** No live work-access grant. Inert until Sprint 9 issues grants. */
  NoWorkAccess: 'NO_WORK_ACCESS',
} as const;
export type ProviderCapabilityDenialReason =
  (typeof ProviderCapabilityDenialReason)[keyof typeof ProviderCapabilityDenialReason];

/** Something the provider can actually DO to move forward.
 *
 *  A denial without a next action is a dead end that generates a support
 *  ticket. These are UI intents, not URLs, so routing stays the client's. */
export const ProviderNextAction = {
  CompleteProfile: 'COMPLETE_PROFILE',
  SubmitApplication: 'SUBMIT_APPLICATION',
  WaitForReview: 'WAIT_FOR_REVIEW',
  ContactSupport: 'CONTACT_SUPPORT',
  AppealDecision: 'APPEAL_DECISION',
  VerifyIdentity: 'VERIFY_IDENTITY',
} as const;
export type ProviderNextAction = (typeof ProviderNextAction)[keyof typeof ProviderNextAction];

export interface ProviderCapabilityDecision {
  capability: ProviderCapability;
  allowed: boolean;
  /** Present only when `allowed` is false. */
  reason?: ProviderCapabilityDenialReason;
}

export interface ProviderCapabilitiesResponse {
  /** Every capability with its verdict — the full set, always, so a client
   *  cannot mistake "absent because denied" for "absent because the server is
   *  an older build that never heard of it". */
  capabilities: ProviderCapabilityDecision[];
  /** Flat allow-list, for the common `includes()` check. */
  allowed: ProviderCapability[];
  /** What to offer the provider next, most useful first. */
  nextActions: ProviderNextAction[];
  /** The single reason that best explains the current overall posture, or
   *  null when nothing is withheld. Lets the UI render one banner instead of
   *  deducing a headline from nine decisions. */
  primaryReason: ProviderCapabilityDenialReason | null;
}
