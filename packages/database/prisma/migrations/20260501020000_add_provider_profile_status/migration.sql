-- Sprint 5.1.2 — ProviderProfile.status state machine.
--
-- A ProviderProfile's lifecycle is now explicit:
--   DRAFT          provider has been created but onboarding incomplete
--   PENDING_REVIEW awaiting admin approval (production gating point)
--   ACTIVE         visible in marketplace, allowed to bid
--   SUSPENDED      temporarily blocked (admin action)
--   REJECTED       application denied (admin action)
--
-- `availability` (ONLINE/OFFLINE/PAUSED) is unchanged and continues to
-- represent the provider's current working state. It is NOT approval
-- status — a SUSPENDED provider may still toggle availability but the
-- marketplace guard (out of scope for this slice) rejects them.
--
-- The schema default is DRAFT (safe-by-default). The application's
-- /v1/me/provider/upgrade path explicitly writes ACTIVE for the
-- local/dev auto-approval flow; production will tighten that single line
-- to PENDING_REVIEW once admin moderation lands.

CREATE TYPE "ProviderProfileStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED');

ALTER TABLE "ProviderProfile"
  ADD COLUMN "status" "ProviderProfileStatus" NOT NULL DEFAULT 'DRAFT';

-- Backfill existing rows. Pre-this-migration, every row was implicitly
-- "live" (the Seeker BidsScreen renders all five seed providers, the
-- upgrade flow created a row that the Provider app rendered as active).
-- Promoting to ACTIVE preserves that visibility; new rows take the
-- DRAFT default and only become ACTIVE through the upgrade service.
UPDATE "ProviderProfile" SET "status" = 'ACTIVE';

CREATE INDEX "ProviderProfile_status_idx" ON "ProviderProfile"("status");
