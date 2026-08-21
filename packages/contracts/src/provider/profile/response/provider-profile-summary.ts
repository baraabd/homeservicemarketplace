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
  // The provider's APPROVED skills — what they may actually be matched
  // and bid on. Sprint 2 made this admin-granted only: it changes in
  // response to an approval or an explicit removal, never as a side
  // effect of a profile PATCH.
  serviceCategories: ProviderServiceCategoryRef[];
  // Categories the provider has applied for that are still awaiting admin
  // approval, so the Skills UI can show what is in flight without polling the
  // admin queue.
  //
  // Sprint 2 made this REQUIRED. It was optional while no endpoint populated
  // it, and an optional field that is always absent is indistinguishable from
  // one that is absent because the provider has nothing pending — which is
  // exactly the distinction the Skills screen needs to make. Every provider
  // profile response now carries it, empty array included.
  pendingCategories: ProviderServiceCategoryRef[];
  // Phase 4 — onboarding lifecycle stamps. `submittedForReviewAt` is what
  // distinguishes "a complete application was submitted and is queued" from
  // "someone pressed Upgrade": an upgrade creates a DRAFT with no stamp.
  // `rejectionReason` is surfaced so a REJECTED provider is told what to fix
  // rather than seeing a generic account-problem message — provider standing
  // is a different axis from account standing.
  submittedForReviewAt?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
}
