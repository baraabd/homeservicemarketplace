// Sprint 09B.29 Phase 5 (C1) — what a brand-new V2 draft may assume.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.6
//
// TWO DEFAULTS, AND THE SAME RULE BEHIND BOTH
//
// The approved V2 screens ask for neither a provider type nor a professional
// title. That is a deliberate simplification of the journey — an individual
// tradesperson should not have to answer "are you a business?" before they can
// type their name — and it leaves two server-owned fields the client can no
// longer fill.
//
// So the server fills them, ONCE, at the moment a V2 draft is created, and
// only where nothing is there. Neither is ever an overwrite:
//
//   providerType  defaulted to INDIVIDUAL when absent. A profile that already
//                 says BUSINESS was set that way by somebody — the V1 wizard,
//                 an admin, a migration — and V2 has no screen that could have
//                 changed their mind.
//   headline      seeded from the server-generated suggestion when blank. A
//                 provider who wrote their own is the authority on it, and a
//                 legacy headline is somebody's earlier answer.
//
// WHY "BLANK" IS THREE CASES AND NOT ONE
//
// `null` is "never set". `''` is what an empty form control posts. `'   '` is
// what a form control posts after somebody types a space and gives up. All
// three mean the provider has not said anything, and treating only `null` as
// blank would leave a whitespace headline on a public profile for ever.
//
// PURE ON PURPOSE. This is a decision about four values, and it is the part
// with the edge cases; keeping it out of the repository means every one of
// them is tested without a database.

/** The provider type a V2 draft assumes when the profile does not have one. */
export const V2_DEFAULT_PROVIDER_TYPE = 'INDIVIDUAL';

export interface OnboardingDefaultsInput {
  /** What the profile already says, if anything. */
  readonly existingProviderType?: string | null;
  readonly existingHeadline?: string | null;
  /** The server-generated title for this provider's primary service, in the
   *  language the draft is being created in. Null when they have not chosen a
   *  primary service yet, which is the ordinary case on a first read. */
  readonly suggestedTitle?: string | null;
}

/**
 * The fields to WRITE, or an empty object.
 *
 * Deliberately shaped as a patch rather than a full value set: a caller spreads
 * it into an update and writes nothing when there is nothing to write. An
 * `applyDefaults(profile)` returning a whole profile would make "did this
 * change anything?" a comparison, and a comparison is how a coincidentally
 * equal legacy value gets overwritten.
 */
export interface OnboardingDefaultsPatch {
  readonly providerType?: typeof V2_DEFAULT_PROVIDER_TYPE;
  readonly headline?: string;
}

/** Is this value one a provider has actually supplied? */
export function isBlank(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

/**
 * Decide the defaults for a NEW V2 draft.
 *
 * Called only on the create path. Calling it on every read would be harmless
 * today — every branch is guarded by "is it blank" — but it would mean a
 * provider who deliberately CLEARED their headline had it refilled on their
 * next page load, which is an overwrite wearing a default's clothes.
 */
export function onboardingDefaultsForNewDraft(
  input: OnboardingDefaultsInput,
): OnboardingDefaultsPatch {
  const patch: { providerType?: typeof V2_DEFAULT_PROVIDER_TYPE; headline?: string } = {};

  if (isBlank(input.existingProviderType)) {
    patch.providerType = V2_DEFAULT_PROVIDER_TYPE;
  }

  // The suggestion has to exist AND the headline has to be blank. A provider
  // with no primary service yet gets nothing rather than an empty string.
  if (isBlank(input.existingHeadline) && !isBlank(input.suggestedTitle)) {
    patch.headline = (input.suggestedTitle as string).trim();
  }

  return patch;
}
