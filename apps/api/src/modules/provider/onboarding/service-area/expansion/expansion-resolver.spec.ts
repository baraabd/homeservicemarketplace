import { parseExpansionLadder, type ExpansionTier } from './expansion-policy-payload';
import {
  resolveServiceAreaExpansion,
  type ExpansionDecision,
  type ExpansionResolverInput,
} from './expansion-resolver';
import { NEW_PROVIDER_SIGNALS, type ExpansionSignals } from './expansion-signals';

// Sprint 9B.20 — the eligibility decision, end to end and without a database.
//
// Every scenario the brief named has a describe block below, and each of them
// is a question someone will eventually ask about a real provider: why did
// this person not get it, why did that person, and what happened when the
// rules changed underneath them.

const NOW = new Date('2026-08-28T12:00:00.000Z');

const LADDER: ExpansionTier[] = parseExpansionLadder(
  {
    tiers: [
      {
        key: 'established',
        maxKm: 150,
        criteria: {
          requireVerified: true,
          minCompletedJobs: 10,
          maxOpenComplaints: 0,
          maxCancellationRatePct: 20,
          minTerminalBookings: 10,
        },
      },
      {
        key: 'wide',
        maxKm: 200,
        criteria: {
          requireVerified: true,
          minCompletedJobs: 40,
          minRatingAvg: 4.5,
          minReviewCount: 20,
          maxOpenComplaints: 0,
          maxCancellationRatePct: 10,
          minTerminalBookings: 20,
        },
      },
    ],
  },
  { absoluteMaxKm: 250, baseMaxKm: 100 },
);

function signals(over: Partial<ExpansionSignals> = {}): ExpansionSignals {
  return { ...NEW_PROVIDER_SIGNALS, ...over };
}

/** A provider who clears every criterion of both tiers. */
function exemplary(over: Partial<ExpansionSignals> = {}): ExpansionSignals {
  return signals({
    verificationState: 'VERIFIED',
    availability: 'ONLINE',
    completedJobs: 60,
    ratingAvg: 4.9,
    reviewCount: 40,
    cancelledByProvider: 1,
    terminalBookings: 60,
    openComplaints: 0,
    medianResponseMinutes: 20,
    respondedRequests: 50,
    ...over,
  });
}

