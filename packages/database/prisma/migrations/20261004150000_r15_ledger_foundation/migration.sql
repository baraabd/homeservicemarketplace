-- R15 — authoritative double-entry ledger foundation (DARK).
--
-- Additive only. No route, payment rail or automatic posting uses these
-- tables; no historical row is created (no financial backfill). See
-- docs/production-readiness/r15/ACCOUNTING_POLICY.md and LEDGER_INVARIANTS.md.
--
-- Prisma-generated DDL first, then the invariants Prisma cannot express:
-- CHECK constraints and triggers that make PostgreSQL itself refuse an
-- unbalanced, mixed-currency, half-written or edited posting.

-- CreateEnum
CREATE TYPE "LedgerAccountOwnerType" AS ENUM ('PLATFORM', 'USER');

-- CreateEnum
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "LedgerTransactionKind" AS ENUM ('STANDARD', 'REVERSAL');

-- CreateEnum
CREATE TYPE "LedgerEntrySide" AS ENUM ('DEBIT', 'CREDIT');



ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_LEDGER_POSTED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_LEDGER_REVERSED';

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ownerType" "LedgerAccountOwnerType" NOT NULL,
    "ownerUserId" TEXT,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "kind" "LedgerTransactionKind" NOT NULL,
    "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "bookingId" TEXT,
    "externalReference" TEXT,
    "reversesTransactionId" TEXT,
    "actorUserId" TEXT,
    "actorSystem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "side" "LedgerEntrySide" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_key_key" ON "LedgerAccount"("key");

