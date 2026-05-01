-- Sprint 5, slice 5.1: Provider Profile foundation.
-- Strictly additive — adds columns + one enum + one join table to existing
-- provider_profiles surface. No existing data is mutated; columns are
-- nullable and the new availability column defaults to 'OFFLINE' so seeded
-- rows from slice 2.1 keep their semantics (a seeded provider without a
-- linked user is by definition not actively serving).
--
-- Conceptual rollback:
--   DROP TABLE "provider_profile_service_categories";
--   ALTER TABLE "provider_profiles"
--     DROP COLUMN "availability",
--     DROP COLUMN "serviceAreaRadiusKm",
--     DROP COLUMN "serviceAreaLng",
--     DROP COLUMN "serviceAreaLat",
--     DROP COLUMN "serviceAreaCountry",
--     DROP COLUMN "serviceAreaCity",
--     DROP COLUMN "phoneNumber",
--     DROP COLUMN "headline",
--     DROP COLUMN "bio";
--   DROP TYPE "ProviderAvailability";

CREATE TYPE "ProviderAvailability" AS ENUM ('ONLINE', 'OFFLINE', 'PAUSED');

ALTER TABLE "provider_profiles"
  ADD COLUMN "bio"                 TEXT,
  ADD COLUMN "headline"            TEXT,
  ADD COLUMN "phoneNumber"         TEXT,
  ADD COLUMN "serviceAreaCity"     TEXT,
  ADD COLUMN "serviceAreaCountry"  TEXT,
  ADD COLUMN "serviceAreaLat"      DOUBLE PRECISION,
  ADD COLUMN "serviceAreaLng"      DOUBLE PRECISION,
  ADD COLUMN "serviceAreaRadiusKm" INTEGER,
  ADD COLUMN "availability"        "ProviderAvailability" NOT NULL DEFAULT 'OFFLINE';

CREATE INDEX "provider_profiles_availability_idx"    ON "provider_profiles"("availability");
CREATE INDEX "provider_profiles_serviceAreaCity_idx" ON "provider_profiles"("serviceAreaCity");

CREATE TABLE "provider_profile_service_categories" (
    "providerProfileId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profile_service_categories_pkey" PRIMARY KEY ("providerProfileId", "serviceCategoryId")
);

CREATE INDEX "provider_profile_service_categories_serviceCategoryId_idx"
  ON "provider_profile_service_categories"("serviceCategoryId");

ALTER TABLE "provider_profile_service_categories"
  ADD CONSTRAINT "provider_profile_service_categories_providerProfileId_fkey"
  FOREIGN KEY ("providerProfileId") REFERENCES "provider_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_profile_service_categories"
  ADD CONSTRAINT "provider_profile_service_categories_serviceCategoryId_fkey"
  FOREIGN KEY ("serviceCategoryId") REFERENCES "service_categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
