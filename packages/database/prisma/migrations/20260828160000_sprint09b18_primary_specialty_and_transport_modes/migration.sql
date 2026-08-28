-- Sprint 9B.18 — a primary specialty, and transport as a set rather than a single value.
--
-- Two additive columns on ProviderProfile. Nothing is dropped, nothing is
-- rewritten, and every existing reader keeps working unchanged.
--
-- WHY transportMode IS NOT REPLACED
--
-- `transportMode` is consumed today by matching, the public profile and the
-- onboarding policy. Turning it into an array would have meant rewriting all of
-- those in the same change that introduced the concept, and any one of them
-- missed would read an empty value as "no transport". So the column stays and
-- keeps its meaning — it is now explicitly the PRIMARY mode — and the new
-- column carries the full set, backfilled from it so the two agree from the
-- first moment.
--
-- A scalar enum list rather than a join table: there is no per-mode data to
-- carry and nothing joins on a single mode, so a two-column table for a
-- six-value enum would buy a migration and an index for nothing.
--
-- ROLLBACK / COMPATIBILITY
--
-- Rolling back is `ALTER TABLE ... DROP COLUMN` on both, and it loses nothing
-- that matters: the primary transport mode survives in `transportMode`, which
-- this migration never writes to, and `primaryServiceCategoryId` is a
-- preference a provider re-picks in one tap. Secondary modes would be lost,
-- which is why they are secondary.
--
-- Forward-compatibility runs the other way too: an OLD application binary
-- against a NEW database ignores both columns and behaves exactly as it did,
-- because `transportMode` still holds the answer it has always read.

ALTER TABLE "ProviderProfile"
  ADD COLUMN IF NOT EXISTS "transportModes" "ProviderTransportMode"[] NOT NULL DEFAULT ARRAY[]::"ProviderTransportMode"[];

ALTER TABLE "ProviderProfile"
  ADD COLUMN IF NOT EXISTS "primaryServiceCategoryId" TEXT;

-- Backfill: the existing single mode becomes the set.
--
-- Guarded on cardinality = 0 so re-running this migration against a database
-- where providers have since chosen additional modes cannot overwrite them
-- back down to one. Forward-only migrations are still replayed by the drift
-- gate and by `prisma migrate deploy` on a restored snapshot.
UPDATE "ProviderProfile"
  SET "transportModes" = ARRAY["transportMode"]
  WHERE "transportMode" IS NOT NULL
    AND cardinality("transportModes") = 0;

-- SET NULL rather than CASCADE: a category being removed must not delete a
-- provider's profile. Categories are soft-deleted in practice, so this fires
-- only if one is ever hard-deleted, and losing a title preference is the
-- correct casualty there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProviderProfile_primaryServiceCategoryId_fkey'
  ) THEN
    ALTER TABLE "ProviderProfile"
      ADD CONSTRAINT "ProviderProfile_primaryServiceCategoryId_fkey"
      FOREIGN KEY ("primaryServiceCategoryId") REFERENCES "ServiceCategory"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "Who leads with this category" — the read behind the catalogue's own stats
-- and the only query this column is asked.
CREATE INDEX IF NOT EXISTS "ProviderProfile_primaryServiceCategoryId_idx"
  ON "ProviderProfile" ("primaryServiceCategoryId");
