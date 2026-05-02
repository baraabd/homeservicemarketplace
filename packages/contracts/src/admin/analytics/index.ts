// Admin analytics (Sprint 6.4 refined — read-only).
//
//   GET /v1/admin/analytics/summary                    (existing — KPI cards)
//   GET /v1/admin/analytics/overview?from=&to=         Sprint 6.4
//   GET /v1/admin/analytics/revenue?from=&to=          Sprint 6.4 — daily buckets

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
    grossLifetimeAmount: number;
    grossLast30DaysAmount: number;
    currency: string;
  };
  disputes: {
    open: number;
    inReview: number;
    resolvedLifetime: number;
  };
  generatedAt: string;
}

export interface AdminAnalyticsResponse {
  summary: AdminAnalyticsSummary;
}

// ─── Sprint 6.4 — date-range overview ────────────────────────────

// Both endpoints accept ISO 'YYYY-MM-DD' (UTC) dates. Both are
// optional on the wire; the server defaults to the last 30 days when
// they're missing. The server caps the range at 365 days so a runaway
// query can't scan the entire bookings table.
export interface AnalyticsDateRangeQuery {
  from?: string;
  to?: string;
}

// Aggregate counts + revenue scoped to [from, to]. The "withinRange"
// keys count only bookings whose status flipped to COMPLETED inside
// the window; lifetime keys mirror the existing /summary endpoint
// for back-compat with the prior dashboard cards.
export interface AdminAnalyticsOverview {
  range: {
    from: string;
    to: string;
  };
  counts: {
    users: number;
    providers: number;
    requests: number;
    bookingsCompleted: number;
    bookingsCancelled: number;
    disputesOpen: number;
  };
  revenue: {
    grossWithinRange: number;
    platformFeesWithinRange: number;
    netProviderEarningsWithinRange: number;
    grossLifetime: number;
  };
  currency: string;
  platformFeeRateBps: number;
  generatedAt: string;
}

// One row per UTC calendar day in the request range, zero-filled. The
// frontend renders the array as-is with no extra date math.
export interface RevenueChartBucket {
  date: string; // 'YYYY-MM-DD'
  grossEarnings: number;
  platformFees: number;
  netProviderEarnings: number;
  completedBookings: number;
}

export interface AdminAnalyticsRevenue {
  range: {
    from: string;
    to: string;
  };
  currency: string;
  platformFeeRateBps: number;
  buckets: RevenueChartBucket[];
}
