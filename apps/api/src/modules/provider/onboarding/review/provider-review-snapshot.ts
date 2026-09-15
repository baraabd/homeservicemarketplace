import type { ProviderReviewSnapshot } from '@homeservicemarketplace/contracts';
import type { Prisma, PrismaTx } from '@homeservicemarketplace/database';

import { referencesRestrictedMedia } from '../avatar/avatar-policy';

const CATEGORY_SELECT = { id: true, slug: true, labelEn: true, labelAr: true } as const;

/** An allowlist, not a model spread. Evidence, secrets and internal review notes never enter this read. */
const REVIEW_SELECT = {
  id: true,
  displayName: true,
  profileImageUrl: true,
  providerType: true,
  legalBusinessName: true,
  phoneNumber: true,
  phoneVerifiedAt: true,
  user: { select: { email: true, emailVerifiedAt: true } },
  headline: true,
  bio: true,
  additionalInformation: true,
  yearsOfExperience: true,
  professionSince: true,
  transportMode: true,
  transportModes: true,
  primaryServiceCategoryId: true,
  serviceAreaCountry: true,
  serviceAreaCountryCode: true,
  serviceAreaCity: true,
  serviceAreaLat: true,
  serviceAreaLng: true,
  serviceAreaRadiusKm: true,
  workshopAddressLine: true,
  workshopLat: true,
  workshopLng: true,
  acceptedConsentVersion: true,
  consentAcceptedAt: true,
  onboardingDraft: { select: { data: true } },
  serviceCategories: {
    orderBy: { serviceCategoryId: 'asc' },
    select: { serviceCategory: { select: CATEGORY_SELECT } },
  },
  categoryApplications: {
    where: { supersededAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      serviceCategory: { select: CATEGORY_SELECT },
    },
  },
  equipment: {
    orderBy: { equipmentItemId: 'asc' },
    select: { equipmentItem: { select: { code: true } } },
  },
  serviceAreas: {
    orderBy: { id: 'asc' },
    select: {
      cityId: true,
      districtId: true,
      neighborhoodId: true,
      city: { select: { labelEn: true, labelAr: true } },
      district: { select: { labelEn: true, labelAr: true } },
      neighborhood: { select: { labelEn: true, labelAr: true } },
    },
  },
  availabilityIntervals: {
    orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    select: { dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
  },
  portfolioItems: {
    where: { deletedAt: null },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      mediaAssetId: true,
      revision: true,
      title: true,
      description: true,
      serviceCategoryId: true,
      position: true,
      publicationRightAckAt: true,
      publicationRightAckText: true,
      moderationState: true,
    },
  },
} satisfies Prisma.ProviderProfileSelect;

type ReviewRow = Prisma.ProviderProfileGetPayload<{ select: typeof REVIEW_SELECT }>;

/** Read-only for Admin dossier queries; submission passes its transaction to capture the same metadata. */
export async function readProviderReviewSnapshot(
  db: PrismaTx,
  providerProfileId: string,
  capturedAt = new Date(),
): Promise<ProviderReviewSnapshot | null> {
  const row = await db.providerProfile.findFirst({
    where: { id: providerProfileId, deletedAt: null },
    select: REVIEW_SELECT,
  });
  return row ? buildProviderReviewSnapshot(row, capturedAt) : null;
}

export function buildProviderReviewSnapshot(
  row: ReviewRow,
  capturedAt: Date,
): ProviderReviewSnapshot {
  const scratch = jsonObject(row.onboardingDraft?.data);
  const specialties: ProviderReviewSnapshot['services']['specialties'] = [];
  const held = new Set(row.serviceCategories.map((entry) => entry.serviceCategory.id));
  const represented = new Set<string>();
  for (const application of row.categoryApplications) {
    const category = application.serviceCategory;
    // The most recent request is the display state. Historical attempts remain in their own audit trail.
    if (represented.has(category.id)) continue;
    represented.add(category.id);
    specialties.push({
      ...category,
      state: held.has(category.id) ? 'APPROVED' : application.status,
      applicationId: application.id,
      requestedAt: application.createdAt.toISOString(),
      reviewedAt: application.status === 'PENDING' ? null : application.updatedAt.toISOString(),
    });
  }
  for (const { serviceCategory: category } of row.serviceCategories) {
    if (represented.has(category.id)) continue;
    specialties.push({
      ...category,
      state: 'APPROVED',
      applicationId: null,
      requestedAt: null,
      reviewedAt: null,
    });
  }
  specialties.sort((a, b) => a.id.localeCompare(b.id));

  return {
    schemaVersion: 1,
    capturedAt: capturedAt.toISOString(),
    providerProfileId: row.id,
    profile: {
      displayName: row.displayName,
      profileImageUrl: publicAvatarReference(row.profileImageUrl),
      providerType: row.providerType,
      legalBusinessName: row.legalBusinessName,
      phoneNumber: row.phoneNumber,
      phoneVerifiedAt: iso(row.phoneVerifiedAt),
      email: row.user?.email ?? null,
      emailVerified: row.user?.emailVerifiedAt != null,
      headline: row.headline,
      bio: row.bio,
      additionalInformation: row.additionalInformation,
      yearsOfExperience: row.yearsOfExperience,
      professionSince: iso(row.professionSince),
      transportMode: row.transportMode,
      transportModes: [...row.transportModes],
    },
    services: {
      primaryGroupIds: strings(scratch.primaryGroupIds),
      primarySpecialtyId: row.primaryServiceCategoryId,
      specialties,
      equipmentCodes: row.equipment.map((entry) => entry.equipmentItem.code),
    },
    workArea: {
      country: row.serviceAreaCountry,
      countryCode: row.serviceAreaCountryCode,
      city: row.serviceAreaCity,
      lat: row.serviceAreaLat,
      lng: row.serviceAreaLng,
      radiusKm: row.serviceAreaRadiusKm,
      workshopAddressLine: row.workshopAddressLine,
      workshopLat: row.workshopLat,
      workshopLng: row.workshopLng,
      areas: row.serviceAreas.map((area) => ({
        cityId: area.cityId,
        districtId: area.districtId,
        neighborhoodId: area.neighborhoodId,
        labelEn: (area.neighborhood ?? area.district ?? area.city)?.labelEn ?? null,
        labelAr: (area.neighborhood ?? area.district ?? area.city)?.labelAr ?? null,
      })),
    },
    availability: {
      timezone:
        row.availabilityIntervals[0]?.timezone ??
        (typeof scratch.timezone === 'string' ? scratch.timezone : null),
      intervals: row.availabilityIntervals.map((interval) => ({ ...interval })),
    },
    consent: {
      acceptedVersion: row.acceptedConsentVersion,
      acceptedAt: iso(row.consentAcceptedAt),
    },
    portfolio: row.portfolioItems.map((item) => ({
      id: item.id,
      mediaAssetId: item.mediaAssetId,
      revision: item.revision,
      title: item.title,
      description: item.description,
      serviceCategoryId: item.serviceCategoryId,
      position: item.position,
      publicationRightAckAt: iso(item.publicationRightAckAt),
      publicationRightAckVersion: item.publicationRightAckText,
      moderationState: item.moderationState,
    })),
  };
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function jsonObject(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function strings(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function publicAvatarReference(value: string | null): string | null {
  if (!value || referencesRestrictedMedia(value)) return null;
  // Old profile URL inputs may contain an expiring credential. Such URLs are never durable review data.
  try {
    const url = new URL(value, 'https://relative.invalid');
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return value;
  } catch {
    return null;
  }
}
