-- G1-01 / G1-04. Additive, forward-only; never rewrite financial history.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'OUTBOX_DEAD_LETTER_REPLAYED';

-- Existing notifications keep NULL; only new domain producers opt in.
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

CREATE OR REPLACE FUNCTION money_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  confirmed BIGINT;
  committed BIGINT;
  compensation_status "LedgerTransactionStatus";
  compensation_kind "LedgerTransactionKind";
  compensation_currency TEXT;
  original_posting TEXT;
  compensation_original TEXT;
  compensation_reference TEXT;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."id", NEW."paymentConfirmationId", NEW."amountMinor", NEW."currency", NEW."reasonCode", NEW."idempotencyKey", NEW."requestDigest", NEW."createdAt")
       IS DISTINCT FROM
       (OLD."id", OLD."paymentConfirmationId", OLD."amountMinor", OLD."currency", OLD."reasonCode", OLD."idempotencyKey", OLD."requestDigest", OLD."createdAt")
       OR (OLD."externalRefundId" IS NOT NULL AND NEW."externalRefundId" IS DISTINCT FROM OLD."externalRefundId")
       OR (OLD."compensatingLedgerTransactionId" IS NOT NULL AND NEW."compensatingLedgerTransactionId" IS DISTINCT FROM OLD."compensatingLedgerTransactionId") THEN
      RAISE EXCEPTION 'A refund keeps its amount, payment and identifiers' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (
         (OLD."status" = 'RESERVED' AND NEW."status" IN ('DISPATCHED', 'CANCELLED'))
      OR (OLD."status" = 'DISPATCHED' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
    ) THEN
      RAISE EXCEPTION 'Refund cannot transition from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."status" <> 'RESERVED' THEN
    RAISE EXCEPTION 'A refund starts as RESERVED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT "amountMinor", "ledgerTransactionId" INTO confirmed, original_posting FROM "MoneyPaymentConfirmation"
    WHERE "id" = NEW."paymentConfirmationId" FOR UPDATE;
  SELECT COALESCE(sum("amountMinor"), 0) INTO committed FROM "MoneyRefund"
    WHERE "paymentConfirmationId" = NEW."paymentConfirmationId"
      AND "id" <> NEW."id"
      AND "status" IN ('RESERVED', 'DISPATCHED', 'SUCCEEDED');
  IF NEW."status" IN ('RESERVED', 'DISPATCHED', 'SUCCEEDED') AND committed + NEW."amountMinor" > confirmed THEN
    RAISE EXCEPTION 'Refunds cannot exceed the confirmed amount' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" = 'SUCCEEDED' AND NEW."compensatingLedgerTransactionId" IS NULL THEN
    RAISE EXCEPTION 'A succeeded refund requires its compensating posting' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."compensatingLedgerTransactionId" IS NOT NULL THEN
    SELECT "status", "kind", "currency", "reversesTransactionId", "externalReference" INTO compensation_status, compensation_kind, compensation_currency, compensation_original, compensation_reference
      FROM "LedgerTransaction" WHERE "id" = NEW."compensatingLedgerTransactionId";
    IF compensation_status IS DISTINCT FROM 'POSTED' OR compensation_currency IS DISTINCT FROM NEW."currency" THEN
      RAISE EXCEPTION 'A refund compensation must be a POSTED ledger transaction in the refund currency' USING ERRCODE = 'check_violation';
    END IF;
    IF compensation_kind = 'REVERSAL' THEN
      IF compensation_original IS DISTINCT FROM original_posting OR NEW."amountMinor" <> confirmed THEN
        RAISE EXCEPTION 'A refund reversal must mirror its own full confirmed posting' USING ERRCODE = 'check_violation';
      END IF;
    ELSIF compensation_reference IS DISTINCT FROM 'money.refund:' || NEW."id" THEN
      RAISE EXCEPTION 'A partial compensation must identify its refund' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum("amountMinor") FILTER (WHERE "side" = 'DEBIT'), 0),
           COALESCE(sum("amountMinor") FILTER (WHERE "side" = 'CREDIT'), 0)
      INTO debit_total, credit_total FROM "LedgerEntry"
      WHERE "transactionId" = NEW."compensatingLedgerTransactionId";
    IF debit_total <> NEW."amountMinor" OR credit_total <> NEW."amountMinor" THEN
      RAISE EXCEPTION 'Refund compensation amount must match its reservation' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "LedgerEntry" c
      WHERE c."transactionId" = NEW."compensatingLedgerTransactionId"
        AND NOT EXISTS (
          SELECT 1 FROM "LedgerEntry" o WHERE o."transactionId" = original_posting
            AND o."accountId" = c."accountId" AND o."side" <> c."side"
        )
    ) THEN
      RAISE EXCEPTION 'Refund compensation must reverse the original accounts and direction' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Validate existing linked/succeeded rows under the strengthened trigger.
-- Assigning status to itself changes no financial value. Any historical mismatch
-- aborts migration for owner reconciliation; nothing is silently repaired.
UPDATE "MoneyRefund" SET "status" = "status"
WHERE "status" = 'SUCCEEDED' OR "compensatingLedgerTransactionId" IS NOT NULL;
