-- Sprint 9B.4 — audit event types for scan outcomes.
--
-- Four values rather than one event with a verdict field. "A document was
-- cleared" and "a document was quarantined" are the two facts an auditor
-- searches for BY NAME, and collapsing them into one type buries the second
-- inside the metadata of the first — which is precisely the search that matters
-- when answering whether malware ever reached a reviewer.
--
-- SCAN_FAILED is separate from QUARANTINED for the same reason it is separate
-- in MediaScanState: nobody judged the file, the infrastructure failed. An
-- audit trail that conflates them reports an outage as a run of attacks.
--
-- Additive and forward-only. Adding enum values cannot invalidate an existing
-- audit row, and audit rows are never rewritten, so there is nothing to
-- backfill.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove a value from an enum. Reverting the
-- code is safe and needs no schema change — rows already written keep their
-- type and stay readable. Do not attempt to drop these values.
--
-- The new values are NOT used anywhere in this migration, which is what makes
-- running them in one transaction safe: PostgreSQL forbids using an enum value
-- in the same transaction that added it.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_SCAN_CLEARED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_SCAN_QUARANTINED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_SCAN_FAILED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_REJECTED';
