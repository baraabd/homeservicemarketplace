-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DEAD');

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "serviceAreaCityKey" TEXT;

-- AlterTable
ALTER TABLE "ServiceRequest" ADD COLUMN     "locationCityKey" TEXT,
ADD COLUMN     "locationLat" DOUBLE PRECISION,
ADD COLUMN     "locationLng" DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- Sprint 6 backfill. Forward-only, additive, and non-destructive: it only ever
-- writes the three new columns, and it reads from data that is already there.
-- No existing column is modified and no row is deleted, so the rollback for
-- this migration is "stop reading the new columns" — see the ADR.
--
-- Done BEFORE the indexes below are created: backfilling first and indexing
-- after is one pass over the heap plus one index build, rather than an index
-- maintained row-by-row through the whole UPDATE.
-- ---------------------------------------------------------------------------

-- ServiceRequest: promote the queryable fields out of the addressSnapshot JSON.
--
-- cityKey: prefer the denormalised snapshot key; fall back to normalising
-- `city` the same way the application does (btrim + lower) for the legacy rows
-- written before cityKey existed. NULLIF collapses '' to NULL so "no city" is
-- one value rather than two.
--
-- lat/lng: only promoted when the JSON value really is a number AND inside the
-- valid coordinate range. A malformed snapshot must land as NULL — which the
-- predicate treats as "unknown location" and falls back on city — rather than
-- as a coordinate that silently places the request off the planet.
UPDATE "ServiceRequest"
SET
  "locationCityKey" = COALESCE(
    NULLIF(btrim(lower("addressSnapshot" ->> 'cityKey')), ''),
    NULLIF(btrim(lower("addressSnapshot" ->> 'city')), '')
  ),
  "locationLat" = CASE
    WHEN jsonb_typeof("addressSnapshot" -> 'lat') = 'number'
     AND abs(("addressSnapshot" ->> 'lat')::double precision) <= 90
    THEN ("addressSnapshot" ->> 'lat')::double precision
  END,
  "locationLng" = CASE
    WHEN jsonb_typeof("addressSnapshot" -> 'lng') = 'number'
     AND abs(("addressSnapshot" ->> 'lng')::double precision) <= 180
    THEN ("addressSnapshot" ->> 'lng')::double precision
  END
WHERE "addressSnapshot" IS NOT NULL;

-- ProviderProfile: normalised mirror of the display-cased service-area city.
UPDATE "ProviderProfile"
SET "serviceAreaCityKey" = NULLIF(btrim(lower("serviceAreaCity")), '')
WHERE "serviceAreaCity" IS NOT NULL;

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "lastError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxHandlerRun" (
    "eventId" TEXT NOT NULL,
    "handler" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxHandlerRun_pkey" PRIMARY KEY ("eventId","handler")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_claimedAt_idx" ON "OutboxEvent"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "ProviderProfile_status_deletedAt_serviceAreaCityKey_idx" ON "ProviderProfile"("status", "deletedAt", "serviceAreaCityKey");

-- CreateIndex
CREATE INDEX "ProviderProfile_status_deletedAt_serviceAreaLat_serviceArea_idx" ON "ProviderProfile"("status", "deletedAt", "serviceAreaLat", "serviceAreaLng");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_deletedAt_locationCityKey_idx" ON "ServiceRequest"("status", "deletedAt", "locationCityKey");

-- CreateIndex
CREATE INDEX "ServiceRequest_status_deletedAt_locationLat_locationLng_idx" ON "ServiceRequest"("status", "deletedAt", "locationLat", "locationLng");

-- AddForeignKey
ALTER TABLE "OutboxHandlerRun" ADD CONSTRAINT "OutboxHandlerRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OutboxEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
