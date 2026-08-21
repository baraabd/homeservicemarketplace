import type { ProviderCategoryApplicationSummary } from './provider-category-application-summary';

// GET /v1/me/provider/categories/applications
//
// Scoped to the caller's own profile by the session — there is no provider id
// in the request, so there is no id to tamper with. Not paginated: a provider
// applies for skills from a catalog of tens, so the natural bound is small and
// a cursor would be ceremony. If the catalog ever grows, this gains a cursor
// the same way the admin queue has one.
export interface ListMyCategoryApplicationsResponse {
  items: ProviderCategoryApplicationSummary[];
}
