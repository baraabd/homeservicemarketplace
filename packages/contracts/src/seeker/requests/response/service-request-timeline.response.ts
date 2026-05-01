import type { ServiceRequestEventType } from '../enums/service-request-event-type';

// One row of the request lifecycle timeline.
//
// `actorUserId` is intentionally NOT exposed here. The frontend has no
// business knowing user ids of other actors, and for slice 3 every
// event is authored by the request owner anyway. Future slices can
// replace `actorRole` with a richer DTO when bids/bookings introduce
// Provider-authored events.
export interface ServiceRequestTimelineEvent {
  id: string;
  type: ServiceRequestEventType;
  // Free-form metadata bag — the writer enforces shape per event type.
  // Currently empty for create/cancel/reopen and carries the changed
  // field set for REQUEST_UPDATED. Treat as opaque and forwards-
  // compatible.
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// GET /v1/me/requests/:requestId/timeline
//
// Events are returned in chronological order (oldest first) so a
// straightforward render-as-list call site shows the request's history
// from posted → updated → cancelled / reopened. Documented here so
// reverse-order consumers know to re-sort instead of depending on
// implementation order.
export interface ServiceRequestTimelineResponse {
  items: ServiceRequestTimelineEvent[];
}
