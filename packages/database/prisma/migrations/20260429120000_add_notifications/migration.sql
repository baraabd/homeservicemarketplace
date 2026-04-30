-- Sprint 3, slice 3.1: per-user notification feed.
-- Strictly additive — creates ONLY the two enums + the notifications
-- table. No existing tables are touched. WebSocket / push / email
-- delivery channels are explicitly out of scope and intentionally
-- NOT introduced.
--
-- Rolls back conceptually with:
--   DROP TABLE "notifications";
--   DROP TYPE  "NotificationType";
--   DROP TYPE  "NotificationResourceType";

CREATE TYPE "NotificationType" AS ENUM (
  'BID_RECEIVED',
  'BID_ACCEPTED',
  'BOOKING_CREATED',
  'BOOKING_CANCELLED',
  'BOOKING_COMPLETED',
  'MESSAGE_RECEIVED',
  'REVIEW_REQUESTED',
  'SYSTEM'
);

CREATE TYPE "NotificationResourceType" AS ENUM (
  'REQUEST',
  'BID',
  'BOOKING',
  'CONVERSATION',
  'REVIEW'
);

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceType" "NotificationResourceType",
    "resourceId" TEXT,
    "deepLink" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Dominant access patterns:
-- - unread-count badge / "New" section in the drawer.
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");
-- - drawer list, ordered by createdAt DESC.
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
-- - reverse-lookup when a resource is hard-deleted (future cleanup).
CREATE INDEX "notifications_resourceType_resourceId_idx" ON "notifications"("resourceType", "resourceId");
-- - housekeeping for soft-deleted rows.
CREATE INDEX "notifications_deletedAt_idx" ON "notifications"("deletedAt");

-- CASCADE so a hard-deleted user takes their notifications with them.
-- Soft-deletes never reach this constraint.
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
