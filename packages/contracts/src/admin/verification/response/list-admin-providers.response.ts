import type { AdminProviderSummary } from './admin-provider-summary';

export interface ListAdminProvidersResponse {
  items: AdminProviderSummary[];
  nextCursor: string | null;
  /** Exact count across all pages with the selected filters. Always sent by current API. */
  total?: number;
  /** Same scope/search filters, before status selection; never page-length totals. */
  counts?: {
    all: number;
    pendingReview: number;
    active: number;
    returned: number;
    suspended: number;
    draft: number;
  };
}
