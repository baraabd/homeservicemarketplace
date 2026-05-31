// Notification kinds. Mirrors the Prisma `NotificationType` enum so the
// wire shape is identical to the persisted shape — no mapping at the
// boundary.
//
// Slice 3.1 actively emits BID_ACCEPTED + BOOKING_CREATED (from inside
// the accept-bid transaction) and BOOKING_CANCELLED (from inside the
// cancel-booking transaction). The remaining types are pinned now so
// future slices (Provider posting → BID_RECEIVED, chat → MESSAGE_RECEIVED,
// reviews → REVIEW_REQUESTED, ops broadcasts → SYSTEM, completion →
// BOOKING_COMPLETED) do not force another contract bump.
export const NotificationType = {
  BidReceived: 'BID_RECEIVED',
  BidAccepted: 'BID_ACCEPTED',
  BookingCreated: 'BOOKING_CREATED',
  // Sprint 7.x — emitted when the provider starts a scheduled booking.
  // Polling fallback depends on this row existing; without it the
  // seeker's IN_PROGRESS toast can't surface offline-socket.
  BookingInProgress: 'BOOKING_IN_PROGRESS',
  BookingCancelled: 'BOOKING_CANCELLED',
  BookingCompleted: 'BOOKING_COMPLETED',
  MessageReceived: 'MESSAGE_RECEIVED',
  ReviewRequested: 'REVIEW_REQUESTED',
  // Sprint 7.x — emitted to matching providers when a seeker creates
  // a new service request.
  RequestAvailable: 'REQUEST_AVAILABLE',
  System: 'SYSTEM',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
