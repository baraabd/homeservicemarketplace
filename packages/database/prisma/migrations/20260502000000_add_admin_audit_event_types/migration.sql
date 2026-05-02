-- Sprint 6.0: extend AuditEventType with admin-action values used by
-- the upcoming admin sprints (6.1 user control, 6.2 provider verification,
-- 6.3 disputes, 6.5 settings). Adding values is forward-compatible —
-- existing rows continue to deserialise unchanged.

ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_USER_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_USER_RESTORED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_PROVIDER_APPROVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_PROVIDER_REJECTED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_PROVIDER_SUSPENDED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_DISPUTE_OPENED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_DISPUTE_RESOLVED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'ADMIN_SETTING_UPDATED';
