import type { BidBadge } from '../enums/bid-badge';
import type { BidStatus } from '../enums/bid-status';
import type { PricingType } from '../enums/pricing-type';
import type { ProviderBidSummary } from './provider-bid-summary';

// One bid as the Seeker sees it on the BidsScreen.
//
// `requestId` is included so a list-without-context call site (e.g. a
// future cross-request bid feed) can link back to the parent request
// without a separate lookup. For slice-2.1 the list is always scoped
// to a single requestId, so consumers can ignore it.
export interface BidSummary {
  id: string;
  requestId: string;
  amount: number;
  currency: string;
  pricingType: PricingType;
  note: string | null;
  status: BidStatus;
  responseTimeMinutes: number | null;
  badge: BidBadge | null;
  submittedAt: string;
  provider: ProviderBidSummary;
}
