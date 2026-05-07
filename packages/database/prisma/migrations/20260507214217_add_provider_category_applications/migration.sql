-- Sprint 7.x: ProviderCategoryApplication — provider's request to add a
-- ServiceCategory to their approved skill set, gated by admin review.
--
-- The PENDING rows are what the Provider app surfaces as
-- `pendingCategories`. APPROVED rows are mirrored into
-- ProviderProfileServiceCategory by the admin review service; REJECTED
-- rows stay in this table so admins can see prior decisions on retry.
-- Uniqueness ("one PENDING row per provider+category at a time") is
-- enforced in the service layer rather than via a unique index, because
-- Postgres + Prisma does not support partial unique indexes natively
-- and a strict (providerProfileId, serviceCategoryId) unique would
-- block legitimate retry-after-rejection flows.

-- CreateEnum
CREATE TYPE "ProviderCategoryApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "ProviderCategoryApplication" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "serviceCategoryId" TEXT NOT NULL,
    "status" "ProviderCategoryApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCategoryApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderCategoryApplication_providerProfileId_status_idx" ON "ProviderCategoryApplication"("providerProfileId", "status");

-- CreateIndex
CREATE INDEX "ProviderCategoryApplication_serviceCategoryId_status_idx" ON "ProviderCategoryApplication"("serviceCategoryId", "status");

-- CreateIndex
CREATE INDEX "ProviderCategoryApplication_status_createdAt_idx" ON "ProviderCategoryApplication"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProviderCategoryApplication" ADD CONSTRAINT "ProviderCategoryApplication_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCategoryApplication" ADD CONSTRAINT "ProviderCategoryApplication_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
