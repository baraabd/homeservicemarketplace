import type { ProviderAvailability } from '../enums/provider-availability';
import type { ProviderProfileStatus } from '../enums/provider-profile-status';

// One service category as it appears on a Provider profile. The seeker
// catalog ships a richer ServiceCategorySummary with localized labels;
// here we expose the same id + slug + bilingual labels so the Provider
// app can render skill chips without an extra round-trip.
export interface ProviderServiceCategoryRef {
  id: string;
  slug: string;
  labelEn: string;
  labelAr: string;
  icon: string;
}

// The denormalised Provider read-model returned by every provider-side
// profile endpoint. `userId` is intentionally NOT exposed — the Provider
// app only ever cares about the profile id and what's renderable. PII
// kept off the wire stays off.
export interface ProviderProfileSummary {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  bio: string | null;
  headline: string | null;
  phoneNumber: string | null;
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
  topPro: boolean;
  availability: ProviderAvailability;
  // Marketplace-readiness state. ACTIVE means the profile is approved and
  // can bid; DRAFT / PENDING_REVIEW are pre-approval states; SUSPENDED /
  // REJECTED are admin-applied lock states. The Provider app branches on
  // this field to render the right onboarding / pending / locked / live
  // surface; it is independent of `availability` (the live working
  // ONLINE/OFFLINE/PAUSED toggle).
  status: ProviderProfileStatus;
  serviceAreaCity: string | null;
  serviceAreaCountry: string | null;
  serviceAreaLat: number | null;
  serviceAreaLng: number | null;
  serviceAreaRadiusKm: number | null;
  serviceCategories: ProviderServiceCategoryRef[];
  createdAt: string;
  updatedAt: string;
}
