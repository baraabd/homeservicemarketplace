// Canonical earnings summary (Sprint 5.6 refined).
//
// All amounts are integers in the marketplace's currency unit (cents-
// equivalent). The wire shape is wallet-friendly:
//   gross = full booking price across COMPLETED bookings
//   platformFees = marketplace take, computed from PROVIDER_PLATFORM_FEE_BPS
//   netEarnings = gross − platformFees (what the provider actually takes home)
//   availableBalance = funds the provider could withdraw today. Until
//                      the payouts module ships this equals netEarnings;
//                      once payouts ship it will be netEarnings − sum of
//                      successful withdrawals.
//   pendingBalance = SUM of priceAmount across SCHEDULED + IN_PROGRESS
//                    bookings (gross). Surfaces "money in flight" so the
//                    UI can communicate that an in-progress job's value
//                    is not yet earned.
//   completedBookingsCount = lifetime count of COMPLETED bookings.
//
// Cancelled bookings are excluded everywhere.
export interface EarningsSummary {
  grossEarnings: number;
  platformFees: number;
  netEarnings: number;
  availableBalance: number;
  pendingBalance: number;
  completedBookingsCount: number;
  // Most-common currency code across COMPLETED bookings (the schema
  // standardises currency on the bid at acceptance time). When the
  // provider has zero COMPLETED bookings, the default 'USD' is returned.
  currency: string;
  // Platform fee in basis points so the UI can render "10% platform fee"
  // honestly rather than hard-coding the rate client-side.
  platformFeeRateBps: number;
  // Denormalised for the wallet header. Stays here even though it's
  // strictly profile data because the wallet UI surfaces it.
  ratingAvg: number;
  reviewCount: number;
}
