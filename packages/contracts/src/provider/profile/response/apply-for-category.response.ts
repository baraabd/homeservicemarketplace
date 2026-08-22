import type { ProviderCategoryApplicationSummary } from './provider-category-application-summary';

// POST /v1/me/provider/categories/applications
//
// 201 with the created PENDING application. The provider's approved skill set
// is deliberately NOT returned: applying changes nothing about what the
// provider can currently do, and returning the profile here would invite the
// client to believe otherwise.
export interface ApplyForCategoryResponse {
  application: ProviderCategoryApplicationSummary;
}
