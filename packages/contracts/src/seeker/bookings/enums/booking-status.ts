// Lifecycle states for a booking. Mirrors the Prisma `BookingStatus`
// enum so the wire shape is identical to the persisted shape — no
// mapping at the boundary.
//
// Slice 2.2 only emits SCHEDULED (set on accept-bid). Subsequent
// slices add the IN_PROGRESS / COMPLETED / CANCELLED transitions
// when bookings, tracking, and cancellation flows ship.
export const BookingStatus = {
  Scheduled: 'SCHEDULED',
  InProgress: 'IN_PROGRESS',
  Completed: 'COMPLETED',
  Cancelled: 'CANCELLED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];
