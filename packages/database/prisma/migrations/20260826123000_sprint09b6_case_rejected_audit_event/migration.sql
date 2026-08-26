-- Sprint 9B.6 — audit event for closing a verification case.
--
-- Its own type rather than a field on a shared one, for the reason the scan
-- events use separate types: "a case was rejected" is a fact an auditor
-- searches for BY NAME, and burying it in the metadata of a generic event is
-- exactly the search that fails when it matters.
--
-- Additive and forward-only; audit rows are never rewritten.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove an enum value.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_REJECTED';
