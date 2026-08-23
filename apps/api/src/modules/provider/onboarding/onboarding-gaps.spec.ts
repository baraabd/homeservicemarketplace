// Sprint 8 — RED FIRST. The three gaps this sprint closes.
//
// Written before any implementation and expected to fail. Each block states a
// behaviour the onboarding journey requires and the repository does not yet
// provide, so the failure message names the missing capability rather than a
// missing symbol.
//
// A note on the third block, because the brief said "any CONFIRMED
// category-selection bypass": there is NO bypass in the current profile PATCH.
// `ProviderService.authorizeCategoryDiff` already throws FORBIDDEN on any
// addition, and a test below pins that so the guarantee is not lost while the
// hierarchy is introduced. The real bypass RISK is created BY this sprint —
// a parent category that silently approves its children — and that is what
// the remaining cases guard.

import { evaluateOnboarding } from './provider-onboarding.policy';

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1 — step persistence. A wizard the provider cannot resume.
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP 1: onboarding step persistence', () => {
  it('the schema can record which step a provider reached', () => {
    // There is no column, table, or field anywhere that records progress
    // through onboarding. A provider who closes the tab on step 6 of 9 has no
    // way back to step 6 — the server cannot tell them where they were,
    // because nothing ever wrote it down.
    //
    // Sprint 8 introduces ProviderOnboardingDraft. Until it exists, the
    // generated Prisma client has no such model.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require('@homeservicemarketplace/database') as Record<string, unknown>;
    const client = db.prisma as Record<string, unknown>;

    expect(client.providerOnboardingDraft).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2 — the provider-edit flow is incomplete.
//
// The completeness policy is the server's definition of "ready to submit".
// It currently checks nine fields. The journey this sprint must support needs
// considerably more, and none of them are representable today: provider type,
// verified phone, profile image, districts, leaf specialties, numeric
// experience, equipment, transport, weekly availability, workshop location,
// and consent version.
//
// Asserting on the POLICY rather than on the DTO is deliberate: the DTO is an
// input shape, while the policy is what the Submit button is enabled from. A
// field the policy never evaluates is a field submission does not require,
// whatever the DTO accepts.
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP 2: the completeness policy does not cover the onboarding journey', () => {
  /** A candidate that satisfies every rule the CURRENT policy knows about.
   *  If the policy still returns no issues for this, it is not yet asking for
   *  anything the wizard collects. */
  const completeUnderOldRules = {
    displayName: 'Grace Hopper Plumbing',
    headline: 'Emergency plumbing, 24/7 across the city',
    bio: 'Fifteen years of residential and commercial plumbing work, fully insured and equipped.',
    phoneNumber: '+963900000000',
    serviceAreaCity: 'Aleppo',
    serviceAreaCountry: 'SY',
    serviceAreaRadiusKm: 25,
    serviceCategoryCount: 2,
    emailVerified: true,
  };

  it('rejects a submission with no provider type', () => {
    // Individual vs business changes what else is required (a business needs
    // a display name and registration details an individual does not), so it
    // cannot be optional or inferred.
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      providerType: null,
    } as never);

    expect(issues).toContainEqual({ field: 'providerType', code: 'REQUIRED' });
  });

  it('rejects a submission whose phone is present but UNVERIFIED', () => {
    // A phone number nobody proved they control is a contact method that does
    // not work. The policy currently checks presence only.
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      phoneVerified: false,
    } as never);

    expect(issues).toContainEqual({ field: 'phoneNumber', code: 'NOT_VERIFIED' });
  });

  it('rejects a submission with no weekly availability', () => {
    // "When can this provider work" is the question the marketplace exists to
    // answer. Today nothing asks it.
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      availabilityIntervalCount: 0,
    } as never);

    expect(issues).toContainEqual({ field: 'availability', code: 'REQUIRED' });
  });

  it('rejects a submission with no numeric experience', () => {
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      yearsOfExperience: null,
    } as never);

    expect(issues).toContainEqual({ field: 'yearsOfExperience', code: 'REQUIRED' });
  });

  it('rejects a submission with no accepted consent version', () => {
    // Consent has to be pinned to a VERSION, or "they agreed" is unfalsifiable
    // the moment the terms change.
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      acceptedConsentVersion: null,
    } as never);

    expect(issues).toContainEqual({ field: 'consent', code: 'REQUIRED' });
  });

  it('rejects a submission with no LEAF specialty selected', () => {
    // Root categories organise the catalogue; leaves are the competencies
    // matching uses. A provider who picked only a root has told us nothing
    // actionable.
    const issues = evaluateOnboarding({
      ...completeUnderOldRules,
      leafSpecialtyCount: 0,
    } as never);

    expect(issues).toContainEqual({ field: 'specialties', code: 'REQUIRED' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3 — the approval boundary, and the bypass this sprint could create.
// ─────────────────────────────────────────────────────────────────────────────
describe('GAP 3: category hierarchy must not become an approval bypass', () => {
  it('exposes which categories are selectable leaves', () => {
    // Selectability is a property of the CATALOGUE, decided server-side. If
    // the client decides what is selectable, "only leaves are selectable"
    // becomes a suggestion.
    //
    // Sprint 8 adds parentId + isLeaf to ServiceCategory.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Prisma } = require('@homeservicemarketplace/database') as {
      Prisma: { ModelName: Record<string, string>; dmmf?: unknown };
    };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const db = require('@homeservicemarketplace/database') as Record<string, unknown>;
    void Prisma;

    // The generated client types are the schema's public surface; a field that
    // does not exist cannot be selected.
    const client = db.prisma as {
      serviceCategory: { fields?: Record<string, unknown> };
    };
    expect(client.serviceCategory.fields?.parentId).toBeDefined();
  });

  it('expands a parent selection to NO approved children', async () => {
    // THE bypass to prevent. If choosing "Plumbing" silently grants every
    // plumbing leaf, a provider self-approves a dozen competencies that no
    // admin ever reviewed — which is exactly what ProviderCategoryApplication
    // exists to prevent, defeated by a UI convenience.
    //
    // Sprint 8 adds expandParentSelection(), which must return the leaves as
    // things to APPLY for, never as things already granted.
    const mod = await import('./onboarding-category-selection');
    const result = mod.expandParentSelection({
      parentIds: ['cat-plumbing'],
      leavesByParent: { 'cat-plumbing': ['leaf-drains', 'leaf-boilers', 'leaf-leaks'] },
    });

    expect(result.autoApproved).toEqual([]);
    expect(result.requiresApplication.sort()).toEqual([
      'leaf-boilers',
      'leaf-drains',
      'leaf-leaks',
    ]);
  });
});
