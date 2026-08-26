-- Sprint 9B.5 — audit event types for the case workflow commands.
--
-- Three values, matching the three commands that can move a case today.
--
-- Submission and assignment are audit events ONLY. Neither is a decision:
-- nobody judged anything, and writing a VerificationDecision for them would
-- pad the permanent record with rows that answer no question an auditor asks.
-- requestAction is different — a reviewer looked and sent it back — so it
-- writes a decision row IN ADDITION to its audit entry.
--
-- Additive and forward-only. Audit rows are never rewritten, so nothing to
-- backfill.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove an enum value. Reverting the code is
-- safe and needs no schema change.
--
-- None of the new values is used in this migration, which is what makes
-- running them in one transaction safe.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_SUBMITTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_ASSIGNED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_ACTION_REQUESTED';
