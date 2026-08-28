// Sprint 9B.20 — the facts an expansion decision is allowed to rest on.
//
// docs/sprint-09b20/EARNED_SERVICE_AREA.md
//
// EVERY FIELD HERE IS SERVER-OBSERVED. Nothing a provider types about
// themselves reaches this type, and that is the whole point: an eligibility
// system built on self-reported numbers is a form that grants its own reward.
//
// The one field that looked like a response-reliability signal and is NOT here
// is `Bid.responseTimeMinutes`. It is the provider's own ETA, submitted with
// the bid — a claim, not a measurement. Using it would have meant a provider
// typing "5" to widen their service area, which is the exact gaming shape this
// module exists to avoid. What IS used is the gap between two server-stamped
// timestamps (`ServiceRequest.createdAt` → `Bid.submittedAt`), which nobody
// can write.
//
// The signal we deliberately do NOT have is a response *rate*. That would need
// a roster of the requests each provider was shown, and this platform records
// no fan-out. Deriving one from bids alone would punish providers for requests
// they were never offered, so the policy measures how fast they answer the
// ones they did answer, and the sample size guards the rest.

import type {
  ProviderAvailability,
  ProviderProfileStatus,
  ProviderStandingState,
  ProviderVerificationState,
} from '@homeservicemarketplace/database';

export interface ExpansionSignals {
  /** Axis 2 (ADR 0005). Null for rows the Sprint 7 backfill has not reached. */
  verificationState: ProviderVerificationState | null;
  /**
   * Axis 3. Anything other than GOOD is a HOLD: the marketplace has an open
   * question about this provider, and widening their reach while it is open
   * would be the platform answering it in their favour by default.
   */
  standingState: ProviderStandingState | null;
  /**
   * The legacy `status` column, read ALONGSIDE the axis above.
   *
   * ADR 0007: the Sprint 7 axes are not yet authoritative and `status` is, so
   * a provider suspended under the old model has `standingState` null and
   * SUSPENDED here. Reading only the axis would hand a reward to exactly the
   * providers an operator has already acted against — an absent safety signal
   * is not a clean one.
   */
  legacyStatus: ProviderProfileStatus;
  availability: ProviderAvailability;

  /** Jobs that reached COMPLETED. The denominator of nothing — a raw count. */
  completedJobs: number;
  /** 0…5, and meaningless on its own — see `reviewCount`. */
  ratingAvg: number;
  /** How many reviews the average is made of. A 5.0 from one customer is not
   *  evidence, and a policy that ignores this is a cold-start trap. */
  reviewCount: number;

  /**
   * Bookings this provider CANCELLED, attributed by `BookingEvent.actorUserId`
   * rather than by `Booking.status`.
   *
   * Status alone says a booking ended cancelled, not who ended it. Counting a
   * seeker's change of mind against the provider would build a metric that
   * penalises taking work at all.
   */
  cancelledByProvider: number;
  /** Bookings that reached a terminal state (COMPLETED or CANCELLED). The
   *  denominator, and the sample size that makes the rate meaningful. */
  terminalBookings: number;

  /** Disputes opened against this provider's bookings and still OPEN. A closed
   *  dispute is not a standing complaint, whichever way it went. */
  openComplaints: number;

  /**
   * Median minutes from request creation to this provider's bid, over the
   * bids counted in `respondedRequests`. Null when there are none.
   *
   * Median rather than mean: one holiday should not describe a year.
   */
  medianResponseMinutes: number | null;
  /** How many bids that median is made of. */
  respondedRequests: number;
}

/** A provider with no history at all. The cold-start case, written once so
 *  every test that means "brand new" says so rather than listing zeroes. */
export const NEW_PROVIDER_SIGNALS: ExpansionSignals = {
  verificationState: 'UNVERIFIED',
  standingState: 'GOOD',
  legacyStatus: 'DRAFT',
  availability: 'OFFLINE',
  completedJobs: 0,
  ratingAvg: 0,
  reviewCount: 0,
  cancelledByProvider: 0,
  terminalBookings: 0,
  openComplaints: 0,
  medianResponseMinutes: null,
  respondedRequests: 0,
};
