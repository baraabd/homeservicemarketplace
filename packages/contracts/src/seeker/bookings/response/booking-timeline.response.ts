import type { BookingEventType } from '../enums/booking-event-type';

// One row on the booking's append-only audit timeline. `metadata` is
// a typed-by-event JSON blob — the writer (BookingsService) controls
// the keys so the renderer can switch on `type` and read known
// fields. Always serialised to ISO-8601 on the wire.
export interface BookingTimelineEvent {
  id: string;
  type: BookingEventType;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface BookingTimelineResponse {
  items: BookingTimelineEvent[];
}
