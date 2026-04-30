-- Sprint 3, slice 3.3: chat foundation (conversations + participants +
-- messages). Strictly additive — creates ONLY the new enum + 3 tables.
-- WebSocket / push / attachments / voice are out of scope and are NOT
-- introduced.
--
-- Rolls back conceptually with:
--   DROP TABLE "messages";
--   DROP TABLE "conversation_participants";
--   DROP TABLE "conversations";
--   DROP TYPE  "ConversationParticipantRole";

CREATE TYPE "ConversationParticipantRole" AS ENUM (
  'SEEKER',
  'PROVIDER',
  'SYSTEM'
);

-- ─── conversations ──────────────────────────────────────────────────────────
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "requestId" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversations_bookingId_idx" ON "conversations"("bookingId");
CREATE INDEX "conversations_requestId_idx" ON "conversations"("requestId");
-- Used by the conversations-list "active newest first" sort.
CREATE INDEX "conversations_updatedAt_idx" ON "conversations"("updatedAt");
CREATE INDEX "conversations_deletedAt_idx" ON "conversations"("deletedAt");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "service_requests"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── conversation_participants ──────────────────────────────────────────────
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "providerProfileId" TEXT,
    "role" "ConversationParticipantRole" NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- Primary ownership gate: "is this user a participant of this
-- conversation?" The unique index doubles as defence-in-depth against
-- duplicate participant rows for the same (conversation, user) pair.
-- Note: PostgreSQL treats NULL as distinct in UNIQUE indexes by
-- default, so SYSTEM / unlinked-Provider participants (userId NULL)
-- can coexist with the seeker row on the same conversation.
CREATE UNIQUE INDEX "conversation_participants_conversation_user_unique"
  ON "conversation_participants"("conversationId", "userId");
CREATE INDEX "conversation_participants_userId_idx"
  ON "conversation_participants"("userId");
CREATE INDEX "conversation_participants_providerProfileId_idx"
  ON "conversation_participants"("providerProfileId");

ALTER TABLE "conversation_participants"
  ADD CONSTRAINT "conversation_participants_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_participants"
  ADD CONSTRAINT "conversation_participants_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversation_participants"
  ADD CONSTRAINT "conversation_participants_providerProfileId_fkey"
  FOREIGN KEY ("providerProfileId") REFERENCES "provider_profiles"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── messages ───────────────────────────────────────────────────────────────
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderUserId" TEXT,
    "senderRole" "ConversationParticipantRole" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- Dominant access pattern: chronological message render.
CREATE INDEX "messages_conversationId_createdAt_idx"
  ON "messages"("conversationId", "createdAt");
CREATE INDEX "messages_deletedAt_idx" ON "messages"("deletedAt");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages"
  ADD CONSTRAINT "messages_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