function resolve(over: Partial<ExpansionResolverInput> = {}): ExpansionDecision {
  return resolveServiceAreaExpansion({
    enabled: true,
    baseMaxKm: 100,
    absoluteMaxKm: 250,
    currentRadiusKm: 25,
    policy: { version: '2026.08-sy-v1', tiers: LADDER },
    signals: signals(),
    override: null,
    now: NOW,
    ...over,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the feature switch is off', () => {
  // The acceptance criterion this whole sprint is judged on: with the switch
  // off, nothing about a provider can change a single number.
  it('returns exactly the standard bounds, whatever the provider has done', () => {
    const decision = resolve({ enabled: false, signals: exemplary() });
    expect(decision).toEqual({
      enabled: false,
      policyVersion: null,
      currentRadiusKm: 25,
      baseMaxKm: 100,
      allowedMaxKm: 100,
      currentTier: null,
      nextTier: null,
      progress: [],
      reasonCodes: ['FEATURE_DISABLED'],
      showRewardCard: false,
    });
  });

  it('ignores a live override', () => {
    const decision = resolve({
      enabled: false,
      override: { maxKm: 250, expiresAt: null },
      signals: exemplary(),
    });
    expect({ allowed: decision.allowedMaxKm, card: decision.showRewardCard }).toEqual({
      allowed: 100,
      card: false,
    });
  });
});

describe('a brand-new provider (cold start)', () => {
  const decision = resolve({ signals: signals() });

  it('is not denied — it is shown what to do next', () => {
    expect({
      allowed: decision.allowedMaxKm,
      tier: decision.currentTier,
      next: decision.nextTier?.key,
      reasons: decision.reasonCodes,
      card: decision.showRewardCard,
    }).toEqual({
      allowed: 100,
      tier: null,
      next: 'established',
      reasons: ['NO_TIER_YET'],
      card: true,
    });
  });

  it('is never blocked by an anti-abuse metric it has no history for', () => {
    // Nought cancellations out of nought bookings must not read as a failure.
    // Getting this wrong is the cold-start trap: it would fall hardest on the
    // providers this feature exists to bring in.
    const byKey = Object.fromEntries(decision.progress.map((p) => [p.key, p.met]));
    expect(byKey).toEqual({
      VERIFICATION: false,
      COMPLETED_JOBS: false,
      CANCELLATION_RATE: true,
      COMPLAINTS: true,
    });
  });

  it('reports progress toward the disclosed criteria only', () => {
    expect(decision.progress).toEqual([
      {
        key: 'VERIFICATION',
        met: false,
        progress: null,
        current: null,
        target: null,
        disclosed: true,
      },
      { key: 'COMPLETED_JOBS', met: false, progress: 0, current: 0, target: 10, disclosed: true },
      {
        key: 'CANCELLATION_RATE',
        met: true,
        progress: null,
        current: null,
        target: null,
        disclosed: false,
      },
      {
        key: 'COMPLAINTS',
        met: true,
        progress: null,
        current: null,
        target: null,
        disclosed: false,
      },
    ]);
  });
});

describe('an insufficient rating sample', () => {
  // Five stars from two customers is not evidence, and must not be treated as
  // either a pass or a rating failure.
  const s = exemplary({ ratingAvg: 5, reviewCount: 2 });
  const decision = resolve({ signals: s });

  it('holds the tier that does not ask about ratings, and not the one that does', () => {
    expect({ tier: decision.currentTier?.key, next: decision.nextTier?.key }).toEqual({
      tier: 'established',
      next: 'wide',
    });
    expect(decision.allowedMaxKm).toBe(150);
  });

  it('tells the provider the SAMPLE is short, not that their rating is', () => {
    const byKey = Object.fromEntries(decision.progress.map((p) => [p.key, p]));
    expect(byKey['RATING_SAMPLE']).toEqual({
      key: 'RATING_SAMPLE',
      met: false,
      progress: 0.1,
      current: 2,
      target: 20,
      disclosed: true,
    });
    // The rating criterion is unmet too — it cannot be met below the sample
    // floor — but it is reported with the provider's real average, so nothing
    // on the card claims their rating is the problem.
    expect(byKey['RATING']).toEqual({
      key: 'RATING',
      met: false,
      progress: null,
      current: 5,
      target: 4.5,
      disclosed: true,
    });
  });

  it('lets the same provider through once the sample arrives', () => {
    const later = resolve({ signals: exemplary({ ratingAvg: 5, reviewCount: 20 }) });
    expect({ tier: later.currentTier?.key, allowed: later.allowedMaxKm }).toEqual({
      tier: 'wide',
      allowed: 200,
    });
  });
});

describe('strong ratings but a safety hold', () => {
  it.each(['UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED', 'TERMINATED'] as const)(
    'grants nothing while standing is %s',
    (standingState) => {
      const decision = resolve({ signals: exemplary({ standingState }) });
      expect({
        allowed: decision.allowedMaxKm,
        tier: decision.currentTier,
        reasons: decision.reasonCodes,
        card: decision.showRewardCard,
      }).toEqual({ allowed: 100, tier: null, reasons: ['SAFETY_HOLD'], card: false });
    },
  );

  it.each(['SUSPENDED', 'REJECTED'])(
    'grants nothing to a LEGACY %s provider whose axis was never backfilled',
    (legacyStatus) => {
      // ADR 0007: the Sprint 7 axes are not authoritative yet. A provider
      // suspended before they existed has standingState null, and reading
      // only the axis would treat an un-backfilled row as good standing —
      // handing a reward to exactly the people an operator acted against.
      const decision = resolve({
        signals: exemplary({
          standingState: null,
          legacyStatus: legacyStatus as 'SUSPENDED',
        }),
      });
      expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
        allowed: 100,
        reasons: ['SAFETY_HOLD'],
      });
    },
  );

  it('does not treat a legacy DRAFT or ACTIVE provider as held', () => {
    for (const legacyStatus of ['DRAFT', 'PENDING_REVIEW', 'ACTIVE'] as const) {
      const decision = resolve({ signals: exemplary({ standingState: null, legacyStatus }) });
      expect({ legacyStatus, allowed: decision.allowedMaxKm }).toEqual({
        legacyStatus,
        allowed: 200,
      });
    }
  });

  it('outranks a manual override', () => {
    // Otherwise an override granted before the hold would quietly survive it.
    const decision = resolve({
      signals: exemplary({ standingState: 'UNDER_REVIEW' }),
      override: { maxKm: 250, expiresAt: null },
    });
    expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
      allowed: 100,
      reasons: ['SAFETY_HOLD'],
    });
  });

  it('restores what was earned once the hold is lifted', () => {
    const decision = resolve({ signals: exemplary({ standingState: 'GOOD' }) });
    expect(decision.allowedMaxKm).toBe(200);
  });
});

