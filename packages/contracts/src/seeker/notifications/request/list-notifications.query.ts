// Optional query parameters for GET /v1/me/notifications. All optional;
// defaults: every notification (read + unread), newest first, page size
// 50. The unread filter drives the drawer's "New" section count without
// a second round-trip.
export interface ListNotificationsQuery {
  unread?: boolean;
  limit?: number;
  cursor?: string;
}
