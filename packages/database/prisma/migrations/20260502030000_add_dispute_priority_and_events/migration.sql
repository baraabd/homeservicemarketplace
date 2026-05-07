-- Sprint 6.3 — Admin Disputes full workflow.
--
-- Adds:
--   • DisputePriority enum (URGENT/HIGH/MEDIUM/LOW)
--   • DisputeEventType enum (OPENED/STATUS_CHANGED/PRIORITY_CHANGED/
--     DESCRIPTION_UPDATED/RESOLVED/COMMENTED)
--   • Dispute.priority (default MEDIUM) + Dispute.description (nullable text)
--   • DisputeEvent table: dispute-scoped timeline rows with before/after JSON
--     snapshots so an operator can reconstruct any transition.
--   • ADMIN_DISPUTE_UPDATED on the AuditEventType enum so the admin audit
--     log can record PATCH actions distinct from open/resolve.
--
-- All changes are additive; existing rows backfill MEDIUM priority by
-- default. Rollback is a single DROP TABLE + DROP COLUMN + DROP TYPE.

-- 1) New enums
CREATE TYPE "DisputePriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');

CREATE TYPE "DisputeEventType" AS ENUM (
  'OPENED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'DESCRIPTION_UPDATED',
  'RESOLVED',
  'COMMENTED'
);

-- 2) Dispute columns
ALTER TABLE "Dispute"
  ADD COLUMN "priority" "DisputePriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "description" TEXT;

CREATE INDEX "Dispute_priority_status_idx" ON "Dispute"("priority", "status");

-- 3) DisputeEvent table
CREATE TABLE "DisputeEvent" (
  "id"          TEXT              NOT NULL,
  "disputeId"   TEXT              NOT NULL,
  "actorUserId" TEXT,
  "type"        "DisputeEventType" NOT NULL,
  "before"      JSONB,
  "after"       JSONB,
  "message"     TEXT,
  "createdAt"   TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DisputeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DisputeEvent_disputeId_createdAt_idx"
  ON "DisputeEvent"("disputeId", "createdAt");

CREATE INDEX "DisputeEvent_type_createdAt_idx"
  ON "DisputeEvent"("type", "createdAt");

ALTER TABLE "DisputeEvent"
  ADD CONSTRAINT "DisputeEvent_disputeId_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "DisputeEvent"
  ADD CONSTRAINT "DisputeEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- 4) New AuditEventType value for the PATCH route
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_DISPUTE_UPDATED';
