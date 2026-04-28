-- Sprint 2, slice 2.2: bookings table + accept-bid transaction.
-- Strictly additive — creates ONLY the slice-2.2 enum + table and
-- adds no columns to existing tables. Notifications, chat, reviews,
-- tracking, payments, support are explicitly out of scope and
-- intentionally NOT introduced.
--
-- Rolls back conceptually with:
--   DROP TABLE "bookings";
--   DROP TYPE  "BookingStatus";

CREATE TYPE "BookingStatus" AS ENUM (
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "seekerUserId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMP(3),
    "priceAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- One booking per accepted bid — DB-layer defence on top of the
-- application-layer transaction in BidsService.acceptBid.
CREATE UNIQUE INDEX "bookings_bidId_key" ON "bookings"("bidId");
CREATE INDEX "bookings_seekerUserId_status_idx" ON "bookings"("seekerUserId", "status");
CREATE INDEX "bookings_providerId_status_idx" ON "bookings"("providerId", "status");
CREATE INDEX "bookings_requestId_idx" ON "bookings"("requestId");
CREATE INDEX "bookings_deletedAt_idx" ON "bookings"("deletedAt");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "service_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_bidId_fkey"
  FOREIGN KEY ("bidId") REFERENCES "bids"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_seekerUserId_fkey"
  FOREIGN KEY ("seekerUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "provider_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
