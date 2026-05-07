import type { MyBidSummary } from './my-bid-summary';

// POST /v1/me/provider/bids/:bidId/withdraw — returns the withdrawn
// bid (status === 'WITHDRAWN') in the same MyBidSummary shape as
// list/submit so the frontend can update the cache by id.
export interface WithdrawBidResponse {
  bid: MyBidSummary;
}
