// Logical resource a notification refers to. The frontend uses
// `(resourceType, resourceId)` to route the user to the correct detail
// surface when they tap the notification row.
//
// Slice 3.1 emits REQUEST / BID / BOOKING. CONVERSATION and REVIEW are
// pinned for the chat / reviews slices — taps to those resource types
// land as a no-op until the corresponding surface ships.
export const NotificationResourceType = {
  Request: 'REQUEST',
  Bid: 'BID',
  Booking: 'BOOKING',
  Conversation: 'CONVERSATION',
  Review: 'REVIEW',
} as const;
export type NotificationResourceType =
  (typeof NotificationResourceType)[keyof typeof NotificationResourceType];
