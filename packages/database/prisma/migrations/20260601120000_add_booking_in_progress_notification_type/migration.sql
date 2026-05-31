-- Sprint 7.x — add BOOKING_IN_PROGRESS to the NotificationType enum so
-- the provider-start lifecycle (SCHEDULED → IN_PROGRESS) creates a
-- persisted Seeker notification. Required so the polling fallback can
-- surface an "In Progress" toast even when the realtime socket is
-- offline / not yet connected.
--
-- Additive-only. Existing rows untouched. Safe to apply online; no
-- table rewrite.
--
-- Rollback: see the 20260531120000 migration for the same pattern.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_IN_PROGRESS';
