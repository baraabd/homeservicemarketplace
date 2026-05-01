// Lifecycle states for a Seeker's service request. Mirrors the Prisma
// `ServiceRequestStatus` enum so the wire shape is identical to the
// persisted shape — no mapping at the boundary.
//
// Slice 3 only implements the OPEN_FOR_BIDS / CANCELLED transitions
// (create/cancel/reopen). The future statuses below are pinned in the
// contract from day one so subsequent slices that wire bids/bookings
// don't need a coordinated enum-add migration to come online.
export const ServiceRequestStatus = {
  OpenForBids: 'OPEN_FOR_BIDS',
  BidAccepted: 'BID_ACCEPTED',
  Booked: 'BOOKED',
  InProgress: 'IN_PROGRESS',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;
export type ServiceRequestStatus = (typeof ServiceRequestStatus)[keyof typeof ServiceRequestStatus];
