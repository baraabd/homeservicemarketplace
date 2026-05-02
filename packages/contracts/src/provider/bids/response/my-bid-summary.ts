import type { BidStatus } from '../../../seeker/bids/enums/bid-status';
import type { PricingType } from '../../../seeker/bids/enums/pricing-type';

// Lightweight ref to the bidded request, embedded inside MyBidSummary
// so the Provider's "My Bids" screen renders without an extra
// round-trip per row. Deliberately narrower than the seeker's
// ServiceRequestDetail — never exposes seekerUserId or precise line1.
export interface MyBidRequestRef {
  id: string;
  category: { id: string; slug: string; labelEn: string; labelAr: string } | null;
  customServiceText: string | null;
  description: string | null;
  city: string;
  country: string;
}

// One row as the Provider sees it on their My Bids screen.
export interface MyBidSummary {
  id: string;
  amount: number;
  currency: string;
  pricingType: PricingType;
  note: string | null;
  status: BidStatus;
  responseTimeMinutes: number | null;
  submittedAt: string;
  request: MyBidRequestRef;
}
