import type { BidStatus } from '../../../seeker/bids/enums/bid-status';

// GET /v1/me/provider/bids
//
// All filters optional. The server scopes results to the calling
// provider — there is no providerId on the wire. Cursor-by-id is
// stable; the underlying ordering uses [submittedAt DESC, id DESC] so
// two rows sharing a submittedAt never get skipped or duplicated.
export interface ListMyBidsQuery {
  status?: BidStatus;
  limit?: number;
  cursor?: string;
}
