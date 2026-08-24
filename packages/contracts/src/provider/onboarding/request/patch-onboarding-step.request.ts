import type { ProviderAvailabilityIntervalInput } from '../response/provider-onboarding-draft';
import type {
  ProviderTransportModeCode,
  ProviderTypeCode,
} from '../response/provider-onboarding-draft';
import type { ProviderOnboardingStep } from '../enums/provider-onboarding-step';

// Sprint 8 — PATCH /v1/me/provider/onboarding/steps/:step
//
// One step per request. Not one big PATCH of the whole application: autosave
// fires per screen, and a partial write of everything makes it impossible to
// tell an unanswered question from a cleared one.
//
// Every field is optional and `null` CLEARS while `undefined` LEAVES ALONE, so
// the client can send only what the current screen owns.

export interface PatchOnboardingStepRequest {
  /**
   * The version the client last read. Required.
   *
   * A mismatch is a 409 with the server's current state attached, so the
   * client can show the conflict rather than clobbering the other tab. There
   * is no way to opt out: an unversioned write is a silent overwrite by
   * another name.
   */
  version: number;

  // ── PROVIDER_TYPE ───────────────────────────────────────────────────────
  providerType?: ProviderTypeCode | null;
  legalBusinessName?: string | null;

  // ── IDENTITY ────────────────────────────────────────────────────────────
  displayName?: string | null;
  profileImageUrl?: string | null;
  phoneNumber?: string | null;

  // ── LOCATION ────────────────────────────────────────────────────────────
  serviceAreaCity?: string | null;
  serviceAreaCountry?: string | null;
  serviceAreaLat?: number | null;
  serviceAreaLng?: number | null;
  serviceAreaRadiusKm?: number | null;
  /** City / district / neighborhood ids. Replaces the whole set. */
  serviceAreaIds?: string[];
  workshopAddressLine?: string | null;
  workshopLat?: number | null;
  workshopLng?: number | null;

  // ── SPECIALTIES ─────────────────────────────────────────────────────────
  /** Organisational groups. An expression of intent — selecting one grants
   *  nothing and never auto-approves the leaves beneath it. */
  primaryGroupIds?: string[];
  /** Leaf specialties the provider wants. Ones they do not already hold are
   *  turned into ProviderCategoryApplication rows for an admin to decide; they
   *  are NOT granted by this call. */
  specialtyLeafIds?: string[];

  // ── EXPERIENCE ──────────────────────────────────────────────────────────
  yearsOfExperience?: number | null;
  /** ISO date. */
  professionSince?: string | null;
  equipmentCodes?: string[];
  transportMode?: ProviderTransportModeCode | null;

  // ── AVAILABILITY ────────────────────────────────────────────────────────
  /** Replaces the WHOLE week. Overlap is a property of the set, so validating
   *  one interval at a time would let two conflicting windows be added in
   *  either order and each pass on its own. */
  availability?: ProviderAvailabilityIntervalInput[];
  /** IANA zone, e.g. `Asia/Damascus`. */
  timezone?: string | null;

  // ── PROFILE ─────────────────────────────────────────────────────────────
  headline?: string | null;
  bio?: string | null;
  additionalInformation?: string | null;

  // ── CONSENT ─────────────────────────────────────────────────────────────
  /** The policy document version being accepted. Must match the version the
   *  server currently publishes — accepting a stale document is not consent to
   *  the live one. */
  acceptedConsentVersion?: string | null;
}

/** Sent with `submit` so the server can refuse a submission raised against a
 *  draft that has since changed in another tab. */
export interface SubmitOnboardingRequest {
  version: number;
  /**
   * Client-generated key making submission IDEMPOTENT. Re-sending the same key
   * returns the original outcome instead of transitioning twice, so a retry
   * after a dropped response cannot produce a second application.
   */
  idempotencyKey?: string;
}

/** The step a PATCH targets, taken from the route rather than the body so a
 *  request cannot claim to be editing one step while writing another. */
export type PatchOnboardingStepTarget = ProviderOnboardingStep;
