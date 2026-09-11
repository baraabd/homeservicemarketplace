import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { PatchOnboardingStepDto } from '../dto/patch-onboarding-step.dto';

// Sprint 09B.29 Phase 5 (C2) — the country trust boundary, before and after.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.7
//
// WHAT THIS FILE WAS, AND WHY IT CHANGED SHAPE
//
// It began as failing-before evidence: three assertions that the API ACCEPTED
// `ZZ`, accepted `AQ`, and took the country entirely from the request body.
// All three passed, which is what made them evidence — the holes were real.
//
// Two of the three are now closed at this layer, so the assertions are
// inverted into the guarantees that replaced them. The third is deliberately
// still recorded as open HERE, because a DTO cannot close it: "is this a market
// the operator enabled" is a question about a row, and the answer lives in
// `MarketRegistryService`. It is closed one layer up, and the spec beside this
// one proves it.
//
// KEEPING THE OLD CASES VISIBLE IS THE POINT. A reviewer can read the two
// layers of the boundary and see which one catches what, rather than finding a
// single opaque "country is validated" test.
//
// SENSITIVITY. Inverting an expectation after changing production code proves
// nothing on its own, so `market-entry-gap.sensitivity.spec.ts` reconstructs
// the OLD `/^[A-Z]{2}$/` rule and asserts that it would fail every guarantee
// below.

describe('C2 layer 1 — the DTO rejects what is not a country', () => {
  /**
   * Validate a step body and return only the errors about the COUNTRY field.
   *
   * Scoped deliberately: `version` is required on every step patch, so an
   * unscoped error list is never empty and an assertion over it would be about
   * the wrong field entirely — which is how a test like this passes while
   * proving nothing.
   */
  const countryErrors = (body: Record<string, unknown>) => {
    const dto = plainToInstance(PatchOnboardingStepDto, { version: 0, ...body });
    return validateSync(dto as object).filter((e) => e.property === 'serviceAreaCountryCode');
  };

  const parsed = (body: Record<string, unknown>) =>
    plainToInstance(PatchOnboardingStepDto, { version: 0, ...body }) as {
      serviceAreaCountryCode?: string | null;
    };

  it('CLOSED: a code that is not an assigned country is refused', () => {
    // Was the first gap. `ZZ`, `XX` and `QQ` are unassigned; under the old
    // `/^[A-Z]{2}$/` every one of them was a country as far as this API was
    // concerned, and the value was persisted verbatim onto the profile.
    for (const code of ['ZZ', 'XX', 'QQ']) {
      expect(countryErrors({ serviceAreaCountryCode: code })).toHaveLength(1);
    }
  });

  it('CLOSED: the refusal names the contract rather than a regex', () => {
    const [error] = countryErrors({ serviceAreaCountryCode: 'ZZ' });

    expect(Object.values(error.constraints ?? {}).join(' ')).toContain('ISO 3166-1 alpha-2');
  });

  it('accepts the three seeded markets, and canonicalises their spelling', () => {
    // Uppercase is the canonical stored form, and the `@Transform` runs before
    // validation — so a client sending `sy` stores `SY` rather than being
    // refused for a spelling the server is happy to normalise.
    for (const [sent, stored] of [
      ['SY', 'SY'],
      ['se', 'SE'],
      [' sa ', 'SA'],
    ]) {
      expect(countryErrors({ serviceAreaCountryCode: sent })).toHaveLength(0);
      expect(parsed({ serviceAreaCountryCode: sent }).serviceAreaCountryCode).toBe(stored);
    }
  });

  it('STILL OPEN AT THIS LAYER: a real country the operator never enabled', () => {
    // Antarctica is a genuine ISO code, so the DTO cannot refuse it and must
    // not try: a decorator that knew the enabled markets would be a hard-coded
    // copy of operator configuration inside a client-shaped artefact.
    //
    // This is closed in `MarketRegistryService`, at the authoritative mutation
    // boundary, and proved in the wizard service spec. Recorded here so the
    // division of labour between the two layers is visible.
    expect(countryErrors({ serviceAreaCountryCode: 'AQ' })).toHaveLength(0);
  });
});
