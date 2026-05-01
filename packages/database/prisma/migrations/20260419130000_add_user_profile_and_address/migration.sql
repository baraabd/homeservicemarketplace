-- Backfill of an earlier migration that was applied directly to the
-- developer database but was not committed to the repository. The
-- _prisma_migrations table records this as already applied
-- (2026-04-19); recreating the file here keeps the migration history
-- consistent so subsequent `prisma migrate dev` runs do not detect a
-- drift / missing-migration condition.
--
-- Captured from the live developer DB via information_schema / pg_indexes:
--   addresses(id, userId, label, street, city, state, zipCode, country,
--             latitude, longitude, isDefault, createdAt, updatedAt)
--   user_profiles(id, userId UNIQUE, avatarUrl, phoneNumber, bio,
--                 createdAt, updatedAt)
--
-- A follow-up migration (20260427130000_align_addresses_for_slice2)
-- evolves the addresses table to the slice-2 contract.

CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "phoneNumber" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

ALTER TABLE "user_profiles"
  ADD CONSTRAINT "user_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "zipCode" TEXT,
    "country" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "addresses_userId_idx" ON "addresses"("userId");
CREATE INDEX "addresses_userId_isDefault_idx" ON "addresses"("userId", "isDefault");

ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
