-- Sprint 7.x — add REQUEST_AVAILABLE to the NotificationType enum so
-- the seeker-creates-request flow can fan out to matching providers
-- with a semantic enum (instead of overloading SYSTEM and losing the
-- ability to filter/aggregate by type).
--
-- Additive-only: existing rows are untouched; new value is appended to
-- the enum. Safe to run online; no table rewrite.
--
-- Rollback:
--   ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
--   CREATE TYPE "NotificationType" AS ENUM (
--     'BID_RECEIVED','BID_ACCEPTED','BOOKING_CREATED','BOOKING_CANCELLED',
--     'BOOKING_COMPLETED','MESSAGE_RECEIVED','REVIEW_REQUESTED','SYSTEM'
--   );
--   -- Re-bind columns, drop _old.
-- (Only viable if no rows reference REQUEST_AVAILABLE yet.)

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REQUEST_AVAILABLE';
