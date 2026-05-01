-- Sprint 1, slice 3: service-request lifecycle.
-- Strictly additive — creates only the slice-3 tables / enums and adds
-- no columns to existing tables. Slice 3 covers create / list / detail /
-- update / cancel / reopen / timeline; bids, bookings, notifications,
-- chat, reviews, tracking and payments are explicitly out of scope and
-- intentionally NOT introduced here.
--
-- Rolls back cleanly with:
--   DROP TABLE "service_request_events";
--   DROP TABLE "service_requests";
--   DROP TYPE  "ServiceRequestEventType";
--   DROP TYPE  "ScheduleType";
--   DROP TYPE  "ServiceRequestStatus";

CREATE TYPE "ServiceRequestStatus" AS ENUM (
  'OPEN_FOR_BIDS',
  'BID_ACCEPTED',
  'BOOKED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "ScheduleType" AS ENUM ('ASAP', 'LATER');

CREATE TYPE "ServiceRequestEventType" AS ENUM (
  'REQUEST_CREATED',
  'REQUEST_UPDATED',
  'REQUEST_CANCELLED',
  'REQUEST_REOPENED'
);

CREATE TABLE "service_requests" (
    "id" TEXT NOT NULL,
    "seekerUserId" TEXT NOT NULL,
    "categoryId" TEXT,
    "customServiceText" TEXT,
    "description" TEXT,
    "status" "ServiceRequestStatus" NOT NULL DEFAULT 'OPEN_FOR_BIDS',
    "scheduleType" "ScheduleType" NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "addressId" TEXT,
    "addressSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "service_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_requests_seekerUserId_status_idx" ON "service_requests"("seekerUserId", "status");
CREATE INDEX "service_requests_seekerUserId_deletedAt_idx" ON "service_requests"("seekerUserId", "deletedAt");
CREATE INDEX "service_requests_categoryId_idx" ON "service_requests"("categoryId");
CREATE INDEX "service_requests_createdAt_idx" ON "service_requests"("createdAt");
CREATE INDEX "service_requests_status_idx" ON "service_requests"("status");

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_seekerUserId_fkey"
  FOREIGN KEY ("seekerUserId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "service_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_addressId_fkey"
  FOREIGN KEY ("addressId") REFERENCES "addresses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_request_events" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "ServiceRequestEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_request_events_requestId_createdAt_idx" ON "service_request_events"("requestId", "createdAt");
CREATE INDEX "service_request_events_type_createdAt_idx" ON "service_request_events"("type", "createdAt");

ALTER TABLE "service_request_events"
  ADD CONSTRAINT "service_request_events_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "service_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_request_events"
  ADD CONSTRAINT "service_request_events_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
