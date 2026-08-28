import {
  DISCLOSED_CRITERIA,
  criteriaKeys,
  type ExpansionCriteria,
  type ExpansionCriterionKey,
  type ExpansionTier,
} from './expansion-policy-payload';
import type { ExpansionSignals } from './expansion-signals';

// Sprint 9B.20 — who has earned a wider service area, and why.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// PURE. No clock, no database, no settings lookup, no randomness: everything
// it needs arrives in the input, including `now`. That is not tidiness — an
// eligibility decision that is not reproducible cannot be appealed, because
// nobody can re-run the decision that was made. The same input must give the
// same output on any machine, in any order, forever.
//
// It also means the whole cross-product below is testable without a database,
// and that a rule cannot quietly grow a query.
//
// WHAT IT DOES AND DOES NOT CHANGE
//
// It raises a CEILING. It never raises the provider's radius, never touches
// their stored value, and never lowers the standard bounds. A provider who has
// earned a 60 km ceiling and set 8 km still travels 8 km, and nothing in this
// module can make them travel further. The reward is permission, not a duty —
// silently widening someone's travel obligations because a metric moved is the
// failure mode this shape exists to make impossible.

export type ExpansionReasonCode =
  /** The master switch is off. Bounds are exactly the standard ones. */
  | 'FEATURE_DISABLED'
  /** No live ladder for this provider's market. */
  | 'NO_POLICY_FOR_MARKET'
  /** Provider standing is not GOOD. Outranks everything, override included. */
  | 'SAFETY_HOLD'
  /** A tier is held. */
  | 'TIER_HELD'
  /** The ladder is live and no tier is met yet. */
  | 'NO_TIER_YET'
  /** The top rung is held; there is nothing above it. */
  | 'MAX_TIER_HELD'
  /** An operator granted this ceiling by hand. */
  | 'MANUAL_OVERRIDE'
  /** There was an override and its window has passed. */
  | 'OVERRIDE_EXPIRED'
  /** A tier (or override) asked for more than the configured absolute ceiling
   *  allows, so it was cut down to it. */
  | 'CEILING_CLAMPED';

export interface ExpansionCriterionProgress {
  key: ExpansionCriterionKey;
  met: boolean;
  /**
   * 0…1, or null when the criterion does not accumulate.
   *
   * Null for boolean gates (you are verified or you are not), for ratings (an
   * average is not a progress bar — 2.5 out of a required 4.5 is not "halfway
   * there"), and for every withheld criterion.
   */
  progress: number | null;
  /** Where the provider is now. Null when the criterion is withheld. */
  current: number | null;
  /** What the tier asks for. Null when the criterion is withheld. */
  target: number | null;
  /** False when the numbers are deliberately not published — see
   *  DISCLOSED_CRITERIA. `met` is still returned: a provider needs to know
   *  whether they are clear, not what the threshold is. */
  disclosed: boolean;
}

export interface ExpansionTierView {
  key: string;
  maxKm: number;
}

export interface ExpansionDecision {
  enabled: boolean;
  /** The ladder this decision was made under. Null when none was live — and
   *  the value stored on the grant row, so the decision stays explainable
   *  after the ladder is retired. */
  policyVersion: string | null;
  /** What the provider has actually set. Echoed so a caller never has to pair
   *  this decision with a second read to render the card. */
  currentRadiusKm: number | null;
  /** The standard transport-based ceiling. What applies with no expansion. */
  baseMaxKm: number;
  /** The ceiling in force. Always >= baseMaxKm. */
  allowedMaxKm: number;
  currentTier: ExpansionTierView | null;
  /** The next rung up, or null at the top / with no ladder. */
  nextTier: ExpansionTierView | null;
  /** How the provider is doing against `nextTier`, or against `currentTier`
   *  when they are at the top. Empty when there is nothing to work toward. */
  progress: ExpansionCriterionProgress[];
  /** Stable, ordered, and the record of WHY. */
  reasonCodes: ExpansionReasonCode[];
  /** Whether the client may render the reward card at all. The client asks no
   *  questions of its own — this is the answer. */
  showRewardCard: boolean;
}

export interface ExpansionOverride {
  maxKm: number;
  /** Null = until revoked. */
  expiresAt: Date | null;
}

export interface ExpansionResolverInput {
  /** `provider_service_area_expansion_enabled`. */
  enabled: boolean;
  /** From resolveRadiusPolicy — the transport-based ceiling. */
  baseMaxKm: number;
  /** `provider_service_area_expansion_max_km`. Re-applied here so a ladder
   *  published under a higher ceiling cannot outlive a lowered one. */
  absoluteMaxKm: number;
  currentRadiusKm: number | null;
  /** The live ladder for this provider's market, tiers ascending by maxKm. */
  policy: { version: string; tiers: readonly ExpansionTier[] } | null;
  signals: ExpansionSignals;
  override: ExpansionOverride | null;
  /** Passed in. See the header. */
  now: Date;
}

/** Standing values that stop an expansion. Anything other than GOOD means the
 *  marketplace has an open question about this provider, and widening their
 *  reach while it is open would be the platform answering it in their favour. */
