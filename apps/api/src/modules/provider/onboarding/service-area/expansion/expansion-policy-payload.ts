import { z } from 'zod';

// Sprint 9B.20 — the shape an earned-expansion ladder is allowed to have.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// `ServiceAreaExpansionPolicy.tiers` is JSON so that adding a signal needs no
// migration. The cost is that the database constrains nothing about it, so
// this module is the only thing between a mistyped admin request and a ladder
// that is unclimbable, free, or unfair.
//
// Everything here runs at PUBLISH time. A ladder already referenced by a grant
// is never re-validated: a rule added today must not retroactively invalidate
// an expansion someone earned honestly last month.
//
// THE RULE THIS FILE EXISTS FOR is RATING_ONLY. "Do not base access on ratings
// alone" is easy to agree with and easy to drift away from one policy edit at
// a time. Making it a publish-time refusal means the guarantee survives every
// future operator, not just the one who read the brief.

/** Every criterion a tier may name. Stable strings: they are reason codes, they
 *  appear in audit metadata, and the client renders copy per key. */
export const EXPANSION_CRITERION_KEYS = [
  'VERIFICATION',
  'COMPLETED_JOBS',
  'RATING',
  'RATING_SAMPLE',
  'CANCELLATION_RATE',
  'COMPLAINTS',
  'RESPONSE_TIME',
  'AVAILABILITY',
] as const;

export type ExpansionCriterionKey = (typeof EXPANSION_CRITERION_KEYS)[number];

/**
 * Which criteria we are willing to state a TARGET for.
 *
 * The disclosed ones are things we want providers to do more of: get verified,
 * finish jobs, collect reviews, be reachable. Publishing those targets is the
 * feature working.
 *
 * The withheld ones are anti-abuse thresholds. "Stay under 12% cancellations"
 * reads as a budget — eleven percent is fine — and "answer within 90 minutes"
 * is cleared by bidding instantly on everything, which floods seekers with
 * bids from people who have not read the job. Providers are told whether each
 * is currently satisfied, which is what they need in order to act; they are
 * not told the number to hug.
 */
export const DISCLOSED_CRITERIA: ReadonlySet<ExpansionCriterionKey> = new Set([
  'VERIFICATION',
  'COMPLETED_JOBS',
  'RATING',
  'RATING_SAMPLE',
  'AVAILABILITY',
]);

/** Criteria that say something about the provider's RATING and nothing else. */
const RATING_CRITERIA: ReadonlySet<ExpansionCriterionKey> = new Set(['RATING', 'RATING_SAMPLE']);

/** A ladder longer than this is not a ladder, it is a table nobody reads. */
export const MAX_TIERS = 8;

export interface ExpansionCriteria {
  /** Identity confirmed. A boolean gate, not a threshold. */
  requireVerified?: boolean;
  minCompletedJobs?: number;
  /** 0…5, one decimal place. Requires `minReviewCount`. */
  minRatingAvg?: number;
  minReviewCount?: number;
  /** Whole percent. Requires `minTerminalBookings`. */
  maxCancellationRatePct?: number;
  minTerminalBookings?: number;
  maxOpenComplaints?: number;
  /** Requires `minRespondedRequests`. */
  maxMedianResponseMinutes?: number;
  minRespondedRequests?: number;
  /** Provider is ONLINE. See the doc: this one punishes taking leave, so it is
   *  supported and deliberately not recommended. */
  requireActiveAvailability?: boolean;
}

export interface ExpansionTier {
  /** Stable identifier, stored on the grant row and echoed in audit metadata.
   *  Lower-case slug so it is safe in a URL and readable in a log line. */
  key: string;
  /** The ceiling this tier grants, in km. */
  maxKm: number;
  criteria: ExpansionCriteria;
}

export type ExpansionPayloadErrorCode =
  | 'MALFORMED'
  | 'EMPTY_LADDER'
  | 'TOO_MANY_TIERS'
  | 'DUPLICATE_TIER_KEY'
  | 'DUPLICATE_TIER_MAX'
  | 'NO_CRITERIA'
  | 'RATING_ONLY'
  | 'RATING_WITHOUT_SAMPLE'
  | 'RATE_WITHOUT_SAMPLE'
  | 'NON_MONOTONIC'
  | 'ABOVE_CEILING'
  | 'GRANTS_NOTHING';

export class ExpansionPayloadError extends Error {
  constructor(
    message: string,
    readonly code: ExpansionPayloadErrorCode,
  ) {
    super(message);
    this.name = 'ExpansionPayloadError';
  }
}

