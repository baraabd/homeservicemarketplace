// Provider-side bid contracts (Sprint 5 slice 5.3). Submit a new bid,
// list the provider's own bids, withdraw an own pending bid. Read +
// write paths are gated on ProviderActiveGuard so DRAFT /
// PENDING_REVIEW / SUSPENDED / REJECTED accounts cannot bid.
//
// `BidStatus` and `PricingType` are re-exported from the seeker barrel
// (the Prisma enum is shared) so a single contract source defines them.
export * from './request/submit-bid.request';
export * from './request/list-my-bids.query';
export * from './response/my-bid-summary';
export * from './response/list-my-bids.response';
export * from './response/submit-bid.response';
export * from './response/withdraw-bid.response';
