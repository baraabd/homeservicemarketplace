-- CreateEnum
CREATE TYPE "MediaVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "MediaScanState" AS ENUM ('PENDING', 'CLEAN', 'QUARANTINED', 'SCAN_FAILED');

-- CreateEnum
CREATE TYPE "VerificationCaseState" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'ACTION_REQUIRED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationDocumentKind" AS ENUM ('INDIVIDUAL_IDENTITY', 'BUSINESS_REGISTRATION', 'AUTHORIZED_REPRESENTATIVE_IDENTITY', 'CATEGORY_LICENSE');

-- CreateEnum
CREATE TYPE "VerificationDecisionOutcome" AS ENUM ('APPROVED', 'REJECTED', 'ACTION_REQUIRED', 'REVERIFY_REQUIRED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationReasonCode" AS ENUM ('DOCUMENTS_COMPLETE_AND_LEGIBLE', 'DOCUMENT_MISSING', 'DOCUMENT_ILLEGIBLE', 'DOCUMENT_EXPIRED', 'DOCUMENT_MISMATCH', 'SUSPECTED_FORGERY', 'DUPLICATE_IDENTITY', 'BUSINESS_NOT_REGISTERED', 'REPRESENTATIVE_NOT_AUTHORIZED', 'LICENSE_MISSING_FOR_CATEGORY', 'LICENSE_EXPIRED', 'POLICY_PERIOD_ELAPSED', 'TRUST_AND_SAFETY_ACTION', 'PROVIDER_REQUESTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderWorkAccessSource" AS ENUM ('VERIFIED_DOCUMENTS', 'LEGACY_BACKFILL', 'MANUAL_OVERRIDE', 'RENEWAL');

-- CreateEnum
CREATE TYPE "PortfolioModerationState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "ProviderWorkAccessGrant" ADD COLUMN     "caseId" TEXT,
ADD COLUMN     "source" "ProviderWorkAccessSource";

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "visibility" "MediaVisibility" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "declaredMimeType" TEXT NOT NULL,
    "detectedMimeType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "scanState" "MediaScanState" NOT NULL DEFAULT 'PENDING',
    "scannedAt" TIMESTAMP(3),
    "scanSignature" TEXT,
    "ownerUserId" TEXT,
    "originalFilename" TEXT,
    "uploadCompletedAt" TIMESTAMP(3),
    "retainUntil" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRequirementPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "country" TEXT,
    "providerType" "ProviderType",
    "categoryId" TEXT,
    "requirements" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRequirementPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCase" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "state" "VerificationCaseState" NOT NULL DEFAULT 'DRAFT',
    "policyVersion" TEXT NOT NULL,
    "requirementsSnapshot" JSONB,
    "country" TEXT,
    "providerType" "ProviderType",
    "submittedAt" TIMESTAMP(3),
    "assignedToUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "VerificationDocumentKind" NOT NULL,
    "serviceCategoryId" TEXT,
    "mediaAssetId" TEXT NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "outcome" "VerificationDecisionOutcome" NOT NULL,
    "reasonCode" "VerificationReasonCode" NOT NULL,
    "fromState" "VerificationCaseState" NOT NULL,
    "toState" "VerificationCaseState" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "metadata" JSONB,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAccessLog" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "ipPrefix" TEXT,
    "userAgentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderPortfolioItem" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "serviceCategoryId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "publicationRightAckAt" TIMESTAMP(3),
    "publicationRightAckText" TEXT,
    "moderationState" "PortfolioModerationState" NOT NULL DEFAULT 'PENDING',
    "moderatedByUserId" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "moderationReason" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderPortfolioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE INDEX "MediaAsset_deletedAt_retainUntil_idx" ON "MediaAsset"("deletedAt", "retainUntil");

-- CreateIndex
CREATE INDEX "MediaAsset_scanState_createdAt_idx" ON "MediaAsset"("scanState", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_ownerUserId_visibility_idx" ON "MediaAsset"("ownerUserId", "visibility");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequirementPolicy_version_key" ON "VerificationRequirementPolicy"("version");

-- CreateIndex
CREATE INDEX "VerificationRequirementPolicy_country_providerType_category_idx" ON "VerificationRequirementPolicy"("country", "providerType", "categoryId", "retiredAt");

-- CreateIndex
CREATE INDEX "VerificationRequirementPolicy_retiredAt_publishedAt_idx" ON "VerificationRequirementPolicy"("retiredAt", "publishedAt");

-- CreateIndex
CREATE INDEX "VerificationCase_state_submittedAt_idx" ON "VerificationCase"("state", "submittedAt");

-- CreateIndex
CREATE INDEX "VerificationCase_assignedToUserId_state_idx" ON "VerificationCase"("assignedToUserId", "state");

-- CreateIndex
CREATE INDEX "VerificationCase_providerProfileId_createdAt_idx" ON "VerificationCase"("providerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationCase_policyVersion_idx" ON "VerificationCase"("policyVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDocument_mediaAssetId_key" ON "VerificationDocument"("mediaAssetId");

-- CreateIndex
CREATE INDEX "VerificationDocument_caseId_kind_supersededAt_idx" ON "VerificationDocument"("caseId", "kind", "supersededAt");

-- CreateIndex
CREATE INDEX "VerificationDocument_serviceCategoryId_idx" ON "VerificationDocument"("serviceCategoryId");

-- CreateIndex
CREATE INDEX "VerificationDecision_caseId_decidedAt_idx" ON "VerificationDecision"("caseId", "decidedAt");

-- CreateIndex
CREATE INDEX "VerificationDecision_decidedByUserId_decidedAt_idx" ON "VerificationDecision"("decidedByUserId", "decidedAt");

-- CreateIndex
CREATE INDEX "VerificationDecision_outcome_decidedAt_idx" ON "VerificationDecision"("outcome", "decidedAt");

-- CreateIndex
CREATE INDEX "VerificationAccessLog_caseId_createdAt_idx" ON "VerificationAccessLog"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationAccessLog_actorUserId_createdAt_idx" ON "VerificationAccessLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "VerificationAccessLog_mediaAssetId_createdAt_idx" ON "VerificationAccessLog"("mediaAssetId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderPortfolioItem_providerProfileId_deletedAt_position_idx" ON "ProviderPortfolioItem"("providerProfileId", "deletedAt", "position");

-- CreateIndex
CREATE INDEX "ProviderPortfolioItem_moderationState_createdAt_idx" ON "ProviderPortfolioItem"("moderationState", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderPortfolioItem_serviceCategoryId_idx" ON "ProviderPortfolioItem"("serviceCategoryId");

-- CreateIndex
CREATE INDEX "ProviderWorkAccessGrant_caseId_idx" ON "ProviderWorkAccessGrant"("caseId");

-- CreateIndex
CREATE INDEX "ProviderWorkAccessGrant_source_status_idx" ON "ProviderWorkAccessGrant"("source", "status");

-- AddForeignKey
ALTER TABLE "ProviderWorkAccessGrant" ADD CONSTRAINT "ProviderWorkAccessGrant_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VerificationCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRequirementPolicy" ADD CONSTRAINT "VerificationRequirementPolicy_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_policyVersion_fkey" FOREIGN KEY ("policyVersion") REFERENCES "VerificationRequirementPolicy"("version") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "VerificationCase" ADD CONSTRAINT "VerificationCase_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VerificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VerificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAccessLog" ADD CONSTRAINT "VerificationAccessLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VerificationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPortfolioItem" ADD CONSTRAINT "ProviderPortfolioItem_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPortfolioItem" ADD CONSTRAINT "ProviderPortfolioItem_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderPortfolioItem" ADD CONSTRAINT "ProviderPortfolioItem_serviceCategoryId_fkey" FOREIGN KEY ("serviceCategoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
