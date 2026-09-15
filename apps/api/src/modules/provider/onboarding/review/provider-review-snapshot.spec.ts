import type { PrismaTx } from '@homeservicemarketplace/database';

import {
  buildProviderReviewSnapshot,
  readProviderReviewSnapshot,
} from './provider-review-snapshot';

const capturedAt = new Date('2026-09-15T10:00:00.000Z');
type Row = Parameters<typeof buildProviderReviewSnapshot>[0];
const category = { id: 'cat-1', slug: 'painting', labelEn: 'Painting', labelAr: 'دهان' };

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'provider-1',
    displayName: 'Layla',
    providerType: 'INDIVIDUAL',
    legalBusinessName: null,
    profileImageUrl: '/media/avatars/layla.webp',
    phoneNumber: '+963900000000',
    phoneVerifiedAt: null,
    user: { email: 'layla@example.test', emailVerifiedAt: capturedAt },
    headline: 'Painter',
    bio: 'Interior and exterior painting.',
    additionalInformation: 'Weekends by arrangement.',
    yearsOfExperience: 8,
    professionSince: null,
    transportMode: 'CAR',
    transportModes: ['CAR', 'VAN'],
    primaryServiceCategoryId: category.id,
    serviceAreaCountry: 'سوريا',
    serviceAreaCountryCode: 'SY',
    serviceAreaCity: 'دمشق',
    serviceAreaLat: 33.5,
    serviceAreaLng: 36.3,
    serviceAreaRadiusKm: 15,
    workshopAddressLine: 'Workshop address',
    workshopLat: 33.51,
    workshopLng: 36.31,
    acceptedConsentVersion: 'terms-v3',
    consentAcceptedAt: capturedAt,
    onboardingDraft: {
      data: { primaryGroupIds: ['group-1'], timezone: 'Asia/Damascus', internalNote: 'secret' },
    },
    serviceCategories: [],
    categoryApplications: [
      {
        id: 'application-1',
        status: 'PENDING',
        createdAt: capturedAt,
        updatedAt: capturedAt,
        serviceCategory: category,
      },
    ],
    equipment: [{ equipmentItem: { code: 'LADDER' } }],
    serviceAreas: [
      {
        cityId: 'city-1',
        districtId: null,
        neighborhoodId: null,
        city: { labelEn: 'Damascus', labelAr: 'دمشق' },
        district: null,
        neighborhood: null,
      },
    ],
    availabilityIntervals: [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1020, timezone: 'Asia/Damascus' },
    ],
    portfolioItems: [
      {
        id: 'portfolio-1',
        mediaAssetId: 'asset-1',
        revision: 3,
        title: 'Living room',
        description: 'Completed interior work',
        serviceCategoryId: category.id,
        position: 0,
        publicationRightAckAt: capturedAt,
        publicationRightAckText: 'rights-v1',
        moderationState: 'PENDING',
      },
    ],
    ...over,
  };
}

describe('immutable application review snapshot', () => {
  it('captures the submitted answers across all six tasks without inventing verification', () => {
    const snapshot = buildProviderReviewSnapshot(row(), capturedAt);
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      providerProfileId: 'provider-1',
      capturedAt: capturedAt.toISOString(),
      profile: {
        displayName: 'Layla',
        phoneVerifiedAt: null,
        emailVerified: true,
        bio: 'Interior and exterior painting.',
        transportModes: ['CAR', 'VAN'],
      },
      services: {
        primaryGroupIds: ['group-1'],
        primarySpecialtyId: category.id,
        equipmentCodes: ['LADDER'],
        specialties: [{ ...category, state: 'PENDING' }],
      },
      workArea: {
        countryCode: 'SY',
        country: 'سوريا',
        lat: 33.5,
        radiusKm: 15,
        areas: [{ cityId: 'city-1', labelAr: 'دمشق' }],
      },
      availability: {
        timezone: 'Asia/Damascus',
        intervals: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      },
      consent: { acceptedVersion: 'terms-v3', acceptedAt: capturedAt.toISOString() },
      portfolio: [
        { id: 'portfolio-1', mediaAssetId: 'asset-1', revision: 3, moderationState: 'PENDING' },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('holds independent metadata after source relations change', () => {
    const source = row();
    const snapshot = buildProviderReviewSnapshot(source, capturedAt);
    source.displayName = 'Changed';
    source.transportModes.push('TRUCK');
    source.portfolioItems[0].title = 'Replacement';
    source.availabilityIntervals[0].startMinute = 600;
    expect(snapshot.profile.displayName).toBe('Layla');
    expect(snapshot.profile.transportModes).toEqual(['CAR', 'VAN']);
    expect(snapshot.portfolio[0].title).toBe('Living room');
    expect(snapshot.availability.intervals[0].startMinute).toBe(540);
  });

  it.each([
    '/media/verification/identity/passport.jpg',
    'https://cdn.example.test/avatar.jpg?token=credential',
    'https://user:password@example.test/avatar.jpg',
    'javascript:alert(1)',
  ])('never persists a protected or credential-bearing avatar reference: %s', (profileImageUrl) => {
    expect(
      buildProviderReviewSnapshot(row({ profileImageUrl }), capturedAt).profile.profileImageUrl,
    ).toBeNull();
  });

  it('keeps held specialties approved and represents only the latest application per category', () => {
    const source = row();
    source.serviceCategories = [{ serviceCategory: category }];
    source.categoryApplications.push({
      ...source.categoryApplications[0],
      id: 'old-application',
      status: 'REJECTED',
    });
    const specialties = buildProviderReviewSnapshot(source, capturedAt).services.specialties;
    expect(specialties).toHaveLength(1);
    expect(specialties[0]).toMatchObject({
      id: category.id,
      state: 'APPROVED',
      applicationId: 'application-1',
    });
  });

  it('reads through the supplied transaction with an explicit safe select and has no write side effects', async () => {
    const findFirst = jest.fn().mockResolvedValue(row());
    const db = { providerProfile: { findFirst } } as unknown as PrismaTx;
    expect(await readProviderReviewSnapshot(db, 'provider-1', capturedAt)).not.toBeNull();
    const query = findFirst.mock.calls[0][0];
    expect(query.where).toEqual({ id: 'provider-1', deletedAt: null });
    expect(query.select).not.toHaveProperty('verificationCases');
    expect(query.select).not.toHaveProperty('reviewNotes');
    expect(query.select.portfolioItems.where).toEqual({ deletedAt: null });
    expect(JSON.stringify(query.select)).not.toMatch(/storageKey|passwordHash|signedUrl/);
    findFirst.mockResolvedValue(null);
    expect(await readProviderReviewSnapshot(db, 'missing', capturedAt)).toBeNull();
  });
});
