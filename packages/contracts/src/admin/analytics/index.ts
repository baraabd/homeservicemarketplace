// Admin analytics (Sprint 6.4). Read-only summary aggregates for the
// admin dashboard's KPI cards. No timeseries yet — that lands in a
// future sprint when the dashboard needs it.
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
