import type { PendingCategorySummary } from './pending-category-summary';

// Cursor-paginated list response for the admin category-application
// queue. `nextCursor` is the id of the last item in this page when a
// further page may exist; null when this is the last page.
export interface ListPendingCategoriesResponse {
  items: PendingCategorySummary[];
  nextCursor: string | null;
}