// `.strip()` (the default) drops unknown keys rather than rejecting or storing
// them: an older API must not choke on a field a newer one added, and must not
// persist a rule it cannot enforce either.
const criteriaSchema = z.object({
  requireVerified: z.boolean().optional(),
  minCompletedJobs: z.number().int().min(1).max(100_000).optional(),
  // One decimal place, because that is the granularity a rating average is
  // ever discussed at, and floating-point equality on 4.37 is a bug waiting.
  minRatingAvg: z.number().min(0).max(5).multipleOf(0.1).optional(),
  minReviewCount: z.number().int().min(1).max(100_000).optional(),
  maxCancellationRatePct: z.number().int().min(0).max(100).optional(),
  minTerminalBookings: z.number().int().min(1).max(100_000).optional(),
  maxOpenComplaints: z.number().int().min(0).max(1_000).optional(),
  maxMedianResponseMinutes: z
    .number()
    .int()
    .min(1)
    .max(60 * 24 * 30)
    .optional(),
  minRespondedRequests: z.number().int().min(1).max(100_000).optional(),
  requireActiveAvailability: z.boolean().optional(),
});

const tierSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lower-case slug, e.g. "established"')
    .max(40),
  maxKm: z.number().int().min(1).max(500),
  criteria: criteriaSchema,
});

const ladderSchema = z.object({ tiers: z.array(tierSchema) });

export interface ExpansionPayloadScope {
  /** `provider_service_area_expansion_max_km`. From settings, never a constant
   *  here — the same reason the radius numbers are not in React. */
  absoluteMaxKm: number;
  /** `provider_service_radius_max_km`. A tier at or below this grants nothing,
   *  and a lever that does nothing is worse than no lever. */
  baseMaxKm: number;
}

/** Which criteria a tier actually names. Order follows EXPANSION_CRITERION_KEYS
 *  so two tiers with the same criteria always produce the same list. */
export function criteriaKeys(criteria: ExpansionCriteria): ExpansionCriterionKey[] {
  const present: ExpansionCriterionKey[] = [];
  if (criteria.requireVerified === true) present.push('VERIFICATION');
  if (criteria.minCompletedJobs !== undefined) present.push('COMPLETED_JOBS');
  if (criteria.minRatingAvg !== undefined) present.push('RATING');
  if (criteria.minReviewCount !== undefined) present.push('RATING_SAMPLE');
  if (criteria.maxCancellationRatePct !== undefined) present.push('CANCELLATION_RATE');
  if (criteria.maxOpenComplaints !== undefined) present.push('COMPLAINTS');
  if (criteria.maxMedianResponseMinutes !== undefined) present.push('RESPONSE_TIME');
  if (criteria.requireActiveAvailability === true) present.push('AVAILABILITY');
  return present;
}

/**
 * Validate and normalise a ladder.
 *
 * Throws rather than returning a result, so a caller cannot forget to check:
 * publishing an invalid ladder is not a recoverable partial success.
 *
 * Returns the tiers sorted by `maxKm` ascending — the order the resolver walks
 * and the order they are stored in, so a re-read never re-sorts.
 */
export function parseExpansionLadder(
  input: unknown,
  scope: ExpansionPayloadScope,
): ExpansionTier[] {
  const result = ladderSchema.safeParse(input);
  if (!result.success) {
    throw new ExpansionPayloadError(
      `Expansion ladder is malformed: ${result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'} ${i.message}`)
        .join('; ')}`,
      'MALFORMED',
    );
  }

  const tiers = [...result.data.tiers].sort((a, b) => a.maxKm - b.maxKm);

  if (tiers.length === 0) {
    throw new ExpansionPayloadError(
      'A ladder with no tiers grants nothing. Publish at least one tier, or leave the market without a policy.',
      'EMPTY_LADDER',
    );
  }
  if (tiers.length > MAX_TIERS) {
    throw new ExpansionPayloadError(
      `A ladder may have at most ${MAX_TIERS} tiers; this one has ${tiers.length}.`,
      'TOO_MANY_TIERS',
    );
  }

  const dupKey = tiers.map((t) => t.key).find((k, i, all) => all.indexOf(k) !== i);
  if (dupKey !== undefined) {
    throw new ExpansionPayloadError(
      `Tier key "${dupKey}" appears twice. Keys are stored on grants and read back later, so they have to identify one tier.`,
      'DUPLICATE_TIER_KEY',
    );
  }
  const dupMax = tiers.map((t) => t.maxKm).find((km, i, all) => all.indexOf(km) !== i);
  if (dupMax !== undefined) {
    throw new ExpansionPayloadError(
      `Two tiers both grant ${dupMax} km. One of them is unreachable or pointless; give them different ceilings.`,
      'DUPLICATE_TIER_MAX',
    );
  }

  for (const tier of tiers) {
    validateTier(tier, scope);
  }
  assertMonotonic(tiers);

  return tiers;
}

function validateTier(tier: ExpansionTier, scope: ExpansionPayloadScope): void {
  const keys = criteriaKeys(tier.criteria);

  if (keys.length === 0) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" names no criteria, so every provider would hold it the moment the feature is switched on. That is a radius increase, not an earned one.`,
      'NO_CRITERIA',
    );
  }

  // ── The guarantee. ──────────────────────────────────────────────────────
  //
  // Ratings measure a small, self-selected sample of a provider's customers
  // and carry every bias those customers have. They are worth using and they
  // are not worth trusting alone, so a tier has to rest on at least one thing
  // the provider DID rather than one thing they were scored on.
  if (keys.every((k) => RATING_CRITERIA.has(k))) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" is decided by rating alone. Add a criterion that measures conduct or completed work — ratings are a small, biased sample and must never be the only gate.`,
      'RATING_ONLY',
    );
  }

  // Cold start. A rating threshold with no sample floor denies every new
  // provider on the strength of one review, or admits them on the strength of
  // none, depending on how the default average is stored.
  if (tier.criteria.minRatingAvg !== undefined && tier.criteria.minReviewCount === undefined) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" sets a minimum rating with no minimum number of reviews. An average of one review is not evidence; set minReviewCount.`,
      'RATING_WITHOUT_SAMPLE',
    );
  }

  // The same argument, for the two RATES. One cancelled booking out of one is
  // 100%, and one slow reply is a median.
  if (
    tier.criteria.maxCancellationRatePct !== undefined &&
    tier.criteria.minTerminalBookings === undefined
  ) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" sets a cancellation-rate ceiling with no minimum number of bookings. One cancellation out of one is 100%; set minTerminalBookings.`,
      'RATE_WITHOUT_SAMPLE',
    );
  }
  if (
    tier.criteria.maxMedianResponseMinutes !== undefined &&
    tier.criteria.minRespondedRequests === undefined
  ) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" sets a response-time ceiling with no minimum number of responses. A median of one is that one; set minRespondedRequests.`,
      'RATE_WITHOUT_SAMPLE',
    );
  }

  if (tier.maxKm > scope.absoluteMaxKm) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" grants ${tier.maxKm} km, above the configured expansion ceiling of ${scope.absoluteMaxKm} km.`,
      'ABOVE_CEILING',
    );
  }
  if (tier.maxKm <= scope.baseMaxKm) {
    throw new ExpansionPayloadError(
      `Tier "${tier.key}" grants ${tier.maxKm} km, which every provider may already set (the standard ceiling is ${scope.baseMaxKm} km). It would ask people to earn something they have.`,
      'GRANTS_NOTHING',
    );
  }
}

