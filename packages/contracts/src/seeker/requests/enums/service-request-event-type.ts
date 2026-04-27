// Append-only lifecycle event types written to the request timeline.
// Slice 3 emits only the four events listed below; future slices will
// extend the enum (BID_PLACED, BOOKING_CONFIRMED, etc.) — keep the set
// minimal until those slices land.
export const ServiceRequestEventType = {
  RequestCreated: 'REQUEST_CREATED',
  RequestUpdated: 'REQUEST_UPDATED',
  RequestCancelled: 'REQUEST_CANCELLED',
  RequestReopened: 'REQUEST_REOPENED',
} as const;
export type ServiceRequestEventType =
  (typeof ServiceRequestEventType)[keyof typeof ServiceRequestEventType];
