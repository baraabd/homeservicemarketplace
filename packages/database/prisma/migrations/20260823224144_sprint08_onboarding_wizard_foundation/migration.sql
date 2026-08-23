-- CreateEnum
CREATE TYPE "ProviderType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ProviderTransportMode" AS ENUM ('ON_FOOT', 'MOTORCYCLE', 'CAR', 'VAN', 'TRUCK', 'PUBLIC_TRANSPORT');

-- AlterEnum
ALTER TYPE "ProviderOnboardingState" ADD VALUE 'DOCUMENTS_REQUIRED';

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "acceptedConsentVersion" TEXT,
ADD COLUMN     "additionalInformation" TEXT,
ADD COLUMN     "consentAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "legalBusinessName" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "professionSince" TIMESTAMP(3),
ADD COLUMN     "profileImageUrl" TEXT,
ADD COLUMN     "providerType" "ProviderType",
ADD COLUMN     "transportMode" "ProviderTransportMode",
ADD COLUMN     "workshopAddressLine" TEXT,
ADD COLUMN     "workshopLat" DOUBLE PRECISION,
ADD COLUMN     "workshopLng" DOUBLE PRECISION,
ADD COLUMN     "yearsOfExperience" INTEGER;

-- AlterTable
ALTER TABLE "ServiceCategory" ADD COLUMN     "isLeaf" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "ProviderAvailabilityInterval" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderAvailabilityInterval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentCatalogItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquipmentCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEquipment" (
    "providerProfileId" TEXT NOT NULL,
    "equipmentItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderEquipment_pkey" PRIMARY KEY ("providerProfileId","equipmentItemId")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "cityKey" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "districtKey" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Neighborhood" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "neighborhoodKey" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderServiceArea" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "cityId" TEXT,
    "districtId" TEXT,
    "neighborhoodId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderOnboardingDraft" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "currentStep" TEXT NOT NULL,
    "completedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "data" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "policyVersion" TEXT NOT NULL,
    "lastSavedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderOnboardingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSettingHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "PlatformSettingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderAvailabilityInterval_providerProfileId_dayOfWeek_st_idx" ON "ProviderAvailabilityInterval"("providerProfileId", "dayOfWeek", "startMinute");

-- CreateIndex
CREATE UNIQUE INDEX "EquipmentCatalogItem_code_key" ON "EquipmentCatalogItem"("code");

