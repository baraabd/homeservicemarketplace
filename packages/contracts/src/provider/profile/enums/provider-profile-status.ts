// Frontend-safe mirror of the Prisma `ProviderProfileStatus` enum
// (Sprint 5.1.2). Drives the Provider app's onboarding/pending/active/
// locked surfaces and the future marketplace guard. Independent of
// `ProviderAvailability` (the live ONLINE/OFFLINE/PAUSED working toggle).
//
//  DRAFT          profile created, onboarding incomplete
//  PENDING_REVIEW awaiting admin approval (production gating point)
//  ACTIVE         approved; visible in marketplace and allowed to bid
//  SUSPENDED      temporarily blocked by admin
//  REJECTED       application denied by admin
export const ProviderProfileStatus = {
  Draft: 'DRAFT',
  PendingReview: 'PENDING_REVIEW',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  Rejected: 'REJECTED',
} as const;
export type ProviderProfileStatus =
  (typeof ProviderProfileStatus)[keyof typeof ProviderProfileStatus];
