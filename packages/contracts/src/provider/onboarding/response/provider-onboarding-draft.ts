import type { ProviderSpecialtyView } from './provider-specialty-state';
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
  /** ISO 3166-1 alpha-2. Null on rows written before Sprint 9B.19. */
  serviceAreaCountryCode: string | null;
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

  // ── Sprint 9B.18 ────────────────────────────────────────────────────────

  /** Every chosen specialty with WHAT HAPPENED to it, in one list.
   *
   *  The two id arrays above are kept — every existing client reads them —
   *  but they cannot express "an admin said no" or "the category was
   *  retired", and a client that infers those from an id's absence gets both
   *  wrong. Prefer this. */
  specialties: ProviderSpecialtyView[];
  /** The one service the provider leads with. May be PENDING: nominating a
   *  primary is an intention, not an authorization. */
  primarySpecialtyId: string | null;
  /** The operator-configured ceiling on how many specialties may be held.
   *
   *  Served rather than hardcoded in the client: it is a platform setting an
   *  admin can change, and a client with its own number would either refuse a
   *  selection the server accepts or offer one it is about to reject. */
  maxSpecialties: number;

  // ── Sprint 9B.19 — service area ─────────────────────────────────────────

  /** The suggested service radius and the bounds the server enforces.
   *
   *  Served rather than computed in the client: "walking is 3 km" is a MARKET
   *  judgement an operator tunes per city, not a constant, and a client with
   *  its own numbers would offer a radius the server is about to refuse. */
  radiusPolicy: {
    suggestedKm: number;
    minKm: number;
    maxKm: number;
    /** The transport mode the suggestion came from, so the UI can say why.
     *  Null when the provider has not told us how they travel. */
    basedOn: ProviderTransportModeCode | null;
  };

  /** The provider's timezone, worked out from their country so they never
   *  have to choose one.
   *
   *  Distinct from `timezone` above, which is what the AVAILABILITY step has
   *  actually stored. This is the server's answer before anyone stores
   *  anything — and `display` is what the UI shows: a city and an offset a
   *  person can check against their own clock. The raw IANA identifier is
   *  carried for that step to STORE, not for anyone to read. */
  resolvedTimezone: {
    resolved: string | null;
    display: { city: string; offset: string } | null;
    /** True when the country spans several zones, or we have no mapping. The
     *  one case where the availability step must ask. */
    needsConfirmation: boolean;
  };
  /** Suggested from the primary specialty.
   *
   *  A SUGGESTION. Nothing has been published, and the provider has to accept
   *  it before anything is. Null when no primary is chosen yet.
   *
   *  BOTH languages, together — the same rule the category catalogue follows,
   *  so switching language does not need a refetch and an Arabic reader is
   *  never briefly offered an English trade name. */
  suggestedTitle: { en: string; ar: string } | null;

  yearsOfExperience: number | null;
  /** ISO date. An alternative to `yearsOfExperience`; the server derives one
   *  from the other so the stored fact does not silently age. */
  professionSince: string | null;
  equipmentCodes: string[];
  transportMode: ProviderTransportModeCode | null;
  /** Every mode the provider can use. `transportMode` above is the PRIMARY and
   *  is always one of these when set — the two are kept in step server-side
   *  rather than by asking each client to remember. */
  transportModes: ProviderTransportModeCode[];

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
