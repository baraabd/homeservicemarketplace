import type {
  ProviderOnboardingData,
  ProviderOnboardingDraftView,
  ProviderOnboardingStep,
  ProviderOnboardingStepView,
} from '@homeservicemarketplace/contracts';

// Sprint 09B.29 — typed fixtures for the onboarding draft view.
//
// WHY THIS IS A NORMAL SOURCE FILE AND NOT A `.test.ts` HELPER
//
// `tsconfig.app.json` EXCLUDES `src/**/*.test.ts(x)`, so nothing typechecks the
// fixtures the onboarding tests build. That is how
// `ProviderOnboardingWizard.test.tsx` came to declare a value as
// `ProviderOnboardingDraftView` while omitting `serviceAreaCountryCode`,
// `specialties`, `primarySpecialtyId`, `maxSpecialties` and five more — a
// fixture that lies about the shape the component will actually receive, and a
// silent drift every time the contract grows.
//
// Living here puts the factory inside the app's own typecheck, so the COMPILER
// guarantees the object satisfies the contract. Nothing in the application
// imports it, so it is tree-shaken out of the bundle; only tests do.
//
// The repository-wide absence of a test typecheck remains open technical debt
// and is recorded in SPRINT_09B29_VERIFICATION.md. This file fixes the fixtures
// Phase 3 touches, not the 754 pre-existing type errors in test files.

const ALL_STEPS: readonly ProviderOnboardingStep[] = [
  'PROVIDER_TYPE',
  'IDENTITY',
  'LOCATION',
  'SPECIALTIES',
  'EXPERIENCE',
  'AVAILABILITY',
  'PROFILE',
  'CONSENT',
  'REVIEW',
];

/** Every field the data contract requires, with deterministic values. */
export function onboardingDataFixture(
  over: Partial<ProviderOnboardingData> = {},
): ProviderOnboardingData {
  return {
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    displayName: 'Ada Lovelace Services',
    profileImageUrl: null,
    phoneNumber: '+46701234567',
    phoneVerified: true,

    serviceAreaCity: 'Gothenburg',
    serviceAreaCountry: 'Sweden',
    serviceAreaCountryCode: 'SE',
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: 25,
    serviceAreaIds: [],
    workshopAddressLine: null,
    workshopLat: null,
    workshopLng: null,

    primaryGroupIds: ['grp-electrical'],
    specialtyLeafIds: ['leaf-rewiring'],
    pendingSpecialtyIds: [],
    specialties: [
      {
        categoryId: 'leaf-rewiring',
        state: 'APPROVED',
        labelEn: 'Rewiring',
        labelAr: 'إعادة تمديد الأسلاك',
        parentId: 'grp-electrical',
        decidedAt: '2026-08-20T00:00:00.000Z',
      },
    ],
    primarySpecialtyId: 'leaf-rewiring',
    maxSpecialties: 5,

    radiusPolicy: {
      suggestedKm: 15,
      minKm: 1,
      maxKm: 25,
      basedOn: 'CAR',
    },
    serviceAreaExpansion: {
      show: false,
      allowedMaxKm: 25,
      baseMaxKm: 25,
      currentTier: null,
      nextTier: null,
      progress: [],
      reasonCodes: [],
      policyVersion: null,
    },
    resolvedTimezone: {
      resolved: 'Europe/Stockholm',
      display: { city: 'Stockholm', offset: '+02:00' },
      needsConfirmation: false,
    },

    suggestedTitle: { en: 'Electrician', ar: 'كهربائي' },
    yearsOfExperience: 10,
    professionSince: null,
    equipmentCodes: [],
    transportMode: 'CAR',
    transportModes: ['CAR'],

    availability: [
      {
        id: 'ivl-1',
        dayOfWeek: 1,
        startMinute: 540,
        endMinute: 1020,
        timezone: 'Europe/Stockholm',
      },
    ],
    timezone: 'Europe/Stockholm',

    headline: 'Certified electrician, 10 years',
    bio: 'I handle residential and light commercial electrical work, including fault finding.',
    additionalInformation: null,

    acceptedConsentVersion: 'v3',
    consentAcceptedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

/** Every step complete, with no outstanding issue. */
export function completeStepsFixture(): ProviderOnboardingStepView[] {
  return ALL_STEPS.map((step) => ({ step, complete: true, issues: [] }));
}

/**
 * A draft with everything answered, so a test can break exactly one thing.
 *
 * `over` is `Partial` at the INPUT boundary only; the returned value satisfies
 * the complete contract, and the compiler checks that here rather than trusting
 * a cast at the call site.
 */
export function onboardingDraftFixture(
  over: Partial<ProviderOnboardingDraftView> = {},
): ProviderOnboardingDraftView {
  return {
    state: 'DRAFT',
    currentStep: 'REVIEW',
    steps: completeStepsFixture(),
    completedSteps: [...ALL_STEPS],
    percentComplete: 100,
    nextAction: { kind: 'SUBMIT' },

    // The two axes Sprint 09B.29 separated. Both default to empty: a fixture
    // that starts with an outstanding item makes every unrelated test pass or
    // fail for a reason it did not choose.
    complete: true,
    missing: [],
    awaitingReview: [],

    data: onboardingDataFixture(),

    version: 3,
    policyVersion: 'v3',
    lastSavedAt: '2026-08-24T10:00:00.000Z',
    editable: true,
    ...over,
  };
}

/**
 * The Phase 3 scenario: provider input finished, one specialty queued for
 * platform moderation.
 *
 * The shape the server produces — `complete` true, `missing` empty, the item on
 * `awaitingReview`, and the SPECIALTIES step complete but still carrying the
 * issue so a screen can show "with us" against it.
 */
export function pendingModerationDraftFixture(
  over: Partial<ProviderOnboardingDraftView> = {},
): ProviderOnboardingDraftView {
  const issue = { field: 'specialties', code: 'AWAITING_REVIEW' } as const;
  return onboardingDraftFixture({
    complete: true,
    missing: [],
    awaitingReview: [issue],
    steps: completeStepsFixture().map((s) =>
      s.step === 'SPECIALTIES' ? { ...s, complete: true, issues: [issue] } : s,
    ),
    data: onboardingDataFixture({
      specialtyLeafIds: [],
      pendingSpecialtyIds: ['leaf-rewiring'],
      specialties: [
        {
          categoryId: 'leaf-rewiring',
          state: 'PENDING',
          labelEn: 'Rewiring',
          labelAr: 'إعادة تمديد الأسلاك',
          parentId: 'grp-electrical',
          decidedAt: null,
        },
      ],
    }),
    ...over,
  });
}
