import 'reflect-metadata';

import { Transform } from 'class-transformer';
import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, Matches, validateSync } from 'class-validator';

// Sprint 09B.29 Phase 5 (C2) — sensitivity proof for the country guarantees.
//
// docs/provider-experience-v2/PHASE5_VERIFICATION.md §1.7
//
// WHY THIS FILE EXISTS
//
// `market-entry-gap.spec.ts` used to assert that the API accepted `ZZ`. It now
// asserts the opposite. Inverting an expectation AFTER changing production
// code is not evidence of anything — the test would have been rewritten to
// match whatever the code did, including the wrong thing.
//
// So the old rule is reconstructed here, exactly as it was
// (`@Matches(/^[A-Z]{2}$/)` behind the same uppercase `@Transform`), and the
// guarantees are run against it. Every one must FAIL, which is what makes the
// converted spec meaningful: it is checking something the previous
// implementation genuinely could not do.
//
// This is a frozen historical artefact. It does not import the real DTO and it
// must not be updated to track it — the moment it does, it stops describing
// the thing it exists to describe.

/** The country field exactly as it was before this phase. */
class LegacyCountryDto {
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null,
  )
  @IsString()
  @Matches(/^[A-Z]{2}$/, {
    message: 'serviceAreaCountryCode must be a two-letter ISO country code',
  })
  serviceAreaCountryCode?: string | null;
}

const legacyErrors = (code: unknown) =>
  validateSync(
    plainToInstance(LegacyCountryDto, { serviceAreaCountryCode: code }) as object,
  ).filter((e) => e.property === 'serviceAreaCountryCode');

describe('the OLD rule fails every guarantee the new one provides', () => {
  it('would have accepted codes that are not countries', () => {
    // The exact assertion `market-entry-gap.spec.ts` now makes in reverse. If
    // this ever passes, the two specs have converged and the conversion has
    // stopped proving anything.
    for (const code of ['ZZ', 'XX', 'QQ']) {
      expect(legacyErrors(code)).toHaveLength(0);
    }
  });

  it('would have produced a refusal message about a shape, not a standard', () => {
    // The old message named "a two-letter ISO country code", which describes
    // the regex rather than the register — and was true of `ZZ`.
    const [error] = legacyErrors('123');

    expect(Object.values(error.constraints ?? {}).join(' ')).not.toContain('ISO 3166-1 alpha-2');
  });

  it('agreed with the new rule only on the cases that were never in doubt', () => {
    // Both rules accept the seeded markets and reject obvious junk. That
    // overlap is why the regex survived so long: it looks right until it is
    // asked about a code that merely LOOKS like a country.
    for (const code of ['SY', 'SE', 'SA']) expect(legacyErrors(code)).toHaveLength(0);
    for (const code of ['S', 'SYR', '12']) expect(legacyErrors(code).length).toBeGreaterThan(0);
  });
});
