import type { NotificationSummary } from './notification-summary';

// POST /v1/me/notifications/:id/read returns the notification with
// `readAt` set. Idempotent — re-marking an already-read row returns
// the same shape (the original `readAt` timestamp is preserved).
export interface MarkNotificationReadResponse {
  notification: NotificationSummary;
}
