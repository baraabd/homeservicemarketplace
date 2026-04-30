-- Profile persistence stabilization: add the `city` column to
-- user_profiles so the Edit Profile city field can be persisted.
-- Strictly additive — only adds the new nullable column; no existing
-- columns are touched, no data is rewritten.
--
-- Rolls back conceptually with:
--   ALTER TABLE "user_profiles" DROP COLUMN "city";

ALTER TABLE "user_profiles" ADD COLUMN "city" TEXT;
