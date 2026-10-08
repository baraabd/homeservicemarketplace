// Admin analytics (Sprint 6.4 refined — read-only).
//
//   GET /v1/admin/analytics/summary                    (existing — KPI cards)
//   GET /v1/admin/analytics/overview?from=&to=         Sprint 6.4
//   GET /v1/admin/analytics/revenue?from=&to=          Sprint 6.4 — daily buckets
//
// R17-D (D-6) — honesty rules for every money figure below:
//
//   • Amounts are booked values (Booking.priceAmount), not payments. R15/R16
//     classify them as a BOOKING_DERIVED_ESTIMATE: nothing here is captured,
//     held, settled or paid.
//   • Amounts in different currencies are never added together. Every money
//     figure is reported per currency. A single "total" field is null when the
//     data spans more than one currency, because no conversion authority exists.
//   • No platform fee is approved (R16 P10). Fee and net figures are null with
//     `feeStatus: 'NOT_APPROVED'` — not calculated, which is not the same as 0.
//   • "Completed/cancelled within range" is dated by the booking's own
//     completion/cancellation event, never by the mutable `updatedAt`.
//     Completions with no such event cannot be dated and are counted
//     separately as `undatedCompletions` instead of being misdated.

/** Why fee and net figures are absent. */
export type AdminAnalyticsFeeStatus = 'NOT_APPROVED';

/** Booked value of COMPLETED bookings in one currency. */
export interface AdminAnalyticsCurrencyTotals {
  currency: string;
  /** Lifetime booked value of COMPLETED bookings, dated or not. */
  bookedValueLifetime: number;
  /** COMPLETED bookings in this currency, lifetime. */
  completedLifetime: number;
}

// ─── Existing summary surface ────────────────────────────────────

export interface AdminAnalyticsSummary {
  users: {
    total: number;
    active: number;
    suspended: number;
    pendingVerification: number;
    newLast7Days: number;
  };
  providers: {
    total: number;
    active: number;
    pendingReview: number;
    suspended: number;
    rejected: number;
  };
  requests: {
    openForBids: number;
    bidAccepted: number;
    completed: number;
  };
  bookings: {
    scheduled: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    /** Null when completed bookings span more than one currency. */
    grossLifetimeAmount: number | null;
    /** Completions dated by their event in the last 30 days; null when multi-currency. */
    grossLast30DaysAmount: number | null;
    /** The single currency of the figures above, or null when there is none or several. */
    currency: string | null;
    /** R17-D — the honest per-currency breakdown, sorted by currency code. */
    bookedValueByCurrency: (AdminAnalyticsCurrencyTotals & { bookedValueLast30Days: number })[];
    /** COMPLETED bookings with no completion event; they cannot be dated. */
    undatedCompletions: number;
  };
  disputes: {
    open: number;
    inReview: number;
    /** Every decided or closed dispute, legacy and canonical workspace. */
    resolvedLifetime: number;
  };
  generatedAt: string;
}

export interface AdminAnalyticsResponse {
  summary: AdminAnalyticsSummary;
}

// ─── Sprint 6.4 — date-range overview ────────────────────────────

// Both endpoints accept ISO 'YYYY-MM-DD' (UTC) dates; `to` is inclusive. Both
// are optional on the wire; the server defaults to the last 30 days when
// they're missing. The server caps the range at 365 days.
export interface AnalyticsDateRangeQuery {
  from?: string;
  to?: string;
}

export interface AdminAnalyticsRangeCurrencyTotals extends AdminAnalyticsCurrencyTotals {
  /** Booked value of bookings whose completion event falls in the range. */
  bookedValueWithinRange: number;
  completedWithinRange: number;
}

export interface AdminAnalyticsOverview {
  range: {
    from: string;
    to: string;
  };
  counts: {
    users: number;
    providers: number;
    requests: number;
    /** Completion events in range, all currencies (a count, not money). */
    bookingsCompleted: number;
    /** Cancellation events in range. */
    bookingsCancelled: number;
    disputesOpen: number;
    /** COMPLETED bookings with no completion event (never counted in range). */
    undatedCompletions: number;
  };
  revenue: {
    /** Null when the range spans several currencies. */
    grossWithinRange: number | null;
    /** Always null: no fee is approved. */
    platformFeesWithinRange: null;
    /** Always null: there is no approved fee to subtract. */
    netProviderEarningsWithinRange: null;
    /** Null when lifetime completions span several currencies. */
    grossLifetime: number | null;
  };
  /** R17-D — the honest per-currency breakdown, sorted by currency code. */
  revenueByCurrency: AdminAnalyticsRangeCurrencyTotals[];
  /** The single currency of the totals above, or null. */
  currency: string | null;
  /** Always null: no fee rate is approved. */
  platformFeeRateBps: null;
  feeStatus: AdminAnalyticsFeeStatus;
  generatedAt: string;
}

// One row per UTC calendar day in the request range, zero-filled.
export interface RevenueChartBucket {
  date: string; // 'YYYY-MM-DD'
  /** Null when the day's completions span several currencies; see `series`. */
  grossEarnings: number | null;
  /** Always null: no fee is approved. */
  platformFees: null;
  /** Always null. */
  netProviderEarnings: null;
  completedBookings: number;
}

export interface AdminAnalyticsCurrencyBucket {
  date: string; // 'YYYY-MM-DD'
  bookedValue: number;
  completedBookings: number;
}

export interface AdminAnalyticsCurrencySeries {
  currency: string;
  /** One zero-filled bucket per UTC day in the range. */
  buckets: AdminAnalyticsCurrencyBucket[];
}

export interface AdminAnalyticsRevenue {
  range: {
    from: string;
    to: string;
  };
  /** The single currency of `buckets[].grossEarnings`, or null. */
  currency: string | null;
  platformFeeRateBps: null;
  feeStatus: AdminAnalyticsFeeStatus;
  /** Back-compat day buckets (counts for every currency). */
  buckets: RevenueChartBucket[];
  /** R17-D — one daily series per currency that has completions in range. */
  series: AdminAnalyticsCurrencySeries[];
}
