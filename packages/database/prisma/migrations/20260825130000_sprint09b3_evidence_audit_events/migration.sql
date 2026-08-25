-- Sprint 9B.3 — audit event types for the evidence upload path.
--
-- Distinct from the case events on purpose. Reserving an upload slot and
-- attaching a finished document are different facts from resuming a case, and
-- borrowing VERIFICATION_CASE_RESUMED for either would make the provider's
-- timeline assert something that did not happen — the same class of mistake as
-- marking an unscanned file QUARANTINED.
--
-- IF NOT EXISTS so a re-run is a no-op. ALTER TYPE ... ADD VALUE cannot be
-- rolled back but cannot break a reader either: an older build never emits
-- these, and every existing row keeps the value it had.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_PREPARED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_EVIDENCE_ATTACHED';