/**
 * A higher tier must be at least as hard as every tier below it.
 *
 * Without this a ladder can be non-monotonic — tier 2 needs 20 jobs, tier 3
 * needs 5 — and a provider legitimately holds a tier they cannot climb TO. The
 * resolver would still be correct and the ladder would still be nonsense, so
 * it is refused at publish, where an admin can see the message.
 */
function assertMonotonic(tiers: readonly ExpansionTier[]): void {
  for (let i = 1; i < tiers.length; i += 1) {
    const lower = tiers[i - 1]!;
    const upper = tiers[i]!;
    const conflict = easierThan(upper.criteria, lower.criteria);
    if (conflict !== null) {
      throw new ExpansionPayloadError(
        `Tier "${upper.key}" grants more than "${lower.key}" but is easier on ${conflict}. A ladder has to get harder as it goes up, or a provider can hold a rung they cannot reach.`,
        'NON_MONOTONIC',
      );
    }
  }
}

/** Null when `upper` is at least as demanding as `lower`; otherwise the name of
 *  the first criterion where it is not. */
function easierThan(upper: ExpansionCriteria, lower: ExpansionCriteria): string | null {
  const atLeast = (name: string, u: number | undefined, l: number | undefined): string | null =>
    l !== undefined && (u === undefined || u < l) ? name : null;
  const atMost = (name: string, u: number | undefined, l: number | undefined): string | null =>
    l !== undefined && (u === undefined || u > l) ? name : null;
  const gate = (name: string, u: boolean | undefined, l: boolean | undefined): string | null =>
    l === true && u !== true ? name : null;

  return (
    gate('requireVerified', upper.requireVerified, lower.requireVerified) ??
    atLeast('minCompletedJobs', upper.minCompletedJobs, lower.minCompletedJobs) ??
    atLeast('minRatingAvg', upper.minRatingAvg, lower.minRatingAvg) ??
    atLeast('minReviewCount', upper.minReviewCount, lower.minReviewCount) ??
    atMost('maxCancellationRatePct', upper.maxCancellationRatePct, lower.maxCancellationRatePct) ??
    atLeast('minTerminalBookings', upper.minTerminalBookings, lower.minTerminalBookings) ??
    atMost('maxOpenComplaints', upper.maxOpenComplaints, lower.maxOpenComplaints) ??
    atMost(
      'maxMedianResponseMinutes',
      upper.maxMedianResponseMinutes,
      lower.maxMedianResponseMinutes,
    ) ??
    atLeast('minRespondedRequests', upper.minRespondedRequests, lower.minRespondedRequests) ??
    gate(
      'requireActiveAvailability',
      upper.requireActiveAvailability,
      lower.requireActiveAvailability,
    )
  );
}
