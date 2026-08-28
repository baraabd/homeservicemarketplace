import {
  DISCLOSED_CRITERIA,
  ExpansionPayloadError,
  MAX_TIERS,
  criteriaKeys,
  parseExpansionLadder,
  type ExpansionPayloadErrorCode,
  type ExpansionPayloadScope,
} from './expansion-policy-payload';

// Sprint 9B.20 — what an operator is allowed to publish.
//
// The load-bearing test in this file is RATING_ONLY. Every other rule here
// protects a provider from a mistake; that one protects them from a policy
// that would be defensible-looking and unfair.

const SCOPE: ExpansionPayloadScope = { absoluteMaxKm: 250, baseMaxKm: 100 };

/** A tier that passes every rule, so a test can change exactly one thing. */
function validTier(over: Record<string, unknown> = {}) {
  return {
    key: 'established',
    maxKm: 150,
    criteria: { requireVerified: true, minCompletedJobs: 10 },
    ...over,
  };
}

function expectRefusal(input: unknown, code: ExpansionPayloadErrorCode, scope = SCOPE): void {
  try {
    parseExpansionLadder(input, scope);
  } catch (err) {
    expect(err).toBeInstanceOf(ExpansionPayloadError);
    expect({ code: (err as ExpansionPayloadError).code, forInput: input }).toEqual({
      code,
      forInput: input,
    });
    return;
  }
  throw new Error(`Expected ${code}, but the ladder was accepted.`);
}

