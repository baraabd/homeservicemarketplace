import {
  RequirementResolutionError,
  missingRequirements,
  resolveRequirements,
  type CandidatePolicy,
} from './requirement-resolver';

// Sprint 9B — requirement resolution. docs/adr/0010
//
// Country x provider type x category, versioned. The rules are DATA, so these
// tests use fixture policies and assert nothing about production law — the
// repository deliberately ships no real country rules.

const AT = new Date('2026-08-24T12:00:00Z');
const PUBLISHED = new Date('2026-01-01T00:00:00Z');

function policy(over: Partial<CandidatePolicy> = {}): CandidatePolicy {
  return {
    version: 'test-global-v1',
    country: null,
    providerType: null,
    categoryId: null,
    requirements: { documents: ['INDIVIDUAL_IDENTITY'], verificationRequired: true },
    publishedAt: PUBLISHED,
    retiredAt: null,
    ...over,
  };
}

describe('resolveRequirements — specificity', () => {
  it('falls back to the global default when nothing more specific exists', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [policy()],
      at: AT,
    });
    expect(r.policyVersion).toBe('test-global-v1');
  });

  it('prefers country over the global default', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [policy(), policy({ version: 'sy-v1', country: 'SY' })],
      at: AT,
    });
    expect(r.policyVersion).toBe('sy-v1');
  });

  it('prefers country+type over country alone', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'BUSINESS',
      categoryIds: [],
      policies: [
        policy(),
        policy({ version: 'sy-v1', country: 'SY' }),
        policy({
          version: 'sy-business-v1',
          country: 'SY',
          providerType: 'BUSINESS',
          requirements: {
            documents: ['BUSINESS_REGISTRATION', 'AUTHORIZED_REPRESENTATIVE_IDENTITY'],
            verificationRequired: true,
          },
        }),
      ],
      at: AT,
    });

    expect(r.policyVersion).toBe('sy-business-v1');
    expect(r.requirements.map((x) => x.kind)).toEqual([
      'BUSINESS_REGISTRATION',
      'AUTHORIZED_REPRESENTATIVE_IDENTITY',
    ]);
  });

  it('ignores a policy for a DIFFERENT country', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [policy(), policy({ version: 'ae-v1', country: 'AE' })],
      at: AT,
    });
    expect(r.policyVersion).toBe('test-global-v1');
  });

  it('distinguishes a business representative from an individual identity', () => {
    // For a business the SUBJECT of verification is the company. "Is this human
    // allowed to speak for it?" is a separate question, and it is the one that
    // matters for fraud — so the two kinds must not be interchangeable.
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'BUSINESS',
      categoryIds: [],
      policies: [
        policy({
          version: 'biz',
          providerType: 'BUSINESS',
          requirements: {
            documents: ['BUSINESS_REGISTRATION', 'AUTHORIZED_REPRESENTATIVE_IDENTITY'],
            verificationRequired: true,
          },
        }),
      ],
      at: AT,
    });
    const kinds = r.requirements.map((x) => x.kind);
    expect(kinds).toContain('AUTHORIZED_REPRESENTATIVE_IDENTITY');
    expect(kinds).not.toContain('INDIVIDUAL_IDENTITY');
  });
});

describe('resolveRequirements — category licences union', () => {
  const licence = (categoryId: string, version: string) =>
    policy({
      version,
      categoryId,
      requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
    });

  it('adds a licence per licensed category', () => {
    // Holding an electrician's licence says nothing about gas, so category
    // requirements UNION rather than replace.
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: ['cat-elec', 'cat-gas'],
      policies: [policy(), licence('cat-elec', 'elec-v1'), licence('cat-gas', 'gas-v1')],
      at: AT,
    });

    const licences = r.requirements.filter((x) => x.kind === 'CATEGORY_LICENSE');
    expect(licences.map((l) => l.serviceCategoryId).sort()).toEqual(['cat-elec', 'cat-gas']);
    // The base policy still contributes its own requirement.
    expect(r.requirements.some((x) => x.kind === 'INDIVIDUAL_IDENTITY')).toBe(true);
    // And the stamped version is the BASE one — category rows add, they do not
    // redefine the base.
    expect(r.policyVersion).toBe('test-global-v1');
  });

  it('adds nothing for an unlicensed category', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: ['cat-furniture'],
      policies: [policy(), licence('cat-elec', 'elec-v1')],
      at: AT,
    });
    expect(r.requirements.filter((x) => x.kind === 'CATEGORY_LICENSE')).toHaveLength(0);
  });

  it('does not duplicate a licence named by two policies', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: ['cat-elec'],
      policies: [policy(), licence('cat-elec', 'elec-v1'), licence('cat-elec', 'elec-v2')],
      at: AT,
    });
    expect(r.requirements.filter((x) => x.kind === 'CATEGORY_LICENSE')).toHaveLength(1);
  });
});

