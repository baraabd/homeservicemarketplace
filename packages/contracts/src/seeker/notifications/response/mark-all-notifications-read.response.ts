// POST /v1/me/notifications/read-all returns the number of rows that
// flipped from unread → read in this call. Idempotent: re-running the same
// selection returns `{ updatedCount: 0 }` without error (R17-B: never more
// than the rows named in the request).
export interface MarkAllNotificationsReadResponse {
  updatedCount: number;
}
