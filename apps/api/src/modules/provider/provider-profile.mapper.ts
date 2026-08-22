import type {
  ProviderProfileSummary,
  ProviderServiceCategoryRef,
} from '@homeservicemarketplace/contracts';

import type { ProviderProfileWithCategories } from '../../infrastructure/persistence/bids/provider-profile.repository';

// Single wire mapper for a provider profile.
//
// Lives here rather than inside ProviderService so the onboarding service and
// any future provider surface map the row IDENTICALLY. Duplicating it is how
// one endpoint starts leaking a column another one hides.
//
// The wire shape deliberately omits `userId`, soft-delete columns, and raw
// timestamps, so a future schema change cannot accidentally widen it.
export function toProviderProfileSummary(
  row: ProviderProfileWithCategories,
): ProviderProfileSummary {
  const categories: ProviderServiceCategoryRef[] = row.serviceCategories.map((link) => ({
    id: link.serviceCategory.id,
    slug: link.serviceCategory.slug,
    labelEn: link.serviceCategory.labelEn,
    labelAr: link.serviceCategory.labelAr,
    icon: link.serviceCategory.icon,
  }));
  return {
    id: row.id,
    displayName: row.displayName,
    initials: row.initials,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    headline: row.headline,
    phoneNumber: row.phoneNumber,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    completedJobs: row.completedJobs,
    verified: row.verified,
    topPro: row.topPro,
    availability: row.availability,
    status: row.status,
    serviceAreaCity: row.serviceAreaCity,
    serviceAreaCountry: row.serviceAreaCountry,
    serviceAreaLat: row.serviceAreaLat,
    serviceAreaLng: row.serviceAreaLng,
    serviceAreaRadiusKm: row.serviceAreaRadiusKm,
    serviceCategories: categories,
    // Always present, empty array included. The repository's shared include
    // already filters to live PENDING rows, so a superseded duplicate never
    // shows up here as a second identical chip.
    pendingCategories: row.categoryApplications.map((application) => ({
      id: application.serviceCategory.id,
      slug: application.serviceCategory.slug,
      labelEn: application.serviceCategory.labelEn,
      labelAr: application.serviceCategory.labelAr,
      icon: application.serviceCategory.icon,
    })),
    // Phase 4 — onboarding lifecycle stamps. `submittedForReviewAt` is what
    // separates "a complete application is queued" from "someone pressed
    // Upgrade"; `rejectionReason` is surfaced so a REJECTED provider is told
    // what to fix instead of seeing a generic account-problem message.
    submittedForReviewAt: row.submittedForReviewAt ? row.submittedForReviewAt.toISOString() : null,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    rejectionReason: row.rejectionReason ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
