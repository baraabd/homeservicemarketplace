// Booking timeline event types. Mirrors the Prisma `BookingEventType`
// enum so the wire shape is identical to the persisted shape — no
// mapping at the boundary.
//
// Slice 2.3 emits BOOKING_CREATED (from inside the accept-bid
// transaction) and BOOKING_CANCELLED. The remaining types are pinned
// now so future slices (Provider tracking, reschedule) don't force
// another contract bump.
export const BookingEventType = {
  BookingCreated: 'BOOKING_CREATED',
  BookingCancelled: 'BOOKING_CANCELLED',
  BookingStatusChanged: 'BOOKING_STATUS_CHANGED',
  BookingRescheduled: 'BOOKING_RESCHEDULED',
} as const;
export type BookingEventType = (typeof BookingEventType)[keyof typeof BookingEventType];
