-- Sprint 9B.7 — the SYSTEM expiry path needs two names it can write down.
--
-- Both are ADDITIVE and FORWARD-ONLY. PostgreSQL cannot remove an enum value,
-- so there is deliberately no down migration: rolling the application back
-- leaves two unused labels, which is inert, whereas a "rollback" that dropped
-- them would fail against any row that had already used one.
--
-- IF NOT EXISTS so a re-run is a no-op rather than an error.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_EXPIRED';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EXPIRED';
