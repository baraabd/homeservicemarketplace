-- Sprint 8 — audit event types for catalogue administration.
--
-- The category tree and the equipment list decide what a provider can claim to
-- do and what a seeker can search for. `isLeaf` in particular is what makes a
-- category selectable at all, so an admin flipping it is a privileged act with
-- the same audit expectations as editing a person's standing.
--
-- Additive only. ALTER TYPE ... ADD VALUE cannot be rolled back, but it also
-- cannot break a reader: an older API build simply never emits these values,
-- and every existing row keeps the type it had.
--
-- IF NOT EXISTS so a re-run against a database that already has them is a
-- no-op rather than a failed deploy.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_CATEGORY_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_CATEGORY_UPDATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_EQUIPMENT_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_EQUIPMENT_UPDATED';
