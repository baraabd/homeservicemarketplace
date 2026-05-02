// Read-model summary of the provider's earnings. Sprint 5 slice 5.6
// ships this as read-only — no payouts, no withdrawals, no balance
// reconciliation. Each amount is in the integer currency unit the
// rest of the marketplace uses (cents-equivalent in the schema).
//
// Field semantics:
//   `totalGross`         — sum of priceAmount across all COMPLETED
//                           bookings, lifetime.
//   `currentMonthGross`  — same as above, scoped to the current
//                           calendar month (server timezone — UTC).
//   `pendingAmount`      — sum of priceAmount across SCHEDULED +
//                           IN_PROGRESS bookings (not yet earned but
//                           in flight).
//   `completedJobsCount` — count of COMPLETED bookings, lifetime.
//   `currency`           — wire currency code; the schema standardises
//                           on the bid's currency at acceptance time,
//                           and we surface the most common one. When
//                           a provider has bookings across currencies,
//                           the API returns the dominant code and the
//                           UI MUST treat amounts as already-summed in
//                           that currency.
//   `ratingAvg`          — denormalised from ProviderProfile.
//   `reviewCount`        — denormalised from ProviderProfile.
export interface ProviderEarningsSummary {
  totalGross: number;
  currentMonthGross: number;
  pendingAmount: number;
  completedJobsCount: number;
  currency: string;
  ratingAvg: number;
  reviewCount: number;
}
