import type { ProviderCategoryApplicationStatus } from '../enums/provider-category-application-status';

// GET /v1/me/provider/categories/applications?status=
//
// Omitting `status` returns every application the provider has ever made,
// newest first — the history view. Passing one narrows to that state.
export interface ListMyCategoryApplicationsQuery {
  status?: ProviderCategoryApplicationStatus;
}
