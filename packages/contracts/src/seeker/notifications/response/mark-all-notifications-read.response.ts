// POST /v1/me/notifications/read-all returns the number of rows that
// flipped from unread → read in this call. Idempotent: re-running with
// nothing unread returns `{ updatedCount: 0 }` without error.
export interface MarkAllNotificationsReadResponse {
  updatedCount: number;
}
