-- R11 — customer reviews of completed bookings, and reputation derived from them.
--
-- docs/production-readiness/r11/REVIEW_POLICY.md
--
-- Additive: one new table, one new enum, three new audit event values and one
-- new unique index on Booking. No existing column changes type or is dropped.

-- CreateEnum
CREATE TYPE "BookingReviewState" AS ENUM ('PUBLISHED', 'HIDDEN');

-- AlterEnum. The new values are not used in this migration, so adding them
-- here is safe inside the migration's transaction.
ALTER TYPE "AuditEventType" ADD VALUE 'BOOKING_REVIEW_SUBMITTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_REVIEW_HIDDEN';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_REVIEW_RESTORED';

-- CreateTable
CREATE TABLE "BookingReview" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "seekerUserId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "state" "BookingReviewState" NOT NULL DEFAULT 'PUBLISHED',
    "hiddenAt" TIMESTAMP(3),
    "hiddenByUserId" TEXT,
    "moderationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingReview_pkey" PRIMARY KEY ("id")
);

-- ONE REVIEW PER BOOKING. This index, not the service and not the screen, is
-- what makes a second review of a booking impossible.
CREATE UNIQUE INDEX "BookingReview_bookingId_key" ON "BookingReview"("bookingId");

-- CreateIndex
CREATE INDEX "BookingReview_providerId_state_idx" ON "BookingReview"("providerId", "state");

-- CreateIndex
CREATE INDEX "BookingReview_seekerUserId_createdAt_idx" ON "BookingReview"("seekerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingReview_bookingId_seekerUserId_providerId_key" ON "BookingReview"("bookingId", "seekerUserId", "providerId");

-- The target of the composite foreign key below. Trivially unique, since "id"
-- is already the primary key; it exists so the key can name all three columns.
CREATE UNIQUE INDEX "Booking_id_seekerUserId_providerId_key" ON "Booking"("id", "seekerUserId", "providerId");

-- The author and the reviewed provider are the BOOKING's seeker and provider,
-- guaranteed by PostgreSQL. RESTRICT: a reviewed booking cannot be deleted
-- underneath its review, so the cascades above Booking cannot erase one.
ALTER TABLE "BookingReview" ADD CONSTRAINT "BookingReview_bookingId_seekerUserId_providerId_fkey" FOREIGN KEY ("bookingId", "seekerUserId", "providerId") REFERENCES "Booking"("id", "seekerUserId", "providerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Whole stars, one to five.
ALTER TABLE "BookingReview" ADD CONSTRAINT "booking_review_rating_in_range"
  CHECK ("rating" BETWEEN 1 AND 5);

-- A comment is absent or has content, and is bounded. The API limit is
-- stricter; this is the blast radius.
ALTER TABLE "BookingReview" ADD CONSTRAINT "booking_review_comment_bounded"
  CHECK ("comment" IS NULL OR (char_length("comment") BETWEEN 1 AND 2000));

-- A hidden review says when and why; a published one carries no moderation.
ALTER TABLE "BookingReview" ADD CONSTRAINT "booking_review_hidden_is_explained"
  CHECK (
    ("state" = 'HIDDEN' AND "hiddenAt" IS NOT NULL AND "moderationReason" IS NOT NULL)
    OR ("state" = 'PUBLISHED' AND "hiddenAt" IS NULL)
  );

-- REPUTATION BECOMES DERIVED.
--
-- Until now ProviderProfile.ratingAvg, reviewCount and completedJobs had no
-- production writer at all: they held a column default or a development seed
-- value, and one consumer (the earned service-area tier) already treated them
-- as earned. No review row has ever existed, so no stored rating can have been
-- earned. From here on the three columns are recomputed from source rows in
-- the transaction that changes one, and this statement brings every existing
-- row to what the source rows say today:
--
--   rating and review count   from PUBLISHED reviews: none exist, so zero
--   completed jobs            the provider's COMPLETED, undeleted bookings
UPDATE "ProviderProfile" p
   SET "ratingAvg" = 0,
       "reviewCount" = 0,
       "completedJobs" = (
         SELECT count(*)::int
           FROM "Booking" b
          WHERE b."providerId" = p."id"
            AND b."status" = 'COMPLETED'
            AND b."deletedAt" IS NULL
       );
