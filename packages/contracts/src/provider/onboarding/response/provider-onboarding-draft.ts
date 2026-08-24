import type { ProviderOnboardingIssue } from '../enums/provider-onboarding-field';
import type { ProviderOnboardingLifecycleState } from '../enums/provider-onboarding-lifecycle-state';
import type {
  ProviderOnboardingNextAction,
  ProviderOnboardingStep,
} from '../enums/provider-onboarding-step';

// Sprint 8 — the whole wizard, in one response.
//
// GET, PATCH, submit and withdraw all return this same shape, so the client
// never has to merge a mutation result into a stale read or decide which of
// two half-answers is current. One call, one complete picture.

/** Individual tradesperson or registered business. */
export type ProviderTypeCode = 'INDIVIDUAL' | 'BUSINESS';

/** How a provider reaches a job. Codes, not labels — the label lives in the
 *  client i18n bundle keyed by this value. */
export type ProviderTransportModeCode =
  | 'ON_FOOT'
  | 'MOTORCYCLE'
  | 'CAR'
  | 'VAN'
  | 'TRUCK'
  | 'PUBLIC_TRANSPORT';

/** One weekly working window.
 *
 *  Minutes from LOCAL midnight, end EXCLUSIVE — so 09:00-17:00 is
 *  `{ startMinute: 540, endMinute: 1020 }` and two adjacent windows can touch
 *  without overlapping. A window running to midnight ends at 1440.
 *
 *  A window that wraps past midnight is TWO intervals on two days. The wizard
 *  splits it before sending; the server rejects the wrapped form. */
export interface ProviderAvailabilityIntervalInput {
  /** 0 = Sunday … 6 = Saturday. Matches JS `Date#getDay()`. */
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

export interface ProviderAvailabilityInterval extends ProviderAvailabilityIntervalInput {
  id: string;
  /** IANA zone the window is expressed in, e.g. `Asia/Damascus`. Stored per
   *  interval so a provider who moves cities does not silently shift every
   *  window in their week. */
  timezone: string;
}

/** Everything the wizard has collected so far, as the SERVER holds it.
 *
 *  Echoed back on every response so the client renders from the server's copy
 *  rather than from local state that a failed autosave may have diverged from.
 *  Every field is nullable: this is a half-filled application by definition. */
export interface ProviderOnboardingData {
  providerType: ProviderTypeCode | null;
  legalBusinessName: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  phoneNumber: string | null;
  /** Whether the number above has been PROVEN, not merely entered. */
  phoneVerified: boolean;

  serviceAreaCity: string | null;
  serviceAreaCountry: string | null;
  serviceAreaLat: number | null;
  serviceAreaLng: number | null;
  serviceAreaRadiusKm: number | null;
  /** Selected city / district / neighborhood ids, at whatever granularity the
   *  provider chose. */
  serviceAreaIds: string[];
  workshopAddressLine: string | null;
  workshopLat: number | null;
  workshopLng: number | null;

  /** Organisational groups the provider says they work in. Selecting one
   *  grants NOTHING — see `specialtyLeafIds` and `pendingSpecialtyIds`. */
  primaryGroupIds: string[];
  /** Leaf specialties the provider has been APPROVED for. */
  specialtyLeafIds: string[];
  /** Leaf specialties applied for and awaiting an admin decision. */
  pendingSpecialtyIds: string[];

  yearsOfExperience: number | null;
  /** ISO date. An alternative to `yearsOfExperience`; the server derives one
   *  from the other so the stored fact does not silently age. */
  professionSince: string | null;
  equipmentCodes: string[];
  transportMode: ProviderTransportModeCode | null;

  availability: ProviderAvailabilityInterval[];
  /** The zone new intervals are recorded in. */
  timezone: string | null;

  headline: string | null;
  bio: string | null;
  additionalInformation: string | null;

  /** The policy document version the provider accepted, or null. */
  acceptedConsentVersion: string | null;
  consentAcceptedAt: string | null;
}

/** One step, with the requirements it is responsible for. */
export interface ProviderOnboardingStepView {
  step: ProviderOnboardingStep;
  complete: boolean;
  /** The unmet requirements belonging to THIS step, so the sidebar can show
   *  them in place without re-partitioning the global list. */
  issues: ProviderOnboardingIssue[];
}

/**
 * The complete wizard state.
 *
 * Every derived value here — `completedSteps`, `percentComplete`,
 * `nextAction`, `complete` — is computed by the SERVER from the same
 * completeness policy that submission enforces. The client renders them; it
 * does not re-derive them. A client with its own copy of the rules is how a
 * Submit button ends up enabled and then 422-ing.
 */
export interface ProviderOnboardingDraftView {
  /** Where the application is. Says nothing about whether the provider may
   *  work — that is `GET /v1/me/provider/capabilities`. */
  state: ProviderOnboardingLifecycleState;
  /** Where to resume: the FIRST incomplete step, not the furthest reached. */
  currentStep: ProviderOnboardingStep;
  steps: ProviderOnboardingStepView[];
  completedSteps: ProviderOnboardingStep[];
  /** 0-100, whole numbers. Computed once here so two clients cannot round it
   *  two different ways. */
  percentComplete: number;
  nextAction: ProviderOnboardingNextAction;

  /** True when nothing is outstanding and submission would succeed. */
  complete: boolean;
  /** Every unmet requirement, across all steps. */
  missing: ProviderOnboardingIssue[];

  data: ProviderOnboardingData;

  /**
   * Optimistic-concurrency token. Echo it back on the next PATCH; a mismatch
   * is a 409 rather than a silent overwrite.
   *
   * Two tabs open on one wizard is the ordinary case, not the exotic one, and
   * without this the failure mode is a provider watching half their answers
   * disappear with no error.
   */
  version: number;
  /** The completeness policy in force for THIS draft, pinned when it was
   *  created so a rule added mid-application cannot retroactively fail it. */
  policyVersion: string;
  /** ISO timestamp of the last accepted write, for the "Saved 12:04" line. */
  lastSavedAt: string | null;
  /** False while an application is queued for review. */
  editable: boolean;
}
