/** Immutable application metadata. Never contains identity evidence, storage keys or read credentials. */
export interface ProviderReviewSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  providerProfileId: string;
  profile: {
    displayName: string;
    profileImageUrl: string | null;
    providerType: 'INDIVIDUAL' | 'BUSINESS' | null;
    legalBusinessName: string | null;
    phoneNumber: string | null;
    phoneVerifiedAt: string | null;
    email: string | null;
    emailVerified: boolean;
    headline: string | null;
    bio: string | null;
    additionalInformation: string | null;
    yearsOfExperience: number | null;
    professionSince: string | null;
    transportMode: string | null;
    transportModes: string[];
  };
  services: {
    primaryGroupIds: string[];
    primarySpecialtyId: string | null;
    specialties: Array<{
      id: string;
      slug: string;
      labelEn: string;
      labelAr: string;
      state: 'APPROVED' | 'PENDING' | 'REJECTED';
      applicationId: string | null;
      requestedAt: string | null;
      reviewedAt: string | null;
    }>;
    equipmentCodes: string[];
  };
  workArea: {
    country: string | null;
    countryCode: string | null;
    city: string | null;
    lat: number | null;
    lng: number | null;
    radiusKm: number | null;
    workshopAddressLine: string | null;
    workshopLat: number | null;
    workshopLng: number | null;
    areas: Array<{
      cityId: string | null;
      districtId: string | null;
      neighborhoodId: string | null;
      labelEn?: string | null;
      labelAr?: string | null;
    }>;
  };
  availability: {
    timezone: string | null;
    intervals: Array<{
      dayOfWeek: number;
      startMinute: number;
      endMinute: number;
      timezone: string;
    }>;
  };
  consent: { acceptedVersion: string | null; acceptedAt: string | null };
  portfolio: Array<{
    id: string;
    mediaAssetId: string;
    revision: number;
    title: string | null;
    description: string | null;
    serviceCategoryId: string | null;
    position: number;
    publicationRightAckAt: string | null;
    publicationRightAckVersion: string | null;
    moderationState: 'PENDING' | 'APPROVED' | 'REJECTED';
  }>;
}
