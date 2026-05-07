import type { ProviderCategoryApplicationStatus } from '../enums/provider-category-application-status';

// One row of the admin queue surface for ProviderCategoryApplication.
//
// Carries enough provider + category context for the admin to make a
// decision without an extra round-trip:
//   - providerProfileId / providerDisplayName so the queue is
//     scannable by name (the linked userId stays off the wire — admins
//     work from the profile id).
//   - serviceCategoryId / serviceCategorySlug + bilingual labels so
//     the chip can be rendered in the queue UI directly.
//   - createdAt is when the provider applied; updatedAt is the last
//     transition (initial create OR admin review).
//
// Status is included so the same shape works for both the queue
// (PENDING) and the audit views (APPROVED / REJECTED) without
// branching the response type.
export interface PendingCategorySummary {
  id: string;
  providerProfileId: string;
  providerDisplayName: string;
  serviceCategoryId: string;
  serviceCategorySlug: string;
  serviceCategoryLabelEn: string;
  serviceCategoryLabelAr: string;
  status: ProviderCategoryApplicationStatus;
  createdAt: string;
  updatedAt: string;
}
