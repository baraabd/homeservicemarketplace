import type { ProviderAvailability } from '../enums/provider-availability';

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
  serviceAreaCity: string | null;
  serviceAreaCountry: string | null;
  serviceAreaLat: number | null;
  serviceAreaLng: number | null;
  serviceAreaRadiusKm: number | null;
  serviceCategories: ProviderServiceCategoryRef[];
  createdAt: string;
  updatedAt: string;
}