const HOLD_STANDINGS = new Set(['UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED', 'TERMINATED']);

/** The same question on the LEGACY axis, which ADR 0007 says still outranks it.
 *  A provider suspended before the axes existed has `standingState` null, and
 *  reading only the axis would treat "we have not backfilled this row" as
 *  "this provider is in good standing". */
const HOLD_LEGACY_STATUSES = new Set(['SUSPENDED', 'REJECTED']);

function onSafetyHold(signals: ExpansionSignals): boolean {
  if (signals.standingState !== null && HOLD_STANDINGS.has(signals.standingState)) return true;
  return HOLD_LEGACY_STATUSES.has(signals.legacyStatus);
}

export function resolveServiceAreaExpansion(input: ExpansionResolverInput): ExpansionDecision {
  const { enabled, baseMaxKm, absoluteMaxKm, currentRadiusKm, policy, signals, override, now } =
    input;

  const base: Omit<ExpansionDecision, 'allowedMaxKm' | 'reasonCodes' | 'showRewardCard'> = {
    enabled,
    policyVersion: null,
    currentRadiusKm,
    baseMaxKm,
    currentTier: null,
    nextTier: null,
    progress: [],
  };

  // ── Off. The pre-9B.20 world, exactly. ──────────────────────────────────
  //
  // Returned before anything else is read, so with the switch off no ladder,
  // no override and no signal can change a single number a provider sees.
  if (!enabled) {
    return {
      ...base,
      allowedMaxKm: baseMaxKm,
      reasonCodes: ['FEATURE_DISABLED'],
      showRewardCard: false,
    };
  }

  // ── A hold outranks everything, including an override. ──────────────────
  //
  // The card stays hidden rather than turning into a disciplinary notice: it
  // is a reward surface, and "you are under review" belongs where the review
  // is explained, next to what the provider can do about it.
  if (onSafetyHold(signals)) {
    return {
      ...base,
      allowedMaxKm: baseMaxKm,
      reasonCodes: ['SAFETY_HOLD'],
      showRewardCard: false,
    };
  }

  const reasonCodes: ExpansionReasonCode[] = [];
  let clamped = false;

  // ── The manual override — the appeal path. ──────────────────────────────
  //
  // Applies with or without a ladder, because the markets that need it most
  // are the ones too sparse to have one. Still bounded by the absolute
  // ceiling: an operator's mistake should not be able to put a provider's feed
  // across a country either.
  let overrideKm = 0;
  if (override !== null) {
    const live = override.expiresAt === null || override.expiresAt.getTime() > now.getTime();
    if (live) {
      overrideKm = Math.min(override.maxKm, absoluteMaxKm);
      if (override.maxKm > absoluteMaxKm) clamped = true;
      reasonCodes.push('MANUAL_OVERRIDE');
    } else {
      reasonCodes.push('OVERRIDE_EXPIRED');
    }
  }

  if (policy === null) {
    const allowedMaxKm = Math.max(baseMaxKm, overrideKm);
    reasonCodes.push('NO_POLICY_FOR_MARKET');
    if (clamped) reasonCodes.push('CEILING_CLAMPED');
    return {
      ...base,
      allowedMaxKm,
      reasonCodes,
      // Nothing to work toward and nothing earned — unless an override already
      // gave them more reach, in which case they have to be told they have it.
      showRewardCard: allowedMaxKm > baseMaxKm,
    };
  }

  // ── Walk the ladder. ────────────────────────────────────────────────────
  //
  // Ascending by maxKm (guaranteed by parseExpansionLadder), and monotonic in
  // difficulty (also guaranteed there), so the highest met tier is the one
  // held and the first unmet tier above it is the one to work toward.
  const tiers = [...policy.tiers].sort((a, b) => a.maxKm - b.maxKm);
  let held: ExpansionTier | null = null;
  let next: ExpansionTier | null = null;
  for (const tier of tiers) {
    if (meetsAll(tier.criteria, signals)) {
      held = tier;
    } else if (next === null) {
      next = tier;
    }
  }

  const tierKm = held === null ? 0 : Math.min(held.maxKm, absoluteMaxKm);
  if (held !== null && held.maxKm > absoluteMaxKm) clamped = true;

  const allowedMaxKm = Math.max(baseMaxKm, tierKm, overrideKm);

  if (held === null) reasonCodes.push('NO_TIER_YET');
  else if (next === null) reasonCodes.push('MAX_TIER_HELD');
  else reasonCodes.push('TIER_HELD');
  if (clamped) reasonCodes.push('CEILING_CLAMPED');

  // Progress is against the rung being climbed. At the top there is nothing to
  // climb, so it reports the rung held — which is what keeps the card from
  // going blank for the providers who did best.
  const measured = next ?? held;

  return {
    ...base,
    policyVersion: policy.version,
    allowedMaxKm,
    currentTier: held === null ? null : { key: held.key, maxKm: held.maxKm },
    nextTier: next === null ? null : { key: next.key, maxKm: next.maxKm },
    progress: measured === null ? [] : describeProgress(measured.criteria, signals),
    reasonCodes,
    // A live ladder is something to show: locked with progress, or unlocked
    // with what was earned. Both are the feature working.
    showRewardCard: true,
  };
}

