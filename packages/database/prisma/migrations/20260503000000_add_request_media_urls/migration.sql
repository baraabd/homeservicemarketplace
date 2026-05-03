-- Sprint 7.x: add ServiceRequest.mediaUrls (text[] default '{}').
--
-- Existing rows pick up the empty-array default with no backfill cost:
-- Postgres treats DEFAULT '{}' as a zero-length array literal, and
-- pre-existing rows are filled with that literal at ALTER TABLE time
-- without a column rewrite (Postgres 11+ optimisation for ADD COLUMN
-- with constant default).
ALTER TABLE "ServiceRequest"
  ADD COLUMN "mediaUrls" TEXT[] NOT NULL DEFAULT '{}'::text[];
