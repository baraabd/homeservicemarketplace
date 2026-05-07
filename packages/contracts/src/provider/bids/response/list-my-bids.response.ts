import type { MyBidSummary } from './my-bid-summary';

// GET /v1/me/provider/bids — cursor-paginated list of the provider's
// own bids (any status). Page size + ordering owned by the server.
export interface ListMyBidsResponse {
  items: MyBidSummary[];
  nextCursor: string | null;
}
