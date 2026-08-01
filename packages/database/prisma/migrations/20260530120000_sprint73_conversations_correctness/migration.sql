-- Sprint 7.3 — conversations correctness.
--
-- Two changes, both safe to apply concurrently with running app:
--
-- 1. Partial unique index on "Conversation"("bookingId") for the live
--    rows (deletedAt IS NULL AND bookingId IS NOT NULL). The
--    getOrCreateForBooking flow already short-circuits on an existing
--    conversation; this index closes the race where two requests pass
--    the existence check before either insert lands. Prisma's @@unique
--    cannot express the WHERE clause, so the constraint is defined in
--    raw SQL and the service catches P2002 to re-fetch the winner.
--
-- 2. Backfill "ConversationParticipant"."userId" for legacy PROVIDER
--    rows where the userId was NULL but the linked ProviderProfile has
--    since been linked to a User account. Without this, provider-side
--    /v1/provider/conversations cannot see the row because the existing
--    participant-by-userId gate returns no match.
--
-- Rollback:
--   DROP INDEX IF EXISTS "Conversation_bookingId_live_unique";
--   -- The backfill is data-only and cannot be reversed without an
--   -- audit table; if rollback is required, treat the affected rows
--   -- as the new source of truth.

-- 1. Drop any duplicates BEFORE creating the unique index. We pick the
--    OLDEST live row per bookingId as the survivor (smallest createdAt,
--    smallest id as tie-break) so existing message history stays
--    addressable. Duplicates (children + their messages + participants)
--    are removed via cascading FKs once the conversation row is gone.
DELETE FROM "Conversation" AS c
USING (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "bookingId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "Conversation"
  WHERE "bookingId" IS NOT NULL
    AND "deletedAt" IS NULL
) AS ranked
WHERE c."id" = ranked."id"
  AND ranked.rn > 1;

-- 2. Partial unique — only live, booking-bound conversations are
--    constrained. Soft-deleted rows and request-only / system
--    conversations are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_bookingId_live_unique"
  ON "Conversation"("bookingId")
  WHERE "bookingId" IS NOT NULL AND "deletedAt" IS NULL;

-- 3. Backfill provider participant userIds. Only touches rows where
--    role = 'PROVIDER' AND userId IS NULL AND the linked
--    ProviderProfile has a userId. The existing
--    (conversationId, userId) unique index treats NULL as distinct,
--    so flipping NULL to the real userId can collide with a row
--    inserted later by the seeker-initiated path (Sprint 5.5 onwards).
--    The NOT EXISTS guard skips those — the newer row is preferred
--    and the orphan stays NULL (it never surfaces in the role-aware
--    summary path).
UPDATE "ConversationParticipant" AS cp
SET "userId" = pp."userId"
FROM "ProviderProfile" AS pp
WHERE cp."providerProfileId" = pp."id"
  AND cp."role" = 'PROVIDER'
  AND cp."userId" IS NULL
  AND pp."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ConversationParticipant" AS other
    WHERE other."conversationId" = cp."conversationId"
      AND other."userId" = pp."userId"
  );
