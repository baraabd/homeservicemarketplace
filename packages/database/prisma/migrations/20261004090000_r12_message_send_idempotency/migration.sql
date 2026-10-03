-- R12 — message send replay safety.
--
-- A client-generated key for one logical send. A retry after a lost reply
-- carries the same key and gets the stored message back instead of a second
-- row. Scoped to the sender within one conversation, so a key can only ever
-- find that sender's own message there.
--
-- Nullable for rolling-deploy compatibility: existing rows and keyless clients
-- remain valid (PostgreSQL treats NULLs as distinct in a unique index).
ALTER TABLE "Message"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Message_conversationId_senderUserId_idempotencyKey_key"
  ON "Message"("conversationId", "senderUserId", "idempotencyKey");
