-- Sprint 9B.6 — telling a provider their verification case was closed.
--
-- A distinct type from VERIFICATION_ACTION_REQUIRED because the two demand
-- opposite responses: one asks the provider to do something, the other tells
-- them there is nothing further to do on this case. Sharing a type would leave
-- the drawer saying "needs attention" about a decision that is final.
--
-- The notification carries NO reason code and no reviewer prose. A rejection
-- reason is a judgement about a person; it belongs behind the access-controlled
-- case, not in a row that is listed, cached and pushed to a device.
--
-- Additive and forward-only; notification rows are never rewritten.
--
-- ROLLBACK NOTE: PostgreSQL cannot remove an enum value. Reverting the code is
-- safe and needs no schema change.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'VERIFICATION_REJECTED';
