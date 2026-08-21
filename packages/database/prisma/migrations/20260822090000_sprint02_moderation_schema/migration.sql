-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'PROVIDER_CATEGORY_APPLIED';
ALTER TYPE "AuditEventType" ADD VALUE 'PROVIDER_CATEGORY_WITHDRAWN';
ALTER TYPE "AuditEventType" ADD VALUE 'PROVIDER_CATEGORY_REMOVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_CATEGORY_APPLICATION_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_CATEGORY_APPLICATION_REJECTED';

-- AlterTable
ALTER TABLE "ProviderCategoryApplication" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededById" TEXT;

-- CreateTable
CREATE TABLE "DataRemediationLog" (
    "id" TEXT NOT NULL,
    "migration" TEXT NOT NULL,
    "constraintName" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataRemediationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataRemediationLog_migration_idx" ON "DataRemediationLog"("migration");

-- CreateIndex
CREATE INDEX "DataRemediationLog_constraintName_idx" ON "DataRemediationLog"("constraintName");

-- CreateIndex
CREATE INDEX "DataRemediationLog_entity_entityId_idx" ON "DataRemediationLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ProviderCategoryApplication_supersededAt_idx" ON "ProviderCategoryApplication"("supersededAt");

