// Canonical earnings transaction (Sprint 5.6 refined).
//
// One row per COMPLETED booking. The canonical /transactions endpoint
// returns COMPLETED-only because in-flight bookings are NOT earnings;
// they live in `pendingBalance` on the summary instead. The legacy
// /v1/me/provider/earnings/transactions endpoint kept the status filter
// for the prior wallet UI; this canonical shape is wallet-only.
//
// K02 — each row is shown in its OWN currency and scale. No fee or net
// figure exists (no fee is approved). `pricingType` tells the UI whether
// `amount` is a whole-job price or an hourly rate.
import type { PricingType } from '../../../seeker/bids/enums/pricing-type';

export interface EarningsTransaction {
  id: string;
  bookingId: string;
  // Always 'COMPLETED' for rows on this endpoint — kept on the wire so a
  // future expansion (refunds, bonuses) can pivot without a breaking
  // contract change.
  kind: 'BOOKING_COMPLETED';
  amount: number; // priceAmount of the underlying booking, minor units
  pricingType: PricingType;
  currency: string;
  // K02 — minor-unit scale (2 = SAR halalas); null = LEGACY_UNVERIFIED pre-K02 amount.
  amountScale: number | null;
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
