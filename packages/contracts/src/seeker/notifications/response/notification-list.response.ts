import type { NotificationSummary } from './notification-summary';

// Standard envelope. `nextCursor` is non-null when more rows exist
// beyond the current page; the drawer uses it for infinite scroll in
// a future slice. Slice 3.1 returns the first 50 in one envelope.
export interface NotificationListResponse {
  items: NotificationSummary[];
  nextCursor: string | null;
}
