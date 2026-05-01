-- Sprint 1, slice 2 — evolve the existing addresses table to the
-- saved-address contract. The original table was created on 2026-04-19
-- with a US-centric schema (street/state/zipCode/latitude/longitude);
-- the slice-2 contract uses (label NOT NULL, type, line1, lat, lng,
-- isDefault, deletedAt) and treats label as required.
--
-- Both addresses and user_profiles were verified empty before this
-- migration was authored, so column drops do not destroy user data.
-- A backfill clause for `label` (set to '' before NOT NULL) is included
-- defensively in case the migration is later applied to a non-empty
-- table in another environment.
--
-- Rolls back conceptually with: re-add dropped columns, drop new ones,
-- restore the old userId-only index, drop AddressType enum.

CREATE TYPE "AddressType" AS ENUM ('HOME', 'WORK', 'CUSTOM');

-- New columns ----------------------------------------------------------------
-- type: defaulted to 'CUSTOM' so existing rows (none in dev today) get a
--       safe value before we drop the default and require it explicitly.
ALTER TABLE "addresses" ADD COLUMN "type" "AddressType" NOT NULL DEFAULT 'CUSTOM';
ALTER TABLE "addresses" ALTER COLUMN "type" DROP DEFAULT;

-- line1 replaces street; copy data over before dropping the old column.
ALTER TABLE "addresses" ADD COLUMN "line1" TEXT;
UPDATE "addresses" SET "line1" = "street";
ALTER TABLE "addresses" ALTER COLUMN "line1" SET NOT NULL;

-- lat / lng replace latitude / longitude.
ALTER TABLE "addresses" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "addresses" ADD COLUMN "lng" DOUBLE PRECISION;
UPDATE "addresses" SET "lat" = "latitude", "lng" = "longitude";

-- Soft-delete column.
ALTER TABLE "addresses" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Tighten label to NOT NULL (was nullable in the prior schema).
UPDATE "addresses" SET "label" = '' WHERE "label" IS NULL;
ALTER TABLE "addresses" ALTER COLUMN "label" SET NOT NULL;

-- Drop obsolete columns ------------------------------------------------------
ALTER TABLE "addresses" DROP COLUMN "street";
ALTER TABLE "addresses" DROP COLUMN "state";
ALTER TABLE "addresses" DROP COLUMN "zipCode";
ALTER TABLE "addresses" DROP COLUMN "latitude";
ALTER TABLE "addresses" DROP COLUMN "longitude";

-- Index swap -----------------------------------------------------------------
-- Replace the userId-only index with the soft-delete-aware variant the
-- slice-2 list query relies on; keep the (userId, isDefault) index in
-- place (already exists from the prior migration), and add a generic
-- deletedAt index for housekeeping sweeps.
DROP INDEX "addresses_userId_idx";
CREATE INDEX "addresses_userId_deletedAt_idx" ON "addresses"("userId", "deletedAt");
CREATE INDEX "addresses_deletedAt_idx" ON "addresses"("deletedAt");
