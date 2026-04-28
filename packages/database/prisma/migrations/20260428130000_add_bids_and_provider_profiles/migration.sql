-- Sprint 2, slice 2.1: Provider read-model + bids read API.
-- Strictly additive — creates only the slice-2.1 enums + tables and
-- adds no columns to existing tables. Bookings, notifications, chat,
-- reviews, tracking, and payments are explicitly out of scope and
-- intentionally NOT introduced.
--
-- Rolls back conceptually with:
--   DROP TABLE "bids";
--   DROP TABLE "provider_profiles";
--   DROP TYPE  "BidBadge";
--   DROP TYPE  "PricingType";
--   DROP TYPE  "BidStatus";

CREATE TYPE "BidStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
CREATE TYPE "PricingType" AS ENUM ('HOURLY', 'FIXED');
CREATE TYPE "BidBadge" AS ENUM ('BEST_MATCH', 'BEST_VALUE', 'FASTEST');

CREATE TABLE "provider_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "ratingAvg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "topPro" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_profiles_userId_key" ON "provider_profiles"("userId");
CREATE INDEX "provider_profiles_deletedAt_idx" ON "provider_profiles"("deletedAt");

ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pricingType" "PricingType" NOT NULL,
    "note" TEXT,
    "status" "BidStatus" NOT NULL DEFAULT 'PENDING',
    "responseTimeMinutes" INTEGER,
    "badge" "BidBadge",
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bids_requestId_status_idx" ON "bids"("requestId", "status");
CREATE INDEX "bids_providerId_status_idx" ON "bids"("providerId", "status");
CREATE INDEX "bids_requestId_providerId_idx" ON "bids"("requestId", "providerId");
CREATE INDEX "bids_submittedAt_idx" ON "bids"("submittedAt");
CREATE INDEX "bids_deletedAt_idx" ON "bids"("deletedAt");

ALTER TABLE "bids"
  ADD CONSTRAINT "bids_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "service_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bids"
  ADD CONSTRAINT "bids_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