describe('a manual override', () => {
  it('raises the ceiling and says so', () => {
    const decision = resolve({ override: { maxKm: 180, expiresAt: null } });
    expect({
      allowed: decision.allowedMaxKm,
      reasons: decision.reasonCodes,
      card: decision.showRewardCard,
    }).toEqual({ allowed: 180, reasons: ['MANUAL_OVERRIDE', 'NO_TIER_YET'], card: true });
  });

  it('works in a market with no ladder at all — the appeal path for sparse markets', () => {
    const decision = resolve({
      policy: null,
      override: { maxKm: 180, expiresAt: null },
    });
    expect({
      allowed: decision.allowedMaxKm,
      reasons: decision.reasonCodes,
      card: decision.showRewardCard,
    }).toEqual({
      allowed: 180,
      reasons: ['MANUAL_OVERRIDE', 'NO_POLICY_FOR_MARKET'],
      card: true,
    });
  });

  it('never lowers what was earned', () => {
    const decision = resolve({
      signals: exemplary(),
      override: { maxKm: 120, expiresAt: null },
    });
    expect(decision.allowedMaxKm).toBe(200);
  });

  it('is clamped by the configured absolute ceiling', () => {
    const decision = resolve({ override: { maxKm: 400, expiresAt: null } });
    expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
      allowed: 250,
      reasons: ['MANUAL_OVERRIDE', 'NO_TIER_YET', 'CEILING_CLAMPED'],
    });
  });

  it('stops applying the instant it expires, and says why', () => {
    const expiresAt = new Date(NOW.getTime() - 1);
    const decision = resolve({ override: { maxKm: 180, expiresAt } });
    expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
      allowed: 100,
      reasons: ['OVERRIDE_EXPIRED', 'NO_TIER_YET'],
    });
  });

  it('still applies at the last instant before expiry', () => {
    const decision = resolve({
      override: { maxKm: 180, expiresAt: new Date(NOW.getTime() + 1) },
    });
    expect(decision.allowedMaxKm).toBe(180);
  });
});

describe('a market with no published policy', () => {
  const decision = resolve({ policy: null, signals: exemplary() });

  it('leaves the standard bounds untouched however good the provider is', () => {
    expect({
      allowed: decision.allowedMaxKm,
      version: decision.policyVersion,
      reasons: decision.reasonCodes,
    }).toEqual({ allowed: 100, version: null, reasons: ['NO_POLICY_FOR_MARKET'] });
  });

  it('shows no reward card, because there is nothing to reward or work toward', () => {
    expect({ card: decision.showRewardCard, progress: decision.progress }).toEqual({
      card: false,
      progress: [],
    });
  });
});

describe('a change of transport', () => {
  // Transport moves the BASE ceiling (Sprint 9B.19), not the earned one. The
  // two must compose without either swallowing the other.
  it('raises the floor of what is allowed when the base ceiling rises above the tier', () => {
    const decision = resolve({ baseMaxKm: 220, signals: exemplary({ reviewCount: 2 }) });
    // Base 220 beats the 150 tier the provider holds; nobody loses reach
    // because a ladder exists.
    expect({ allowed: decision.allowedMaxKm, tier: decision.currentTier?.key }).toEqual({
      allowed: 220,
      tier: 'established',
    });
  });

  it('keeps the earned ceiling when the base ceiling falls', () => {
    const decision = resolve({ baseMaxKm: 30, signals: exemplary() });
    expect(decision.allowedMaxKm).toBe(200);
  });

  it('never moves the provider stored radius', () => {
    // The whole shape of the feature: it raises a ceiling, it does not widen
    // anyone's travel. `currentRadiusKm` is echoed unchanged in every case.
    for (const input of [
      { signals: exemplary() },
      { signals: signals() },
      { enabled: false },
      { policy: null },
      { override: { maxKm: 250, expiresAt: null } },
    ]) {
      expect(resolve(input).currentRadiusKm).toBe(25);
    }
  });
});