-- CreateIndex
CREATE INDEX "EquipmentCatalogItem_categoryId_isActive_sortOrder_idx" ON "EquipmentCatalogItem"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "EquipmentCatalogItem_isActive_sortOrder_idx" ON "EquipmentCatalogItem"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "ProviderEquipment_equipmentItemId_idx" ON "ProviderEquipment"("equipmentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "City_cityKey_key" ON "City"("cityKey");

-- CreateIndex
CREATE INDEX "City_countryCode_isActive_sortOrder_idx" ON "City"("countryCode", "isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "District_cityId_isActive_sortOrder_idx" ON "District"("cityId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "District_cityId_districtKey_key" ON "District"("cityId", "districtKey");

-- CreateIndex
CREATE INDEX "Neighborhood_districtId_isActive_sortOrder_idx" ON "Neighborhood"("districtId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Neighborhood_districtId_neighborhoodKey_key" ON "Neighborhood"("districtId", "neighborhoodKey");

-- CreateIndex
CREATE INDEX "ProviderServiceArea_providerProfileId_idx" ON "ProviderServiceArea"("providerProfileId");

-- CreateIndex
CREATE INDEX "ProviderServiceArea_cityId_idx" ON "ProviderServiceArea"("cityId");

-- CreateIndex
CREATE INDEX "ProviderServiceArea_districtId_idx" ON "ProviderServiceArea"("districtId");

-- CreateIndex
CREATE INDEX "ProviderServiceArea_neighborhoodId_idx" ON "ProviderServiceArea"("neighborhoodId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderOnboardingDraft_providerProfileId_key" ON "ProviderOnboardingDraft"("providerProfileId");

-- CreateIndex
CREATE INDEX "PlatformSettingHistory_key_changedAt_idx" ON "PlatformSettingHistory"("key", "changedAt");

-- CreateIndex
CREATE INDEX "PlatformSettingHistory_changedAt_idx" ON "PlatformSettingHistory"("changedAt");

-- CreateIndex
CREATE INDEX "ServiceCategory_parentId_sortOrder_idx" ON "ServiceCategory"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ServiceCategory_isLeaf_isActive_idx" ON "ServiceCategory"("isLeaf", "isActive");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderAvailabilityInterval" ADD CONSTRAINT "ProviderAvailabilityInterval_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentCatalogItem" ADD CONSTRAINT "EquipmentCatalogItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEquipment" ADD CONSTRAINT "ProviderEquipment_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEquipment" ADD CONSTRAINT "ProviderEquipment_equipmentItemId_fkey" FOREIGN KEY ("equipmentItemId") REFERENCES "EquipmentCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Neighborhood" ADD CONSTRAINT "Neighborhood_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderServiceArea" ADD CONSTRAINT "ProviderServiceArea_neighborhoodId_fkey" FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderOnboardingDraft" ADD CONSTRAINT "ProviderOnboardingDraft_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Sprint 8 — integrity constraints Prisma's schema language cannot express.
--
-- Every table referenced here is created by this migration, so none of these
-- can fail on existing data. Each encodes an invariant that is cheap to state
-- now and expensive to discover later from rows that already violate it.
-- ---------------------------------------------------------------------------

-- A service area is a city OR a district OR a neighborhood — exactly one.
--
-- A row with two set has no defined meaning and would be counted twice by
-- every area query; a row with none set is a service area covering nothing,
-- which silently shrinks a provider's reach with no visible cause.
ALTER TABLE "ProviderServiceArea"
  ADD CONSTRAINT "provider_service_area_exactly_one_scope"
  CHECK (
    (("cityId" IS NOT NULL)::int
     + ("districtId" IS NOT NULL)::int
     + ("neighborhoodId" IS NOT NULL)::int) = 1
  );

-- Day of week matches JS getDay(): 0 = Sunday .. 6 = Saturday.
ALTER TABLE "ProviderAvailabilityInterval"
  ADD CONSTRAINT "provider_availability_day_in_range"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- Minutes from local midnight, end EXCLUSIVE and strictly after start.
--
-- An interval that ends before it begins matches nothing, and one that ends
-- exactly when it begins is a zero-length window that reads as availability
-- in a list while never matching a booking.
ALTER TABLE "ProviderAvailabilityInterval"
  ADD CONSTRAINT "provider_availability_minutes_in_range"
  CHECK (
    "startMinute" >= 0
    AND "endMinute" <= 1440
    AND "startMinute" < "endMinute"
  );

-- Exact duplicates of the same window are always a mistake.
--
-- This does NOT prevent partial OVERLAP — 09:00-12:00 alongside 11:00-14:00
-- still inserts. Catching that in the database would need an EXCLUDE
-- constraint over int4range, which requires the btree_gist extension, and
-- adding an extension is the kind of infrastructure change ADR 0003 declined
-- to make without evidence. Overlap is therefore validated in the service on
-- every write, with the full set of cases tested; this index closes the
-- cheapest and most common half at zero cost.
CREATE UNIQUE INDEX "provider_availability_no_exact_duplicate"
  ON "ProviderAvailabilityInterval" ("providerProfileId", "dayOfWeek", "startMinute", "endMinute");

-- Experience is a numeric fact, and both ends of the range are absurd.
-- Negative is impossible; a century of trade experience is a typo.
ALTER TABLE "ProviderProfile"
  ADD CONSTRAINT "provider_years_of_experience_sane"
  CHECK ("yearsOfExperience" IS NULL OR ("yearsOfExperience" >= 0 AND "yearsOfExperience" <= 80));

-- A profession cannot have started in the future.
ALTER TABLE "ProviderProfile"
  ADD CONSTRAINT "provider_profession_since_not_future"
  CHECK ("professionSince" IS NULL OR "professionSince" <= now());

-- Consent is a version AND a timestamp, or neither. Half a consent record
-- cannot answer "what did they agree to, and when", which is the only reason
-- to keep it.
ALTER TABLE "ProviderProfile"
  ADD CONSTRAINT "provider_consent_consistent"
  CHECK (("acceptedConsentVersion" IS NULL) = ("consentAcceptedAt" IS NULL));

-- Workshop coordinates travel together and must be on the planet.
ALTER TABLE "ProviderProfile"
  ADD CONSTRAINT "provider_workshop_coords_paired_and_valid"
  CHECK (
    (("workshopLat" IS NULL) = ("workshopLng" IS NULL))
    AND ("workshopLat" IS NULL OR ("workshopLat" BETWEEN -90 AND 90))
    AND ("workshopLng" IS NULL OR ("workshopLng" BETWEEN -180 AND 180))
  );

-- The optimistic-concurrency token only ever moves forward.
ALTER TABLE "ProviderOnboardingDraft"
  ADD CONSTRAINT "provider_onboarding_draft_version_non_negative"
  CHECK ("version" >= 0);

-- A draft judged under no policy version cannot be judged at all.
ALTER TABLE "ProviderOnboardingDraft"
  ADD CONSTRAINT "provider_onboarding_draft_policy_version_present"
  CHECK (length(btrim("policyVersion")) > 0);

-- A category cannot be its own parent. Deeper cycles are prevented in the
-- admin service, which walks the ancestor chain on every parent change; this
-- catches the one-hop case for free and independently of application code.
ALTER TABLE "ServiceCategory"
  ADD CONSTRAINT "service_category_not_own_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");