/** Every criterion the tier names, satisfied. */
function meetsAll(criteria: ExpansionCriteria, signals: ExpansionSignals): boolean {
  return criteriaKeys(criteria).every((key) => isMet(key, criteria, signals));
}

/**
 * Is one criterion satisfied?
 *
 * THE ASYMMETRY WORTH READING TWICE. Criteria that ask a provider to have DONE
 * something need evidence that they did: no jobs, no tier. Criteria that ask a
 * provider not to have done something — cancellations, slow replies — need
 * evidence that they DID, and an empty history is not that evidence. So the
 * ceilings pass below their sample floor.
 *
 * Read the other way round, `minTerminalBookings` would block a provider with
 * five clean jobs from a tier that asks for ten bookings' worth of cancellation
 * history, on a metric they have never once failed. That is a cold-start trap,
 * and it would fall hardest on exactly the providers this feature is meant to
 * bring in. The sample floors are false-positive guards, not gates.
 */
function isMet(key: ExpansionCriterionKey, c: ExpansionCriteria, s: ExpansionSignals): boolean {
  switch (key) {
    case 'VERIFICATION':
      return s.verificationState === 'VERIFIED';
    case 'COMPLETED_JOBS':
      return s.completedJobs >= (c.minCompletedJobs ?? 0);
    case 'RATING': {
      // Below the sample floor an average is not evidence either way, so the
      // rating criterion cannot be met — but the provider is told about the
      // SAMPLE, not about their rating. See RATING_SAMPLE.
      if (s.reviewCount < (c.minReviewCount ?? 1)) return false;
      return scaledRating(s.ratingAvg) >= scaledRating(c.minRatingAvg ?? 0);
    }
    case 'RATING_SAMPLE':
      return s.reviewCount >= (c.minReviewCount ?? 0);
    case 'CANCELLATION_RATE': {
      if (s.terminalBookings < (c.minTerminalBookings ?? 1)) return true;
      // Cross-multiplied rather than divided: integer arithmetic is exact, and
      // an eligibility boundary decided by floating-point rounding is the kind
      // of non-determinism nobody can reproduce when it is disputed.
      return s.cancelledByProvider * 100 <= (c.maxCancellationRatePct ?? 100) * s.terminalBookings;
    }
    case 'COMPLAINTS':
      return s.openComplaints <= (c.maxOpenComplaints ?? Number.MAX_SAFE_INTEGER);
    case 'RESPONSE_TIME': {
      if (s.respondedRequests < (c.minRespondedRequests ?? 1)) return true;
      if (s.medianResponseMinutes === null) return true;
      return s.medianResponseMinutes <= (c.maxMedianResponseMinutes ?? Number.MAX_SAFE_INTEGER);
    }
    case 'AVAILABILITY':
      return s.availability === 'ONLINE';
  }
}

/**
 * A rating compared at the precision it is DISPLAYED at.
 *
 * A provider whose profile shows 4.5 and who is refused a tier that asks for
 * 4.5 has been told two different things by the same system. Scaling to tenths
 * also removes the floating-point comparison entirely, so the answer does not
 * depend on how the average happened to be accumulated.
 */
function scaledRating(value: number): number {
  return Math.round(value * 10);
}

function describeProgress(c: ExpansionCriteria, s: ExpansionSignals): ExpansionCriterionProgress[] {
  return criteriaKeys(c).map((key) => {
    const met = isMet(key, c, s);
    const disclosed = DISCLOSED_CRITERIA.has(key);
    if (!disclosed) {
      return { key, met, progress: null, current: null, target: null, disclosed: false };
    }
    const { current, target, progress } = disclosedNumbers(key, c, s);
    return { key, met, progress, current, target, disclosed: true };
  });
}

function disclosedNumbers(
  key: ExpansionCriterionKey,
  c: ExpansionCriteria,
  s: ExpansionSignals,
): { current: number | null; target: number | null; progress: number | null } {
  switch (key) {
    case 'COMPLETED_JOBS': {
      const target = c.minCompletedJobs ?? null;
      return { current: s.completedJobs, target, progress: ratio(s.completedJobs, target) };
    }
    case 'RATING_SAMPLE': {
      const target = c.minReviewCount ?? null;
      return { current: s.reviewCount, target, progress: ratio(s.reviewCount, target) };
    }
    case 'RATING':
      // No progress bar: see ExpansionCriterionProgress.progress.
      return { current: s.ratingAvg, target: c.minRatingAvg ?? null, progress: null };
    case 'VERIFICATION':
    case 'AVAILABILITY':
      // Boolean gates. `met` already says everything true about them.
      return { current: null, target: null, progress: null };
    default:
      return { current: null, target: null, progress: null };
  }
}

/** 0…1, two decimal places. Rounded so the same input always serialises to the
 *  same string — a progress bar that jitters in the last digit between two
 *  reads looks like the eligibility itself is moving. */
function ratio(current: number, target: number | null): number | null {
  if (target === null || target <= 0) return null;
  const raw = Math.min(1, Math.max(0, current / target));
  return Math.round(raw * 100) / 100;
}
