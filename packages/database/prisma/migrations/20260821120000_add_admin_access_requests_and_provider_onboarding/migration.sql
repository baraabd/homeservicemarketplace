-- Sprint 01 remediation — Phase 4: separate the three account axes.
--
-- Adds:
--   1. AdminAccessRequest — the third axis. Public signup must never grant the
--      admin role; an Admin-themed signup creates an ordinary User identity and
--      (only on explicit submission) a PENDING request that a DIFFERENT
--      authorized admin approves or rejects.
--   2. ProviderProfile onboarding columns — an upgrade now creates a DRAFT
--      profile and the provider explicitly submits for review, so
--      PENDING_REVIEW means "a complete application was submitted" rather than
--      "someone clicked upgrade".
--   3. Audit event types for both lifecycles.
--
-- Also corrects pre-existing FK drift on Dispute (see the note at the bottom).
--
-- Additive and backfill-free: every new column is nullable and every new enum
-- value is appended, so existing rows and in-flight deploys are unaffected.

-- CreateEnum
CREATE TYPE "AdminAccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- Values are only APPENDED, and none of them is referenced by another
-- statement in this migration, so this is safe inside PostgreSQL 12+'s
-- transactional DDL (the "cannot use a new enum value in the same
-- transaction" restriction does not apply).
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_ACCESS_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_ACCESS_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_ACCESS_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_ACCESS_CANCELLED';
ALTER TYPE "AuditEventType" ADD VALUE 'PROVIDER_UPGRADE_REQUESTED';
ALTER TYPE "AuditEventType" ADD VALUE 'PROVIDER_ONBOARDING_SUBMITTED';

-- AlterTable: provider onboarding lifecycle.
-- All nullable: existing profiles simply have no submission/review stamp yet.
ALTER TABLE "ProviderProfile"
  ADD COLUMN "submittedForReviewAt" TIMESTAMP(3),
  ADD COLUMN "reviewedAt"           TIMESTAMP(3),
  ADD COLUMN "reviewedByUserId"     TEXT,
  ADD COLUMN "rejectionReason"      TEXT;

-- CreateTable
CREATE TABLE "AdminAccessRequest" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "status"          "AdminAccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "justification"   TEXT,
    "decidedByUserId" TEXT,
    "decidedAt"       TIMESTAMP(3),
    "decisionNote"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAccessRequest_pkey" PRIMARY KEY ("id")
);

-- Serves "does this user already have a pending request?" (the one-pending-per
-- -user rule the service enforces) and the per-user history read.
CREATE INDEX "AdminAccessRequest_userId_status_idx" ON "AdminAccessRequest"("userId", "status");
-- Serves the admin review queue: PENDING ordered by age.
CREATE INDEX "AdminAccessRequest_status_createdAt_idx" ON "AdminAccessRequest"("status", "createdAt");

ALTER TABLE "AdminAccessRequest"
  ADD CONSTRAINT "AdminAccessRequest_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- SET NULL, not CASCADE: deleting a reviewer must never erase the record
  -- that a grant happened.
  ADD CONSTRAINT "AdminAccessRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pre-existing drift correction (NOT introduced by this remediation).
--
-- 20260502010000_add_disputes_and_settings was hand-written with
-- ON DELETE NO ACTION for both Dispute FKs, but schema.prisma declares
-- `openedBy User` (required → Prisma RESTRICT) and `resolvedBy User?`
-- (optional → Prisma SET NULL). Every `prisma migrate diff` since has
-- reported the difference, so the schema and the database genuinely disagreed.
-- Aligning the database with the schema here keeps the drift from being
-- "fixed in one layer only".
--
-- Behavioural delta: hard-deleting a User who resolved a dispute previously
-- failed; it now nulls Dispute.resolvedById. The application soft-deletes
-- users (User.deletedAt) and never issues a hard DELETE, so no application
-- path changes.
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_openedById_fkey";
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_resolvedById_fkey";
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_openedById_fkey" FOREIGN KEY ("openedById")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Dispute_resolvedById_fkey" FOREIGN KEY ("resolvedById")
    REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