describe('parseExpansionLadder', () => {
  it('accepts a ladder and returns it sorted by ceiling ascending', () => {
    const tiers = parseExpansionLadder(
      {
        tiers: [
          { key: 'wide', maxKm: 200, criteria: { requireVerified: true, minCompletedJobs: 40 } },
          validTier(),
        ],
      },
      SCOPE,
    );
    expect(tiers.map((t) => t.key)).toEqual(['established', 'wide']);
  });

  it('drops unknown keys rather than rejecting or storing them', () => {
    const tiers = parseExpansionLadder(
      { tiers: [{ ...validTier(), criteria: { minCompletedJobs: 10, minKarma: 9 } }] },
      SCOPE,
    );
    expect(tiers[0]!.criteria).toEqual({ minCompletedJobs: 10 });
  });

  // ── The guarantee ────────────────────────────────────────────────────────

  it('refuses a tier decided by rating alone', () => {
    expectRefusal(
      { tiers: [validTier({ criteria: { minRatingAvg: 4.5, minReviewCount: 20 } })] },
      'RATING_ONLY',
    );
  });

  it('refuses a tier gated on rating average only, even with no sample rule', () => {
    // Would otherwise fail RATING_WITHOUT_SAMPLE; RATING_ONLY is checked first
    // because it is the stronger objection.
    expectRefusal({ tiers: [validTier({ criteria: { minRatingAvg: 5 } })] }, 'RATING_ONLY');
  });

  it('accepts rating as ONE signal beside a conduct or work signal', () => {
    const tiers = parseExpansionLadder(
      {
        tiers: [
          validTier({
            criteria: { minCompletedJobs: 10, minRatingAvg: 4.5, minReviewCount: 20 },
          }),
        ],
      },
      SCOPE,
    );
    expect(criteriaKeys(tiers[0]!.criteria)).toEqual(['COMPLETED_JOBS', 'RATING', 'RATING_SAMPLE']);
  });

  // ── Cold start and sample floors ─────────────────────────────────────────

  it('refuses a rating threshold with no minimum sample', () => {
    expectRefusal(
      { tiers: [validTier({ criteria: { minCompletedJobs: 10, minRatingAvg: 4.5 } })] },
      'RATING_WITHOUT_SAMPLE',
    );
  });

  it('refuses a cancellation ceiling with no minimum booking count', () => {
    expectRefusal(
      { tiers: [validTier({ criteria: { minCompletedJobs: 10, maxCancellationRatePct: 10 } })] },
      'RATE_WITHOUT_SAMPLE',
    );
  });

  it('refuses a response-time ceiling with no minimum response count', () => {
    expectRefusal(
      {
        tiers: [validTier({ criteria: { minCompletedJobs: 10, maxMedianResponseMinutes: 90 } })],
      },
      'RATE_WITHOUT_SAMPLE',
    );
  });

  // ── Ladders that would misbehave ─────────────────────────────────────────

  it('refuses an empty ladder', () => {
    expectRefusal({ tiers: [] }, 'EMPTY_LADDER');
  });

  it('refuses more tiers than anyone would read', () => {
    const tiers = Array.from({ length: MAX_TIERS + 1 }, (_, i) => ({
      key: `t${i}`,
      maxKm: 101 + i,
      criteria: { requireVerified: true, minCompletedJobs: i + 1 },
    }));
    expectRefusal({ tiers }, 'TOO_MANY_TIERS');
  });

  it('refuses a duplicated tier key', () => {
    expectRefusal(
      { tiers: [validTier(), validTier({ maxKm: 180, criteria: { minCompletedJobs: 40 } })] },
      'DUPLICATE_TIER_KEY',
    );
  });

  it('refuses two tiers granting the same ceiling', () => {
    expectRefusal(
      {
        tiers: [
          validTier(),
          validTier({ key: 'other', criteria: { requireVerified: true, minCompletedJobs: 40 } }),
        ],
      },
      'DUPLICATE_TIER_MAX',
    );
  });

  it('refuses a tier that asks for nothing', () => {
    expectRefusal({ tiers: [validTier({ criteria: {} })] }, 'NO_CRITERIA');
  });

  it('refuses a tier that grants no more than every provider already has', () => {
    expectRefusal({ tiers: [validTier({ maxKm: SCOPE.baseMaxKm })] }, 'GRANTS_NOTHING');
  });

  it('refuses a tier above the configured expansion ceiling', () => {
    expectRefusal({ tiers: [validTier({ maxKm: SCOPE.absoluteMaxKm + 1 })] }, 'ABOVE_CEILING');
  });

  it('refuses a ladder that gets easier as it goes up', () => {
    expectRefusal(
      {
        tiers: [
          validTier({ key: 'one', maxKm: 150, criteria: { minCompletedJobs: 40 } }),
          validTier({ key: 'two', maxKm: 200, criteria: { minCompletedJobs: 5 } }),
        ],
      },
      'NON_MONOTONIC',
    );
  });

  it('refuses a higher tier that drops a gate the lower one required', () => {
    expectRefusal(
      {
        tiers: [
          validTier({ key: 'one', maxKm: 150, criteria: { requireVerified: true } }),
          validTier({ key: 'two', maxKm: 200, criteria: { minCompletedJobs: 40 } }),
        ],
      },
      'NON_MONOTONIC',
    );
  });

  it('refuses a higher tier that loosens an anti-abuse ceiling', () => {
    expectRefusal(
      {
        tiers: [
          validTier({
            key: 'one',
            maxKm: 150,
            criteria: { minCompletedJobs: 10, maxOpenComplaints: 0 },
          }),
          validTier({
            key: 'two',
            maxKm: 200,
            criteria: { minCompletedJobs: 40, maxOpenComplaints: 3 },
          }),
        ],
      },
      'NON_MONOTONIC',
    );
  });

  it('refuses malformed input rather than coercing it', () => {
    expectRefusal({ tiers: [{ key: 'Bad Key', maxKm: 150, criteria: {} }] }, 'MALFORMED');
    expectRefusal({ tiers: [{ key: 'ok', maxKm: 150.5, criteria: {} }] }, 'MALFORMED');
    expectRefusal({ tiers: [validTier({ criteria: { minRatingAvg: 4.55 } })] }, 'MALFORMED');
    expectRefusal({ nope: true }, 'MALFORMED');
  });
});

describe('DISCLOSED_CRITERIA', () => {
  // Withholding these is the "do not expose internal anti-abuse thresholds"
  // rule. Asserted here rather than only where it is applied, so widening the
  // set is a deliberate edit to a test that says why.
  it('never discloses the anti-abuse thresholds', () => {
    expect([...DISCLOSED_CRITERIA].sort()).toEqual([
      'AVAILABILITY',
      'COMPLETED_JOBS',
      'RATING',
      'RATING_SAMPLE',
      'VERIFICATION',
    ]);
    for (const key of ['CANCELLATION_RATE', 'COMPLAINTS', 'RESPONSE_TIME'] as const) {
      expect({ key, disclosed: DISCLOSED_CRITERIA.has(key) }).toEqual({ key, disclosed: false });
    }
  });
});

describe('criteriaKeys', () => {
  it('is stable in order regardless of how the object was written', () => {
    const a = criteriaKeys({ minCompletedJobs: 1, requireVerified: true });
    const b = criteriaKeys({ requireVerified: true, minCompletedJobs: 1 });
    expect(a).toEqual(b);
    expect(a).toEqual(['VERIFICATION', 'COMPLETED_JOBS']);
  });

  it('ignores a gate that is present but false', () => {
    expect(criteriaKeys({ requireVerified: false, minCompletedJobs: 1 })).toEqual([
      'COMPLETED_JOBS',
    ]);
  });
});
