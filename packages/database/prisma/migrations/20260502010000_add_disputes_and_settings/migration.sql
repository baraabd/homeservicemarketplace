-- Sprint 6.3 / 6.5: dispute tracking + platform-wide settings.

CREATE TYPE "DisputeStatus" AS ENUM (
  'OPEN',
  'IN_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_PARTIAL',
  'RESOLVED_DENIED',
  'CANCELLED'
);

CREATE TABLE "Dispute" (
  "id"           TEXT NOT NULL,
  "bookingId"    TEXT NOT NULL,
  "openedById"   TEXT NOT NULL,
  "status"       "DisputeStatus" NOT NULL DEFAULT 'OPEN',
  "reason"       TEXT NOT NULL,
  "resolution"   TEXT,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Dispute_bookingId_idx" ON "Dispute"("bookingId");
CREATE INDEX "Dispute_openedById_idx" ON "Dispute"("openedById");
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_deletedAt_idx" ON "Dispute"("deletedAt");

ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_bookingId_fkey" FOREIGN KEY ("bookingId")
    REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById")
    REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE,
  ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById")
    REFERENCES "User"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "PlatformSetting" (
  "key"       TEXT NOT NULL,
  "value"     JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "PlatformSetting_updatedBy_idx" ON "PlatformSetting"("updatedBy");

ALTER TABLE "PlatformSetting"
  ADD CONSTRAINT "PlatformSetting_updatedBy_fkey" FOREIGN KEY ("updatedBy")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
