// Canonical earnings transaction (Sprint 5.6 refined).
//
// One row per COMPLETED booking. The canonical /transactions endpoint
// returns COMPLETED-only because in-flight bookings are NOT earnings;
// they live in `pendingBalance` on the summary instead. The legacy
// /v1/me/provider/earnings/transactions endpoint kept the status filter
// for the prior wallet UI; this canonical shape is wallet-only.
//
// platformFee + netAmount are computed at query time from
// PROVIDER_PLATFORM_FEE_BPS. They are present per-row so the UI does
// not need to recompute, and they reconcile with the summary when SUM-d.
export interface EarningsTransaction {
  id: string;
  bookingId: string;
  // Always 'COMPLETED' for rows on this endpoint — kept on the wire so a
  // future expansion (refunds, bonuses) can pivot without a breaking
  // contract change.
  kind: 'BOOKING_COMPLETED';
  amount: number; // gross priceAmount of the underlying booking
  platformFee: number; // marketplace take on this row
  netAmount: number; // amount − platformFee
  currency: string;
  // ISO-8601 — booking.updatedAt at the moment the provider marked it
  // COMPLETED. The booking row never updates again unless soft-deleted.
  occurredAt: string;
  service: {
    categorySlug: string | null;
    categoryLabelEn: string | null;
    categoryLabelAr: string | null;
    customServiceText: string | null;
  };
  city: string;
}
