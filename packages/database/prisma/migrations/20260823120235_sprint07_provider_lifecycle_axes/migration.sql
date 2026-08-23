-- CreateEnum
CREATE TYPE "ProviderOnboardingState" AS ENUM ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'ACCEPTED', 'RETURNED');

-- CreateEnum
CREATE TYPE "ProviderVerificationState" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProviderStandingState" AS ENUM ('GOOD', 'UNDER_REVIEW', 'RESTRICTED', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ProviderSubscriptionTier" AS ENUM ('NONE', 'BASIC', 'PRO', 'ELITE');

-- CreateEnum
CREATE TYPE "ProviderLifecycleSource" AS ENUM ('NATIVE', 'LEGACY_DRAFT', 'LEGACY_PENDING', 'LEGACY_APPROVED', 'LEGACY_SUSPENDED', 'LEGACY_REJECTED');

-- CreateEnum
CREATE TYPE "ProviderWorkAccessStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ProviderProfile" ADD COLUMN     "lifecycleSource" "ProviderLifecycleSource",
ADD COLUMN     "lifecycleSyncedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingState" "ProviderOnboardingState",
ADD COLUMN     "standingState" "ProviderStandingState",
ADD COLUMN     "subscriptionTier" "ProviderSubscriptionTier",
ADD COLUMN     "verificationState" "ProviderVerificationState";

-- CreateTable
CREATE TABLE "ProviderOnboardingSubmission" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issues" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "decision" "ProviderOnboardingState",
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderOnboardingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderWorkAccessGrant" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "status" "ProviderWorkAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderWorkAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProviderOnboardingSubmission_providerProfileId_submittedAt_idx" ON "ProviderOnboardingSubmission"("providerProfileId", "submittedAt");

-- CreateIndex
CREATE INDEX "ProviderOnboardingSubmission_decidedAt_submittedAt_idx" ON "ProviderOnboardingSubmission"("decidedAt", "submittedAt");

-- CreateIndex
CREATE INDEX "ProviderWorkAccessGrant_providerProfileId_status_expiresAt_idx" ON "ProviderWorkAccessGrant"("providerProfileId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "ProviderWorkAccessGrant_status_expiresAt_idx" ON "ProviderWorkAccessGrant"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ProviderProfile_deletedAt_onboardingState_idx" ON "ProviderProfile"("deletedAt", "onboardingState");

-- CreateIndex
CREATE INDEX "ProviderProfile_deletedAt_standingState_idx" ON "ProviderProfile"("deletedAt", "standingState");

-- CreateIndex
CREATE INDEX "ProviderProfile_lifecycleSyncedAt_idx" ON "ProviderProfile"("lifecycleSyncedAt");

-- AddForeignKey
ALTER TABLE "ProviderOnboardingSubmission" ADD CONSTRAINT "ProviderOnboardingSubmission_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderWorkAccessGrant" ADD CONSTRAINT "ProviderWorkAccessGrant_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Sprint 7 — integrity constraints Prisma's schema language cannot express.
--
-- All of these are statements about rows this migration creates the ability to
-- write, so none can fail on existing data: both tables are new and every new
-- ProviderProfile column is NULL until the backfill runs.
--
-- They exist because each encodes an invariant that is cheap to state here and
-- expensive to discover later from corrupted rows.
-- ---------------------------------------------------------------------------

-- A grant that expires before it begins would evaluate as "never valid" while
-- looking, in an admin list, exactly like a working grant.
ALTER TABLE "ProviderWorkAccessGrant"
  ADD CONSTRAINT "provider_work_access_grant_expiry_after_grant"
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "grantedAt");

-- Revocation must be self-consistent: a revocation timestamp without the
-- REVOKED status yields a row the authorization read treats as live while an
-- operator reading the table believes it is withdrawn. That disagreement is
-- the worst possible failure for this table, so it is a constraint.
ALTER TABLE "ProviderWorkAccessGrant"
  ADD CONSTRAINT "provider_work_access_grant_revocation_consistent"
  CHECK (("revokedAt" IS NULL) = ("status" <> 'REVOKED'));

-- At most ONE live grant per (provider, reason).
--
-- Deliberately scoped by reason rather than by provider: overlapping grants
-- with DIFFERENT justifications are legitimate (a verification grant and a
-- manual override can coexist, and the provider keeps access while either
-- holds). What is never legitimate is the same justification granted twice
-- concurrently, which is what a retried admin action produces.
CREATE UNIQUE INDEX "provider_work_access_grant_one_live_per_reason"
  ON "ProviderWorkAccessGrant" ("providerProfileId", "reason")
  WHERE "status" = 'ACTIVE' AND "revokedAt" IS NULL;

-- A decision is a timestamp AND an outcome, or neither. Half a decision is a
-- submission the queue believes is resolved and the provider believes is not.
ALTER TABLE "ProviderOnboardingSubmission"
  ADD CONSTRAINT "provider_onboarding_submission_decision_consistent"
  CHECK (("decidedAt" IS NULL) = ("decision" IS NULL));

-- A snapshot whose policy version is unknown cannot be judged against the
-- rules that were in force, which is the entire reason the snapshot exists.
ALTER TABLE "ProviderOnboardingSubmission"
  ADD CONSTRAINT "provider_onboarding_submission_policy_version_present"
  CHECK (length(btrim("policyVersion")) > 0);
