-- Sprint 9B.3 — the document slot a preparation is FOR, and the index that
-- makes prepare idempotent and race-safe.
--
-- Separate from 20260825120000 rather than appended to it: that migration had
-- already been applied to a database, and Prisma identifies an applied
-- migration by name — editing its SQL afterwards leaves the schema silently
-- half-built while `migrate status` still reports "up to date". Forward-only
-- is the rule precisely so that cannot happen.
--
-- Recording the slot server-side lets finalize build the VerificationDocument
-- from state the client never touches, instead of trusting a second
-- client-supplied kind at the end of the flow.
ALTER TABLE "MediaAsset" ADD COLUMN "pendingDocumentKind" "VerificationDocumentKind",
                         ADD COLUMN "pendingServiceCategoryId" TEXT;

ALTER TABLE "MediaAsset"
  ADD CONSTRAINT "MediaAsset_pendingServiceCategoryId_fkey"
  FOREIGN KEY ("pendingServiceCategoryId") REFERENCES "ServiceCategory"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── one open preparation per (case, kind, category) ─────────────────────────
--
-- Two jobs at once, and neither is achievable in the service layer alone,
-- because both are "at most one row like this" — a read followed by a write
-- that two concurrent requests both win:
--
--   idempotent prepare — a retried prepare collides here, and the service
--     returns the existing preparation instead of starting a second upload
--     for the same slot;
--
--   the count limit — concurrent prepares cannot each pass the
--     documents-per-case check and then both insert, because they cannot both
--     hold the same slot.
--
-- Scoped to OPEN preparations, so finalising or abandoning one frees the slot
-- and a provider can replace a rejected document.
--
-- NULLS NOT DISTINCT is load-bearing: every non-licence kind has a NULL
-- category, and under Postgres' default semantics two such rows would be
-- considered distinct and both would insert — the entire race this closes.
CREATE UNIQUE INDEX "media_asset_one_open_preparation_per_slot_uniq"
  ON "MediaAsset" ("verificationCaseId", "pendingDocumentKind", "pendingServiceCategoryId")
  NULLS NOT DISTINCT
  WHERE "uploadCompletedAt" IS NULL
    AND "deletedAt" IS NULL
    AND "verificationCaseId" IS NOT NULL;
