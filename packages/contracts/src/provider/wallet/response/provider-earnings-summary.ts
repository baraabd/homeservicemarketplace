import type {
  BookingFeeStatus,
  CurrencyBookedValue,
  ExcludedAmountGroup,
} from '../../../money/amount-unit';

// Legacy /v1/me/provider/earnings summary, K02 shape. Same aggregation rules
// as EarningsSummary: per currency, verified FIXED-price only, exclusions
// counted, no fee. The former "dominant currency over a mixed sum" fields
// are gone because they added different currencies together.
export interface ProviderEarningsSummary {
  byCurrency: CurrencyBookedValue[];
  excluded: ExcludedAmountGroup[];
  completedJobsCount: number;
  feeStatus: BookingFeeStatus;
  ratingAvg: number;
  reviewCount: number;
}
