-- Additive, dormant until the independent worker is explicitly configured.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_RETENTION';
ALTER TABLE "MediaAsset" ADD COLUMN "erasureStartedAt" TIMESTAMP(3);
CREATE TYPE "EvidenceRetentionStatus" AS ENUM ('PENDING', 'RUNNING', 'RETRY', 'DEAD', 'COMPLETED', 'CANCELLED');
CREATE TABLE "EvidenceRetentionJob" (
  "id" TEXT NOT NULL,
  "mediaAssetId" TEXT NOT NULL,
  "intentKey" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "casePolicyVersion" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "triggerCode" TEXT NOT NULL,
  "basisAt" TIMESTAMP(3) NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "status" "EvidenceRetentionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "holdUntil" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvidenceRetentionJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EvidenceRetentionJob_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "evidence_retention_attempt_bounds" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 20),
  CONSTRAINT "evidence_retention_clock_order" CHECK ("dueAt" >= "basisAt"),
  CONSTRAINT "evidence_retention_lease_shape" CHECK (("status" = 'RUNNING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)),
  CONSTRAINT "evidence_retention_completion_shape" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "EvidenceRetentionJob_intentKey_key" ON "EvidenceRetentionJob"("intentKey");
CREATE INDEX "EvidenceRetentionJob_status_nextAttemptAt_idx" ON "EvidenceRetentionJob"("status", "nextAttemptAt");
CREATE INDEX "EvidenceRetentionJob_mediaAssetId_createdAt_idx" ON "EvidenceRetentionJob"("mediaAssetId", "createdAt");
CREATE INDEX "EvidenceRetentionJob_status_leaseUntil_idx" ON "EvidenceRetentionJob"("status", "leaseUntil");
CREATE UNIQUE INDEX "evidence_retention_one_live_job" ON "EvidenceRetentionJob"("mediaAssetId") WHERE "status" <> 'CANCELLED';
