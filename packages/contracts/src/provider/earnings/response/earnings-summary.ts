import type {
  BookingFeeStatus,
  CurrencyBookedValue,
  ExcludedAmountGroup,
} from '../../../money/amount-unit';

// Canonical earnings summary — K02 (hsm.amount-unit.v1).
//
// Booked value of the provider's bookings, NOT money held or payable: the
// Saudi launch collects provider subscriptions only, and no booking funds,
// balance or payout exist (R16 D-1). Therefore:
//   • `byCurrency` has one entry per currency; currencies are never added;
//   • only verified FIXED-price amounts are summed; legacy-unit amounts and
//     hourly rates are counted in `excluded` instead;
//   • no fee/net/available-balance figure exists (`feeStatus`).
//
// Amounts are integer minor units at `amountScale` (SAR: halalas).
export interface EarningsSummary {
  byCurrency: CurrencyBookedValue[];
  excluded: ExcludedAmountGroup[];
  /** Every COMPLETED booking, summed or excluded. */
  completedBookingsCount: number;
  feeStatus: BookingFeeStatus;
  platformFeeRateBps: null;
  // Denormalised for the wallet header.
  ratingAvg: number;
  reviewCount: number;
}
