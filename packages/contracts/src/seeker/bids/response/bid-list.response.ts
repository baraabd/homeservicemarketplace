import type { BidSummary } from './bid-summary';

// GET /v1/me/requests/:requestId/bids
//
// Slice 2.1 returns the full set of active bids for a single request
// in one envelope (the BidsScreen renders them all). Cursor pagination
// can be added later if a request ever attracts more bids than the
// default page; for now `nextCursor` is always null.
export interface BidListResponse {
  items: BidSummary[];
  nextCursor: string | null;
}
