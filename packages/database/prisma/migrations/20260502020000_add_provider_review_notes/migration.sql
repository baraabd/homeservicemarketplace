-- Sprint 6.2 — Admin Provider Verification full workflow.
--
-- Adds an admin-facing free-text review-notes field to ProviderProfile
-- and a new AuditEventType row so the verification history endpoint
-- can surface "notes updated" events alongside approve/reject/suspend
-- transitions. Both changes are additive; rollback is a single DROP
-- column + ALTER TYPE … DROP VALUE on Postgres 14+.

ALTER TABLE "ProviderProfile"
  ADD COLUMN "reviewNotes" TEXT;

ALTER TYPE "AuditEventType" ADD VALUE 'ADMIN_PROVIDER_NOTES_UPDATED';
