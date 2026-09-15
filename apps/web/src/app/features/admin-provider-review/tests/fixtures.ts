import type {
  AdminProviderReview,
  ProviderReviewSnapshot,
} from '@homeservicemarketplace/contracts';
export const STAMP = '2026-09-14T09:30:00.000Z';
export function snapshot(): ProviderReviewSnapshot {
  return {
    schemaVersion: 1,
    capturedAt: STAMP,
    providerProfileId: 'provider-1',
    profile: {
      displayName: 'Submitted provider',
      profileImageUrl: null,
      providerType: 'INDIVIDUAL',
      legalBusinessName: null,
      phoneNumber: '+963900000111',
      phoneVerifiedAt: null,
      email: 'submitted@example.test',
      emailVerified: true,
      headline: 'Submitted headline',
      bio: 'Submitted biography',
      additionalInformation: null,
      yearsOfExperience: 5,
      professionSince: '2021-01-01',
      transportMode: null,
      transportModes: ['CAR'],
    },
    services: {
      primaryGroupIds: ['home'],
      primarySpecialtyId: 'electrical',
      equipmentCodes: [],
      specialties: [
        {
          id: 'electrical',
          slug: 'electrical',
          labelEn: 'Electrical work',
          labelAr: 'أعمال الكهرباء',
          state: 'APPROVED',
          applicationId: null,
          requestedAt: STAMP,
          reviewedAt: STAMP,
        },
      ],
    },
    workArea: {
      country: 'Syria',
      countryCode: 'SY',
      city: 'Damascus',
      lat: null,
      lng: null,
      radiusKm: 10,
      workshopAddressLine: null,
      workshopLat: null,
      workshopLng: null,
      areas: [],
    },
    availability: {
      timezone: 'Asia/Damascus',
      intervals: [{ dayOfWeek: 0, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' }],
    },
    consent: { acceptedVersion: 'terms-v1', acceptedAt: STAMP },
    portfolio: [],
  };
}
export function reviewFixture(): AdminProviderReview {
  const saved = snapshot();
  const current = snapshot();
  current.profile.bio = 'Changed current biography';
  return {
    provider: {
      id: 'provider-1',
      userId: 'owner-1',
      displayName: 'Current provider',
      email: 'current@example.test',
      accountStatus: 'ACTIVE',
      providerStatus: 'PENDING_REVIEW',
      onboardingState: 'DOCUMENTS_REQUIRED',
      verificationState: 'PENDING',
      standingState: 'NORMAL',
    },
    revision: 'a'.repeat(64),
    submission: {
      id: 'submission-1',
      submittedAt: STAMP,
      policyVersion: 'policy-v1',
      decision: null,
      decidedAt: null,
      snapshot: saved,
      feedback: null,
    },
    current,
    verification: null,
    categoryApplications: [],
    capabilities: {
      allowed: [],
      capabilities: [{ capability: 'SUBMIT_BID', allowed: false, reason: 'AWAITING_REVIEW' }],
      nextActions: ['WAIT_FOR_REVIEW'],
      primaryReason: 'AWAITING_REVIEW',
    },
    canWork: false,
    availableActions: ['approve', 'requestChanges'],
    blockers: [],
    permissions: { canViewEvidence: true, canDecide: true, canModeratePortfolio: true },
  };
}
