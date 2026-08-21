import type { ProviderProfileStatus } from '../../../provider/profile/enums/provider-profile-status';

// Admin-facing summary of one provider profile. Differs from the
// public ProviderProfileSummary in that it surfaces the linked
// userId + email so the admin can connect the dots between the
// account and the profile.
export interface AdminProviderSummary {
  id: string;
  status: ProviderProfileStatus;
  userId: string | null;
  email: string | null;
  displayName: string;
  initials: string;
  ratingAvg: number;
  reviewCount: number;
  completedJobs: number;
  verified: boolean;
  topPro: boolean;
  serviceAreaCity: string | null;
  serviceAreaCountry: string | null;
  // Sprint 6.2 — admin-facing review notes (free text). Distinct from
  // the audit history; this is the reviewer's pinned context.
  reviewNotes: string | null;
  // Phase 4 — the submitted onboarding snapshot the reviewer decides on.
  // Without these the admin screen could not tell a DRAFT profile apart from
  // an application that was actually submitted for review.
  submittedForReviewAt?: string | null;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
  rejectionReason?: string | null;
  headline?: string | null;
  bio?: string | null;
  phoneNumber?: string | null;
  serviceAreaRadiusKm?: number | null;
  serviceCategories?: Array<{ id: string; slug: string; labelEn: string; labelAr: string }>;
  createdAt: string;
  updatedAt: string;
}
