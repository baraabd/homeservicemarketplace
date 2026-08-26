-- Sprint 9B.7 — audit and notification types for the decisions that move work access.
--
-- Separate audit types rather than one with an outcome field, for the reason
-- the earlier verification events use separate types: "access was granted" and
-- "access was withdrawn" are the two facts an auditor searches for BY NAME, and
-- burying either inside the metadata of a shared event is exactly the search
-- that fails when it matters.
--
-- REVERIFY_REQUIRED is distinct from REVOKED on purpose. Asking a provider for
-- fresh evidence is not a sanction, and filing it as a revocation puts a mark
-- against someone who did nothing wrong — in the table a future reviewer reads
-- when judging them.
--
-- The notification says only that verification completed. It carries no reason
-- code: notifications are listed, cached and pushed to devices.
--
-- Additive and forward-only; audit and notification rows are never rewritten.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove an enum value.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_REVOKED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_REVERIFY_REQUIRED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_APPROVED';
