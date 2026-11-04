import type {
  BookingFeeStatus,
  CurrencyBookedValue,
  ExcludedAmountGroup,
} from '../../money/amount-unit';
import type { PricingType } from '../../seeker/bids/enums/pricing-type';

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

// K02 — booked value per currency (verified FIXED-price only); legacy-unit
// and hourly-rate bookings are counted in `excluded`. No fee/net/refund
// totals: no fee is approved and booking refunds do not exist.
export interface AdminFinancialsSummary {
  byCurrency: CurrencyBookedValue[];
  excluded: ExcludedAmountGroup[];
  completedBookingsCount: number;
  feeStatus: BookingFeeStatus;
  platformFeeRateBps: null;
  generatedAt: string;
}

// One row of the bookings financial table. Mirrors the seeker
// EarningsTransaction shape but adds the provider identity for the
// admin lens. The endpoint is COMPLETED-only on the wire.
export interface AdminFinancialsBookingRow {
  id: string; // booking id
  bookingId: string;
  amount: number; // priceAmount, minor units at amountScale
  pricingType: PricingType;
  currency: string;
  // K02 — minor-unit scale; null = LEGACY_UNVERIFIED pre-K02 amount.
  amountScale: number | null;
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
  /** Verified FIXED-price completed value in `currency` (one row per provider+currency). */
  grossEarnings: number;
  currency: string;
  amountScale: number;
}

export interface ListAdminFinancialsProviderEarningsQuery {
  cursor?: string;
  limit?: number;
}

export interface ListAdminFinancialsProviderEarningsResponse {
  items: AdminFinancialsProviderEarningsRow[];
  nextCursor: string | null;
}