describe('resolveRequirements — versioning in time', () => {
  it('ignores a policy published AFTER the resolution instant', () => {
    // The guarantee the whole ADR exists for: a rule published on Tuesday must
    // not retroactively fail Monday's applicant.
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [
        policy(),
        policy({
          version: 'sy-future',
          country: 'SY',
          publishedAt: new Date('2026-12-01T00:00:00Z'),
        }),
      ],
      at: AT,
    });
    expect(r.policyVersion).toBe('test-global-v1');
  });

  it('ignores a policy already retired', () => {
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [
        policy(),
        policy({
          version: 'sy-old',
          country: 'SY',
          retiredAt: new Date('2026-02-01T00:00:00Z'),
        }),
      ],
      at: AT,
    });
    expect(r.policyVersion).toBe('test-global-v1');
  });

  it('replays a historic instant under the policy in force THEN', () => {
    const historic = new Date('2026-01-15T00:00:00Z');
    const policies = [
      policy(),
      policy({ version: 'sy-old', country: 'SY', retiredAt: new Date('2026-02-01T00:00:00Z') }),
      policy({ version: 'sy-new', country: 'SY', publishedAt: new Date('2026-02-01T00:00:00Z') }),
    ];

    expect(
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies,
        at: historic,
      }).policyVersion,
    ).toBe('sy-old');

    expect(
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies,
        at: AT,
      }).policyVersion,
    ).toBe('sy-new');
  });
});

describe('resolveRequirements — failing closed', () => {
  it('THROWS when no policy is in force', () => {
    // The most dangerous silent success available here. Returning an empty set
    // would read downstream as "verified with no evidence required".
    expect(() =>
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies: [],
        at: AT,
      }),
    ).toThrow(RequirementResolutionError);

    try {
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies: [],
        at: AT,
      });
    } catch (e) {
      expect((e as RequirementResolutionError).code).toBe('NO_POLICY_IN_FORCE');
    }
  });

  it('THROWS on two policies of equal specificity', () => {
    // A publication error. Picking one would make the requirement set depend
    // on row order — not a rule anyone could review.
    expect(() =>
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies: [
          policy({ version: 'a', country: 'SY' }),
          policy({ version: 'b', country: 'SY' }),
        ],
        at: AT,
      }),
    ).toThrow(/Ambiguous/);
  });

  it('THROWS on a policy with no document list', () => {
    expect(() =>
      resolveRequirements({
        country: 'SY',
        providerType: 'INDIVIDUAL',
        categoryIds: [],
        policies: [policy({ requirements: { verificationRequired: true } as never })],
        at: AT,
      }),
    ).toThrow(/no document list/);
  });

  it('carries verificationRequired=false through explicitly', () => {
    // Distinct from "no documents configured yet". Only one of those is safe to
    // treat as "rank 6 must not deny", so it is an explicit field.
    const r = resolveRequirements({
      country: 'SY',
      providerType: 'INDIVIDUAL',
      categoryIds: [],
      policies: [policy({ requirements: { documents: [], verificationRequired: false } })],
      at: AT,
    });
    expect(r.verificationRequired).toBe(false);
    expect(r.requirements).toEqual([]);
  });
});

describe('missingRequirements', () => {
  const resolved = resolveRequirements({
    country: 'SY',
    providerType: 'INDIVIDUAL',
    categoryIds: ['cat-elec'],
    policies: [
      policy(),
      policy({
        version: 'elec-v1',
        categoryId: 'cat-elec',
        requirements: { documents: ['CATEGORY_LICENSE'], verificationRequired: true },
      }),
    ],
    at: AT,
  });

  it('reports everything outstanding when nothing is held', () => {
    expect(missingRequirements(resolved, [])).toHaveLength(2);
  });

  it('clears a requirement satisfied by a held document', () => {
    const missing = missingRequirements(resolved, [
      { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
    ]);
    expect(missing.map((m) => m.kind)).toEqual(['CATEGORY_LICENSE']);
  });

  it('does NOT let a licence for one category satisfy another', () => {
    // The cell that matters: a gas licence must not clear the electrical
    // requirement just because both are CATEGORY_LICENSE.
    const missing = missingRequirements(resolved, [
      { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
      { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-gas' },
    ]);
    expect(missing).toHaveLength(1);
    expect(missing[0].serviceCategoryId).toBe('cat-elec');
  });

  it('reports nothing once everything is held', () => {
    expect(
      missingRequirements(resolved, [
        { kind: 'INDIVIDUAL_IDENTITY', serviceCategoryId: null },
        { kind: 'CATEGORY_LICENSE', serviceCategoryId: 'cat-elec' },
      ]),
    ).toEqual([]);
  });
});
