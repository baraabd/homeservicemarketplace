// Lightweight envelope returned by GET /v1/me/notifications/unread-count.
// Drives the red badge on the bell icon without forcing a list refetch.
export interface NotificationUnreadCountResponse {
  count: number;
}
