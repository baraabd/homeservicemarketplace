import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PatchOnboardingStepDto } from '../dto/patch-onboarding-step.dto';

// Sprint 09B.29 Phase 5 — THE FAILING-BEFORE EVIDENCE for multi-country onboarding.
//
// docs/provider-experience-v2/PHASE5_BASELINE.md §5
//
// The product-owner decision of this phase requires the marketplace to be
// multi-country capable, with the country coming from a server-owned registry
// of ENABLED markets and never from an unverified client payload.
//
// This file is the proof that the system as it stands cannot do that. Every
// test here describes a hole, and every one of them PASSES today — which is
// exactly why they are written as assertions about the current behaviour with
// an explicit statement of what must replace it.
//
// They are kept after the repair rather than deleted: each one is inverted
// into the guarantee it was missing, so the file reads as a before/after record
// of the same set of properties.

describe('Phase 5 entry gap — the country a provider claims is not checked', () => {
  /**
   * Validate a step body and return only the errors about the COUNTRY field.
   *
   * Scoped deliberately. `version` is required on every step patch, so an
   * unscoped error list is never empty and an assertion over it would be about
   * the wrong field entirely — which is how a test like this passes while
   * proving nothing.
   */
  const countryErrors = (body: Record<string, unknown>) => {
    const dto = plainToInstance(PatchOnboardingStepDto, { version: 0, ...body });
    return validateSync(dto as object).filter((e) => e.property === 'serviceAreaCountryCode');
  };

  it('GAP: accepts a country code that does not exist', () => {
    // `ZZ` is not an assigned ISO 3166-1 alpha-2 code. The only validation is
    // `/^[A-Z]{2}$/`, so any two letters are a country as far as this API is
    // concerned — and the value is persisted verbatim onto the profile.
    expect(countryErrors({ serviceAreaCountryCode: 'ZZ' })).toHaveLength(0);
  });

  it('GAP: accepts a real country the operator has not enabled', () => {
    // Antarctica is a genuine ISO code, so even an ISO check would let it
    // through. Nothing in the system knows which markets the operator actually
    // serves, so there is no question it could ask.
    expect(countryErrors({ serviceAreaCountryCode: 'AQ' })).toHaveLength(0);
  });

  it('GAP: the client is the only source of the country', () => {
    // There is no server-side derivation at all: whatever the request body
    // says becomes the provider's market. The Phase 5 decision forbids exactly
    // this — a country must be confirmed against an enabled-market registry.
    const dto = plainToInstance(PatchOnboardingStepDto, {
      version: 0,
      serviceAreaCountryCode: 'zz',
    });

    expect(
      validateSync(dto as object).filter((e) => e.property === 'serviceAreaCountryCode'),
    ).toHaveLength(0);
    expect((dto as { serviceAreaCountryCode?: string }).serviceAreaCountryCode).toBe('ZZ');
  });
});
