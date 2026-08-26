-- Sprint 9B.5 — notifying a provider that their verification needs attention.
--
-- A reviewer returning a case to the provider is the one event in this workflow
-- the provider cannot discover on their own: they have no reason to revisit a
-- screen they already submitted from. Without a notification the case sits in
-- ACTION_REQUIRED until they happen to look, which reads to them as silence and
-- to us as a stalled queue.
--
-- A distinct type rather than SYSTEM, because the notification drawer groups and
-- deep-links by type, and "SYSTEM" is where messages go to be ignored.
--
-- VERIFICATION_CASE as a resource type so the deep link targets the provider's
-- own verification screen. Never a document: notifications are listed, cached
-- and pushed to devices, and a link to a passport is not something to hand
-- around.
--
-- Additive and forward-only. Adding enum values cannot invalidate an existing
-- notification row, and notification rows are never rewritten, so there is
-- nothing to backfill.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove a value from an enum. Reverting the
-- code is safe and needs no schema change; existing rows keep their type.
--
-- Neither value is USED in this migration, which is what makes running them in
-- one transaction safe.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_ACTION_REQUIRED';
ALTER TYPE "NotificationResourceType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE';
