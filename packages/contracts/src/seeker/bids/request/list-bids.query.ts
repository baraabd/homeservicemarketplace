// GET /v1/me/requests/:requestId/bids
//
// Sort options match the BidsScreen sort tabs:
//   recommended — server-side score (badge first, then rating - price)
//   price       — amount ascending
//   rating      — provider.ratingAvg descending
//   submittedAt — newest first
//
// All filters optional. The endpoint is always scoped to the
// authenticated Seeker's request — there is no userId / providerId
// filter on the wire because it would only ever be either irrelevant
// or PII-leaky.
export const BidSortKey = {
  Recommended: 'recommended',
  Price: 'price',
  Rating: 'rating',
  SubmittedAt: 'submittedAt',
} as const;
export type BidSortKey = (typeof BidSortKey)[keyof typeof BidSortKey];

export interface ListBidsQuery {
  sort?: BidSortKey;
}
