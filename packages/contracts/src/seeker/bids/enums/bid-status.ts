// Lifecycle states for a Provider's bid on a Seeker request. Mirrors
// the Prisma `BidStatus` enum so the wire shape is identical to the
// persisted shape — no mapping at the boundary.
//
// Slice 2.1 (read-only) returns mostly PENDING bids; ACCEPTED /
// REJECTED / WITHDRAWN are introduced for read-shape parity so
// future write slices (accept-bid, withdraw-bid) don't require a
// coordinated enum-add migration.
export const BidStatus = {
  Pending: 'PENDING',
  Accepted: 'ACCEPTED',
  Rejected: 'REJECTED',
  Withdrawn: 'WITHDRAWN',
} as const;
export type BidStatus = (typeof BidStatus)[keyof typeof BidStatus];
