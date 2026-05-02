// Admin financials (Sprint 6.4 — read-only).
//
//   GET /v1/admin/financials/summary
//   GET /v1/admin/financials/bookings?cursor=&limit=
//   GET /v1/admin/financials/provider-earnings?cursor=&limit=
//
// Computed at query time from completed bookings using the same
// platform-fee math as the provider-side wallet (Sprint 5.6) — env-
// driven `PROVIDER_PLATFORM_FEE_BPS`. Cancelled bookings are excluded
// from revenue. Pending balance = SUM of priceAmount across SCHEDULED +
// IN_PROGRESS rows (gross of fees, mirrors EarningsSummary on the
// provider side).

export interface AdminFinancialsSummary {
  totalRevenue: number; // gross, lifetime
  totalPlatformFees: number; // marketplace's take, lifetime
  totalProviderEarnings: number; // net to providers, lifetime
  totalRefunds: number; // lifetime refunds (always 0 until refund flow ships)
  pendingBalance: number; // gross of in-flight bookings
  completedBookingsCount: number;
  currency: string;
  platformFeeRateBps: number;
  generatedAt: string;
}

// One row of the bookings financial table. Mirrors the seeker
// EarningsTransaction shape but adds the provider identity for the
// admin lens. The endpoint is COMPLETED-only on the wire.
export interface AdminFinancialsBookingRow {
  id: string; // booking id
  bookingId: string;
  amount: number; // gross priceAmount
  platformFee: number;
  netAmount: number; // amount - platformFee
  currency: string;
  occurredAt: string; // ISO; booking.updatedAt at COMPLETED
  service: {
    categorySlug: string | null;
    categoryLabelEn: string | null;
    categoryLabelAr: string | null;
    customServiceText: string | null;
  };
  city: string;
  provider: {
    id: string; // ProviderProfile.id
    displayName: string;
    userId: string | null;
    email: string | null;
  };
  seeker: {
    id: string;
    firstName: string;
  };
}

export interface ListAdminFinancialsBookingsQuery {
  cursor?: string;
  limit?: number;
}

export interface ListAdminFinancialsBookingsResponse {
  items: AdminFinancialsBookingRow[];
  nextCursor: string | null;
}

// Per-provider rollup. Sorted by gross earnings descending so the
// table opens with the marketplace's biggest earners.
export interface AdminFinancialsProviderEarningsRow {
  providerId: string; // ProviderProfile.id
  displayName: string;
  userId: string | null;
  email: string | null;
  completedBookings: number;
  grossEarnings: number;
  platformFees: number;
  netEarnings: number;
  currency: string;
}

export interface ListAdminFinancialsProviderEarningsQuery {
  cursor?: string;
  limit?: number;
}

export interface ListAdminFinancialsProviderEarningsResponse {
  items: AdminFinancialsProviderEarningsRow[];
  nextCursor: string | null;
}