-- CreateIndex
CREATE INDEX "LedgerAccount_ownerUserId_idx" ON "LedgerAccount"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_id_currency_key" ON "LedgerAccount"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversesTransactionId_key" ON "LedgerTransaction"("reversesTransactionId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_bookingId_idx" ON "LedgerTransaction"("bookingId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_externalReference_idx" ON "LedgerTransaction"("externalReference");

-- CreateIndex
CREATE INDEX "LedgerTransaction_status_postedAt_idx" ON "LedgerTransaction"("status", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_id_currency_key" ON "LedgerTransaction"("id", "currency");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_id_idx" ON "LedgerEntry"("accountId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_transactionId_lineNo_key" ON "LedgerEntry"("transactionId", "lineNo");

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversesTransactionId_fkey" FOREIGN KEY ("reversesTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_currency_fkey" FOREIGN KEY ("transactionId", "currency") REFERENCES "LedgerTransaction"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_currency_fkey" FOREIGN KEY ("accountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Row-level CHECK constraints ────────────────────────────────────────────

-- Uppercase ISO-4217-shaped code. Which codes are supported is policy, not
-- schema; R15 approves none beyond the shape (CURRENCY_POLICY.md).
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');
-- A stable machine key; no business meaning is assigned in R15.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_key_format"
  CHECK ("key" ~ '^[a-z0-9][a-z0-9:._-]{2,119}$');
-- A platform account has no user owner; a user account always has one.
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_owner_consistent"
  CHECK (("ownerType" = 'PLATFORM' AND "ownerUserId" IS NULL)
      OR ("ownerType" = 'USER' AND "ownerUserId" IS NOT NULL));

ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_description_length"
  CHECK (char_length("description") BETWEEN 1 AND 200);
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_idempotency_key_format"
  CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$');
-- SHA-256 hex of the canonical command; same key + different digest = conflict.
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_request_digest_format"
  CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');
-- An opaque external identifier only. It never means money was captured.
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_external_reference_length"
  CHECK ("externalReference" IS NULL OR char_length("externalReference") BETWEEN 1 AND 200);
-- A reversal always names its original; nothing else may.
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversal_link"
  CHECK (("kind" = 'REVERSAL') = ("reversesTransactionId" IS NOT NULL));
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_not_self_reversal"
  CHECK ("reversesTransactionId" IS NULL OR "reversesTransactionId" <> "id");
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_posted_at_consistent"
  CHECK (("status" = 'POSTED') = ("postedAt" IS NOT NULL));
-- Exactly one accountable actor: a user (fresh-permission checked) or a
-- named internal system caller.
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_single_actor"
  CHECK (("actorUserId" IS NULL) <> ("actorSystem" IS NULL));
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_actor_system_format"
  CHECK ("actorSystem" IS NULL OR "actorSystem" ~ '^[a-z][a-z0-9._-]{2,63}$');

-- Positive integer minor units; the side carries the direction. Zero-value
-- lines are refused: they record nothing.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive"
  CHECK ("amountMinor" > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_line_positive"
  CHECK ("lineNo" >= 1);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_currency_format"
  CHECK ("currency" ~ '^[A-Z]{3}$');

-- ─── Accounts are immutable once opened ─────────────────────────────────────

CREATE FUNCTION "ledger_account_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger account % is immutable', OLD."id"
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerAccount_immutable"
  BEFORE UPDATE ON "LedgerAccount"
  FOR EACH ROW EXECUTE FUNCTION "ledger_account_immutable"();

-- ─── Transactions: born DRAFT, posted once, never edited ───────────────────

CREATE FUNCTION "ledger_transaction_insert_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'DRAFT' OR NEW."postedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'a ledger transaction must be created as DRAFT and posted by validation'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_insert_guard"
  BEFORE INSERT ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION "ledger_transaction_insert_guard"();

-- The only permitted update is DRAFT -> POSTED, and only when every invariant
-- holds over the entries as they exist inside the posting transaction.
CREATE FUNCTION "ledger_transaction_post_guard"() RETURNS trigger AS $$
DECLARE
  entry_count   integer;
  debit_total   numeric;
  credit_total  numeric;
  debit_lines   integer;
  credit_lines  integer;
  original      "LedgerTransaction"%ROWTYPE;
  mismatch      integer;
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'posted ledger transaction % is immutable', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> 'POSTED' THEN
    RAISE EXCEPTION 'a draft ledger transaction can only change by being posted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."requestDigest" IS DISTINCT FROM OLD."requestDigest"
     OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
     OR NEW."externalReference" IS DISTINCT FROM OLD."externalReference"
     OR NEW."reversesTransactionId" IS DISTINCT FROM OLD."reversesTransactionId"
     OR NEW."actorUserId" IS DISTINCT FROM OLD."actorUserId"
     OR NEW."actorSystem" IS DISTINCT FROM OLD."actorSystem"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'posting may not change the references of a ledger transaction'
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*),
         COALESCE(sum("amountMinor") FILTER (WHERE "side" = 'DEBIT'), 0),
         COALESCE(sum("amountMinor") FILTER (WHERE "side" = 'CREDIT'), 0),
         count(*) FILTER (WHERE "side" = 'DEBIT'),
         count(*) FILTER (WHERE "side" = 'CREDIT')
    INTO entry_count, debit_total, credit_total, debit_lines, credit_lines
    FROM "LedgerEntry" WHERE "transactionId" = NEW."id";

  IF entry_count < 2 OR debit_lines = 0 OR credit_lines = 0 THEN
    RAISE EXCEPTION 'ledger transaction % needs at least one debit and one credit', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."kind" = 'REVERSAL' THEN
    SELECT * INTO original FROM "LedgerTransaction"
      WHERE "id" = NEW."reversesTransactionId" FOR SHARE;
    IF original."id" IS NULL OR original."status" <> 'POSTED' THEN
      RAISE EXCEPTION 'only a posted ledger transaction can be reversed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF original."kind" <> 'STANDARD' THEN
      RAISE EXCEPTION 'a reversal cannot itself be reversed'
        USING ERRCODE = 'check_violation';
    END IF;
    IF original."currency" <> NEW."currency" THEN
      RAISE EXCEPTION 'a reversal must use the original currency'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Exact mirror: same accounts and amounts, opposite sides, as multisets.
    SELECT count(*) INTO mismatch FROM (
      (SELECT "accountId",
              CASE "side" WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END AS mirrored_side,
              "amountMinor"
         FROM "LedgerEntry" WHERE "transactionId" = original."id"
       EXCEPT ALL
       SELECT "accountId", "side"::text, "amountMinor"
         FROM "LedgerEntry" WHERE "transactionId" = NEW."id")
      UNION ALL
      (SELECT "accountId", "side"::text, "amountMinor"
         FROM "LedgerEntry" WHERE "transactionId" = NEW."id"
       EXCEPT ALL
       SELECT "accountId",
              CASE "side" WHEN 'DEBIT' THEN 'CREDIT' ELSE 'DEBIT' END,
              "amountMinor"
         FROM "LedgerEntry" WHERE "transactionId" = original."id")
    ) AS diff;
    IF mismatch <> 0 THEN
      RAISE EXCEPTION 'a reversal must mirror every entry of the original'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_post_guard"
  BEFORE UPDATE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION "ledger_transaction_post_guard"();

CREATE FUNCTION "ledger_transaction_delete_guard"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'posted ledger transaction % cannot be deleted', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_delete_guard"
  BEFORE DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION "ledger_transaction_delete_guard"();

-- ─── Entries: written only into a DRAFT, never edited ──────────────────────

CREATE FUNCTION "ledger_entry_guard"() RETURNS trigger AS $$
DECLARE
  parent_id     text;
  parent_status "LedgerTransactionStatus";
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'ledger entries are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    parent_id := OLD."transactionId";
  ELSE
    parent_id := NEW."transactionId";
  END IF;
  -- FOR SHARE serializes against the posting UPDATE of the same header, so
  -- an entry can never slip into a transaction while it is being posted.
  SELECT "status" INTO parent_status FROM "LedgerTransaction"
    WHERE "id" = parent_id FOR SHARE;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'entries of a posted ledger transaction are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_guard"();

-- ─── Capabilities: registered, granted to no live role (dark) ──────────────

INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt") VALUES
  ('perm_ledger_read', 'ledger:read', 'Read ledger accounts, balances and transactions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('perm_ledger_post', 'ledger:post', 'Post or reverse a ledger transaction', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
