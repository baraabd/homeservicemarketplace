-- Sprint 2, slice 2.3: booking timeline.
-- Strictly additive — creates ONLY the BookingEventType enum + the
-- booking_events table. No existing tables are touched. Notifications,
-- chat, reviews, tracking, payments, support remain explicitly out of
-- scope and are NOT introduced.
--
-- Rolls back conceptually with:
--   DROP TABLE "booking_events";
--   DROP TYPE  "BookingEventType";

CREATE TYPE "BookingEventType" AS ENUM (
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_STATUS_CHANGED',
  'BOOKING_RESCHEDULED'
);

CREATE TABLE "booking_events" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "BookingEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("id")
);

-- Dominant access pattern: timeline render = list-by-booking
-- chronologically.
CREATE INDEX "booking_events_bookingId_createdAt_idx" ON "booking_events"("bookingId", "createdAt");
-- Aligns with service_request_events for cross-booking analytics.
CREATE INDEX "booking_events_type_createdAt_idx" ON "booking_events"("type", "createdAt");

ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Actor is nullable because future system actors (auto-cancel after
-- N days, auto-complete, etc.) write rows here without a user. SET
-- NULL keeps the audit row alive after a user is hard-deleted.
ALTER TABLE "booking_events"
  ADD CONSTRAINT "booking_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
