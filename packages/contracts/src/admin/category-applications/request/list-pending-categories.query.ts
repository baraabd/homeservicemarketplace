import type { ProviderCategoryApplicationStatus } from '../enums/provider-category-application-status';

// GET /v1/admin/category-applications query string.
//
// Defaults to status=PENDING — that's the admin queue surface. Pass
// status=APPROVED|REJECTED to inspect history. limit defaults to 20
// server-side; cursor-paginate by passing the last item id from the
// previous page.
export interface ListPendingCategoriesQuery {
  status?: ProviderCategoryApplicationStatus;
  limit?: number;
  cursor?: string;
}
