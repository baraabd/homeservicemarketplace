// Realtime channel (Sprint 7.0). One server-sent endpoint:
//
//   GET /v1/me/events   text/event-stream — JWT-guarded; emits
//                                            JSON `RealtimeEvent`
//                                            payloads as
//                                            `data:` lines.
//
// Versioned envelope so the bus can evolve without breaking
// connected clients. The payload mirrors the existing REST response
// shapes — clients drop them straight into their React Query cache.
export type RealtimeEventType =
  | 'notification.created'
  | 'message.created'
  | 'booking.status_changed'
  | 'bid.status_changed';

export interface RealtimeEvent<T = unknown> {
  v: 1;
  type: RealtimeEventType;
  userId: string;
  occurredAt: string;
  payload: T;
}