describe('tier transitions', () => {
  it('moves up one rung at a time as the work arrives', () => {
    const steps = [
      { jobs: 0, verified: false, expect: null },
      { jobs: 9, verified: true, expect: null },
      { jobs: 10, verified: true, expect: 'established' },
      { jobs: 39, verified: true, expect: 'established' },
      { jobs: 40, verified: true, expect: 'wide' },
    ];
    for (const step of steps) {
      const decision = resolve({
        signals: exemplary({
          completedJobs: step.jobs,
          verificationState: step.verified ? 'VERIFIED' : 'UNVERIFIED',
        }),
      });
      expect({ jobs: step.jobs, tier: decision.currentTier?.key ?? null }).toEqual({
        jobs: step.jobs,
        tier: step.expect,
      });
    }
  });

  it('drops back down when a criterion stops being met', () => {
    const fallen = resolve({ signals: exemplary({ openComplaints: 1 }) });
    expect({ tier: fallen.currentTier, allowed: fallen.allowedMaxKm }).toEqual({
      tier: null,
      allowed: 100,
    });
  });

  it('reports the top rung as held with nothing above it', () => {
    const decision = resolve({ signals: exemplary() });
    expect({
      tier: decision.currentTier?.key,
      next: decision.nextTier,
      reasons: decision.reasonCodes,
    }).toEqual({ tier: 'wide', next: null, reasons: ['MAX_TIER_HELD'] });
  });

  it('keeps showing progress at the top, against the rung that is held', () => {
    // Otherwise the card goes blank for exactly the providers who did best.
    const decision = resolve({ signals: exemplary() });
    expect(decision.progress.length).toBeGreaterThan(0);
    expect(decision.progress.every((p) => p.met)).toBe(true);
  });

  it('clamps a tier that outlives a lowered absolute ceiling', () => {
    const decision = resolve({ signals: exemplary(), absoluteMaxKm: 170 });
    expect({ allowed: decision.allowedMaxKm, reasons: decision.reasonCodes }).toEqual({
      allowed: 170,
      reasons: ['MAX_TIER_HELD', 'CEILING_CLAMPED'],
    });
  });
});

describe('determinism', () => {
  // "Root-cause non-deterministic eligibility results" — the cheapest way to
  // have none is for the answer not to depend on anything but the input.
  it('gives the same answer for the same input, every time and in any order', () => {
    const once = resolve({ signals: exemplary({ completedJobs: 40, reviewCount: 20 }) });
    for (let i = 0; i < 50; i += 1) {
      expect(resolve({ signals: exemplary({ completedJobs: 40, reviewCount: 20 }) })).toEqual(once);
    }
    // Tier order in the stored ladder must not matter either.
    const reversed = resolve({
      signals: exemplary({ completedJobs: 40, reviewCount: 20 }),
      policy: { version: '2026.08-sy-v1', tiers: [...LADDER].reverse() },
    });
    expect(reversed).toEqual(once);
  });

  it('decides a cancellation rate on the boundary by exact integer arithmetic', () => {
    // 2/10 is exactly 20%, the ceiling, and must PASS. Computed as a float
    // this is the kind of comparison that decides differently on a boundary
    // and cannot be reproduced when it is disputed.
    const at = resolve({
      signals: exemplary({ completedJobs: 10, cancelledByProvider: 2, terminalBookings: 10 }),
    });
    const over = resolve({
      signals: exemplary({ completedJobs: 10, cancelledByProvider: 3, terminalBookings: 10 }),
    });
    expect({ at: at.currentTier?.key ?? null, over: over.currentTier?.key ?? null }).toEqual({
      at: 'established',
      over: null,
    });
  });

  it('compares a rating at the precision the provider is shown', () => {
    // A profile that displays 4.5 and a tier that asks for 4.5 must agree.
    const decision = resolve({ signals: exemplary({ completedJobs: 40, ratingAvg: 4.45 }) });
    expect(decision.currentTier?.key).toBe('wide');
  });

  it('never reads the clock for anything but the override window', () => {
    const a = resolve({ now: new Date('2020-01-01T00:00:00.000Z'), signals: exemplary() });
    const b = resolve({ now: new Date('2099-01-01T00:00:00.000Z'), signals: exemplary() });
    expect(a).toEqual(b);
  });
});

describe('what is never disclosed', () => {
  it('returns no number for an anti-abuse criterion, met or not', () => {
    for (const s of [signals(), exemplary(), exemplary({ openComplaints: 5 })]) {
      const withheld = resolve({ signals: s }).progress.filter((p) => !p.disclosed);
      for (const p of withheld) {
        expect({ key: p.key, current: p.current, target: p.target, progress: p.progress }).toEqual({
          key: p.key,
          current: null,
          target: null,
          progress: null,
        });
      }
    }
  });

  it('still tells the provider whether each withheld criterion is satisfied', () => {
    const withheld = resolve({ signals: exemplary({ openComplaints: 5 }) }).progress.filter(
      (p) => !p.disclosed,
    );
    expect(withheld.map((p) => [p.key, p.met])).toEqual([
      ['CANCELLATION_RATE', true],
      ['COMPLAINTS', false],
    ]);
  });
});
