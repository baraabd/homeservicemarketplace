import { describe, expect, it } from 'vitest';

import {
  completeStepsFixture,
  onboardingDataFixture,
  onboardingDraftFixture,
  pendingModerationDraftFixture,
} from './provider-onboarding-fixtures';

// Sprint 09B.29 — the fixtures are load-bearing, so they are pinned.
//
// A fixture that drifts from the contract makes every test that uses it prove
// something about a shape the component never receives. The compiler checks the
// TYPES because this factory lives in a typechecked file; these assertions check
// the VALUES that the onboarding tests actually depend on.

describe('onboardingDraftFixture', () => {
  it('is provider-complete with both issue axes empty', () => {
    const v = onboardingDraftFixture();
    expect(v.complete).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.awaitingReview).toEqual([]);
  });

  it('carries every step, all complete, with no issues', () => {
    const v = onboardingDraftFixture();
    expect(v.steps).toHaveLength(9);
    expect(v.steps.every((s) => s.complete)).toBe(true);
    expect(v.steps.flatMap((s) => s.issues)).toEqual([]);
    expect(v.completedSteps).toHaveLength(9);
  });

  it('carries a concurrency token and a policy version', () => {
    const v = onboardingDraftFixture();
    expect(v.version).toBe(3);
    expect(v.policyVersion).toBe('v3');
  });

  it('carries a fully populated data object', () => {
    const d = onboardingDraftFixture().data;
    // The fields the old inline fixture omitted, which is why this exists.
    expect(d.serviceAreaCountryCode).toBe('SE');
    expect(d.specialties).toHaveLength(1);
    expect(d.primarySpecialtyId).toBe('leaf-rewiring');
    expect(d.maxSpecialties).toBe(5);
    expect(d.radiusPolicy.suggestedKm).toBe(15);
    expect(d.serviceAreaExpansion.show).toBe(false);
    expect(d.resolvedTimezone.resolved).toBe('Europe/Stockholm');
    expect(d.suggestedTitle).toEqual({ en: 'Electrician', ar: 'كهربائي' });
    expect(d.transportModes).toEqual(['CAR']);
  });

  it('applies overrides at the top level without losing required fields', () => {
    const v = onboardingDraftFixture({
      complete: false,
      missing: [{ field: 'bio', code: 'REQUIRED' }],
    });
    expect(v.complete).toBe(false);
    expect(v.missing).toEqual([{ field: 'bio', code: 'REQUIRED' }]);
    expect(v.awaitingReview).toEqual([]);
    expect(v.data.serviceAreaCountryCode).toBe('SE');
  });
});

describe('pendingModerationDraftFixture — the Phase 3 scenario', () => {
  it('reports provider input complete with the moderation item on its own axis', () => {
    const v = pendingModerationDraftFixture();
    expect(v.complete).toBe(true);
    expect(v.missing).toEqual([]);
    expect(v.awaitingReview).toEqual([{ field: 'specialties', code: 'AWAITING_REVIEW' }]);
  });

  it('keeps the SPECIALTIES step complete while still carrying the issue', () => {
    // Both halves matter: complete, so the provider is not sent back to it; and
    // still carrying the issue, so the screen can show "with us" against it.
    const step = pendingModerationDraftFixture().steps.find((s) => s.step === 'SPECIALTIES');
    expect(step?.complete).toBe(true);
    expect(step?.issues).toEqual([{ field: 'specialties', code: 'AWAITING_REVIEW' }]);
  });

  it('models the specialty as PENDING and undecided in the data', () => {
    const d = pendingModerationDraftFixture().data;
    expect(d.specialtyLeafIds).toEqual([]);
    expect(d.pendingSpecialtyIds).toEqual(['leaf-rewiring']);
    expect(d.specialties[0].state).toBe('PENDING');
    expect(d.specialties[0].decidedAt).toBeNull();
  });
});

describe('onboardingDataFixture / completeStepsFixture', () => {
  it('accepts partial overrides', () => {
    expect(onboardingDataFixture({ bio: null }).bio).toBeNull();
    expect(onboardingDataFixture({ bio: null }).headline).toBe('Certified electrician, 10 years');
  });

  it('produces nine complete steps', () => {
    expect(completeStepsFixture()).toHaveLength(9);
    expect(completeStepsFixture().every((s) => s.complete && s.issues.length === 0)).toBe(true);
  });
});
