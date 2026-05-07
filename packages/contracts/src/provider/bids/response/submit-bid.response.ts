import type { MyBidSummary } from './my-bid-summary';

// POST /v1/me/provider/bids — returns the freshly created bid in the
// same MyBidSummary shape the list endpoint uses, so the frontend can
// optimistically prepend the response into the list cache.
export interface SubmitBidResponse {
  bid: MyBidSummary;
}
