-- CreateEnum
CREATE TYPE "MoneyAdapterMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "MoneyExternalEventStatus" AS ENUM ('RECEIVED', 'PROCESSED');

-- CreateEnum
CREATE TYPE "MoneyRefundRequestStatus" AS ENUM ('PENDING_POLICY', 'AUTHORIZED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MoneyDispatchKind" AS ENUM ('COLLECTION', 'REFUND');

-- CreateEnum
CREATE TYPE "MoneyDispatchStatus" AS ENUM ('NOT_DISPATCHED', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_COMMAND_ACCEPTED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_EXTERNAL_EVENT_PROCESSED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_REFUND_RESULT_RECORDED';

-- CreateTable
CREATE TABLE "MoneyCommand" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorSystem" TEXT,
    "action" TEXT NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyIntentBinding" (
    "paymentIntentId" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyIntentBinding_pkey" PRIMARY KEY ("paymentIntentId")
);

-- CreateTable
CREATE TABLE "MoneyExternalEvent" (
    "id" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "externalConfirmationId" TEXT NOT NULL,
    "externalOperationId" TEXT,
    "paymentIntentId" TEXT NOT NULL,
    "paymentAttemptId" TEXT,
    "source" "MoneyConfirmationSource" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "receiptMediaAssetId" TEXT,
    "reviewerUserId" TEXT,
    "requestDigest" CHAR(64) NOT NULL,
    "status" "MoneyExternalEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "MoneyExternalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyRefundRequest" (
    "id" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "paymentConfirmationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" "MoneyRefundRequestStatus" NOT NULL DEFAULT 'PENDING_POLICY',
    "policyVersion" TEXT,
    "decisionCode" TEXT,
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyRefundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyDispatch" (
    "id" TEXT NOT NULL,
    "kind" "MoneyDispatchKind" NOT NULL,
    "commandId" TEXT NOT NULL,
    "paymentAttemptId" TEXT,
    "refundId" TEXT,
    "paymentIntentId" TEXT NOT NULL,
    "providerIdempotencyKey" TEXT NOT NULL,
    "status" "MoneyDispatchStatus" NOT NULL DEFAULT 'NOT_DISPATCHED',
    "claimId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "externalOperationId" TEXT,
    "observation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyCommand_idempotencyKey_key" ON "MoneyCommand"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyCommand_actorUserId_createdAt_id_idx" ON "MoneyCommand"("actorUserId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyIntentBinding_paymentIntentId_currency_key" ON "MoneyIntentBinding"("paymentIntentId", "currency");

-- CreateIndex
CREATE INDEX "MoneyExternalEvent_status_createdAt_id_idx" ON "MoneyExternalEvent"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MoneyExternalEvent_paymentIntentId_createdAt_id_idx" ON "MoneyExternalEvent"("paymentIntentId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyExternalEvent_scoped_identity_key" ON "MoneyExternalEvent"("adapterId", "mode", "accountReference", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRefundRequest_commandId_key" ON "MoneyRefundRequest"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRefundRequest_refundId_key" ON "MoneyRefundRequest"("refundId");

-- CreateIndex
CREATE INDEX "MoneyRefundRequest_providerProfileId_createdAt_id_idx" ON "MoneyRefundRequest"("providerProfileId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "MoneyRefundRequest_status_createdAt_id_idx" ON "MoneyRefundRequest"("status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyDispatch_commandId_key" ON "MoneyDispatch"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyDispatch_paymentAttemptId_key" ON "MoneyDispatch"("paymentAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyDispatch_refundId_key" ON "MoneyDispatch"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyDispatch_providerIdempotencyKey_key" ON "MoneyDispatch"("providerIdempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyDispatch_status_leaseUntil_id_idx" ON "MoneyDispatch"("status", "leaseUntil", "id");

-- AddForeignKey
ALTER TABLE "MoneyCommand" ADD CONSTRAINT "MoneyCommand_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyIntentBinding" ADD CONSTRAINT "MoneyIntentBinding_paymentIntentId_currency_fkey" FOREIGN KEY ("paymentIntentId", "currency") REFERENCES "MoneyPaymentIntent"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyIntentBinding" ADD CONSTRAINT "MoneyIntentBinding_debitAccountId_currency_fkey" FOREIGN KEY ("debitAccountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyIntentBinding" ADD CONSTRAINT "MoneyIntentBinding_creditAccountId_currency_fkey" FOREIGN KEY ("creditAccountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyExternalEvent" ADD CONSTRAINT "MoneyExternalEvent_paymentIntentId_currency_fkey" FOREIGN KEY ("paymentIntentId", "currency") REFERENCES "MoneyPaymentIntent"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyExternalEvent" ADD CONSTRAINT "MoneyExternalEvent_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "MoneyPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyExternalEvent" ADD CONSTRAINT "MoneyExternalEvent_receiptMediaAssetId_fkey" FOREIGN KEY ("receiptMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyExternalEvent" ADD CONSTRAINT "MoneyExternalEvent_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefundRequest" ADD CONSTRAINT "MoneyRefundRequest_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "MoneyCommand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefundRequest" ADD CONSTRAINT "MoneyRefundRequest_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefundRequest" ADD CONSTRAINT "MoneyRefundRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefundRequest" ADD CONSTRAINT "MoneyRefundRequest_paymentConfirmationId_currency_fkey" FOREIGN KEY ("paymentConfirmationId", "currency") REFERENCES "MoneyPaymentConfirmation"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefundRequest" ADD CONSTRAINT "MoneyRefundRequest_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "MoneyRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyDispatch" ADD CONSTRAINT "MoneyDispatch_commandId_fkey" FOREIGN KEY ("commandId") REFERENCES "MoneyCommand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyDispatch" ADD CONSTRAINT "MoneyDispatch_paymentAttemptId_fkey" FOREIGN KEY ("paymentAttemptId") REFERENCES "MoneyPaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyDispatch" ADD CONSTRAINT "MoneyDispatch_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "MoneyRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyDispatch" ADD CONSTRAINT "MoneyDispatch_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyIntentBinding"("paymentIntentId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- R24: database authority for durable orchestration. No money backfill.
-- Child records and their immutable command response commit together. The
-- application inserts the command snapshot last in the caller-owned tx.
ALTER TABLE "MoneyRefundRequest" ALTER CONSTRAINT "MoneyRefundRequest_commandId_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "MoneyDispatch" ALTER CONSTRAINT "MoneyDispatch_commandId_fkey" DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "MoneyCommand"
  ADD CONSTRAINT "MoneyCommand_one_actor" CHECK (("actorUserId" IS NOT NULL) <> ("actorSystem" IS NOT NULL)),
  ADD CONSTRAINT "MoneyCommand_key_shape" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "MoneyCommand_digest_shape" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "MoneyCommand_version" CHECK ("contractVersion" = 'hsm.money.v1'),
  ADD CONSTRAINT "MoneyCommand_action_shape" CHECK ("action" ~ '^[A-Za-z][A-Za-z0-9._:-]{1,63}$'),
  ADD CONSTRAINT "MoneyCommand_system_shape" CHECK ("actorSystem" IS NULL OR "actorSystem" ~ '^[a-z][a-z0-9._-]{2,79}$'),
  ADD CONSTRAINT "MoneyCommand_response_object" CHECK (jsonb_typeof("response") = 'object');

ALTER TABLE "MoneyIntentBinding"
  ADD CONSTRAINT "MoneyIntentBinding_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyIntentBinding_distinct_accounts" CHECK ("debitAccountId" <> "creditAccountId"),
  ADD CONSTRAINT "MoneyIntentBinding_identifiers" CHECK (
    length("adapterId") BETWEEN 1 AND 80 AND length("accountReference") BETWEEN 1 AND 200
    AND length("configVersion") BETWEEN 1 AND 100);

ALTER TABLE "MoneyExternalEvent"
  ADD CONSTRAINT "MoneyExternalEvent_positive_amount" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "MoneyExternalEvent_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyExternalEvent_digest_shape" CHECK ("requestDigest" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "MoneyExternalEvent_identifiers" CHECK (
    length("adapterId") BETWEEN 1 AND 80 AND length("accountReference") BETWEEN 1 AND 200
    AND length("externalEventId") BETWEEN 1 AND 200 AND length("externalConfirmationId") BETWEEN 1 AND 200),
  ADD CONSTRAINT "MoneyExternalEvent_receipt_source" CHECK (
    ("source" = 'MANUAL_REVIEW' AND "receiptMediaAssetId" IS NOT NULL AND "reviewerUserId" IS NOT NULL AND "externalOperationId" IS NULL)
    OR ("source" = 'PROVIDER_WEBHOOK' AND "receiptMediaAssetId" IS NULL AND "reviewerUserId" IS NULL
      AND "paymentAttemptId" IS NOT NULL AND "externalOperationId" IS NOT NULL AND length("externalOperationId") BETWEEN 1 AND 200)),
  ADD CONSTRAINT "MoneyExternalEvent_completion" CHECK (
    ("status" = 'RECEIVED' AND "processedAt" IS NULL AND "response" IS NULL)
    OR ("status" = 'PROCESSED' AND "processedAt" IS NOT NULL AND "response" IS NOT NULL AND jsonb_typeof("response") = 'object'));

ALTER TABLE "MoneyRefundRequest"
  ADD CONSTRAINT "MoneyRefundRequest_positive_amount" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "MoneyRefundRequest_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyRefundRequest_reason" CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT "MoneyRefundRequest_policy_state" CHECK (
    ("status" = 'PENDING_POLICY' AND "refundId" IS NULL AND "policyVersion" IS NULL AND "decisionCode" IS NULL)
    OR ("status" = 'AUTHORIZED' AND "refundId" IS NOT NULL AND "policyVersion" IS NOT NULL AND length("policyVersion") BETWEEN 1 AND 100 AND "decisionCode" IS NULL)
    OR ("status" = 'REJECTED' AND "refundId" IS NULL AND "policyVersion" IS NOT NULL AND "decisionCode" IS NOT NULL AND length("policyVersion") BETWEEN 1 AND 100 AND length("decisionCode") BETWEEN 1 AND 64));

ALTER TABLE "MoneyDispatch"
  ADD CONSTRAINT "MoneyDispatch_subject" CHECK (
    ("kind" = 'COLLECTION' AND "paymentAttemptId" IS NOT NULL AND "refundId" IS NULL)
    OR ("kind" = 'REFUND' AND "paymentAttemptId" IS NULL AND "refundId" IS NOT NULL)),
  ADD CONSTRAINT "MoneyDispatch_claim_pair" CHECK (("claimId" IS NULL) = ("leaseUntil" IS NULL)),
  ADD CONSTRAINT "MoneyDispatch_key_shape" CHECK ("providerIdempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "MoneyDispatch_operation_shape" CHECK ("externalOperationId" IS NULL OR length("externalOperationId") BETWEEN 1 AND 200),
  ADD CONSTRAINT "MoneyDispatch_observation_shape" CHECK ("observation" IS NULL OR jsonb_typeof("observation") = 'object');

CREATE FUNCTION r24_money_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'R24 money history cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'R24 money identity and response are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyCommand_immutable" BEFORE UPDATE OR DELETE ON "MoneyCommand"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();
CREATE TRIGGER "MoneyIntentBinding_immutable" BEFORE UPDATE OR DELETE ON "MoneyIntentBinding"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();

CREATE FUNCTION r24_money_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bound "MoneyIntentBinding"%ROWTYPE;
  expected_amount BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Normalized money events cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RECEIVED' THEN
      RAISE EXCEPTION 'Money evidence starts as retryable RECEIVED' USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO bound FROM "MoneyIntentBinding" WHERE "paymentIntentId" = NEW."paymentIntentId";
    SELECT "totalMinor" INTO expected_amount FROM "MoneyPaymentIntent" WHERE "id" = NEW."paymentIntentId";
    IF bound."paymentIntentId" IS NULL OR (bound."adapterId", bound."mode", bound."accountReference", bound."currency")
      IS DISTINCT FROM (NEW."adapterId", NEW."mode", NEW."accountReference", NEW."currency")
      OR expected_amount IS DISTINCT FROM NEW."amountMinor" THEN
      RAISE EXCEPTION 'Normalized event differs from its immutable obligation binding' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."paymentAttemptId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "MoneyPaymentAttempt" WHERE "id" = NEW."paymentAttemptId" AND "paymentIntentId" = NEW."paymentIntentId") THEN
      RAISE EXCEPTION 'Money event attempt belongs to another obligation' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','response','processedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','response','processedAt'])
      OR (OLD."status" = 'PROCESSED' AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION 'Normalized evidence and processed response are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'RECEIVED' AND NEW."status" = 'PROCESSED') THEN
      RAISE EXCEPTION 'Invalid money event transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyExternalEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyExternalEvent"
  FOR EACH ROW EXECUTE FUNCTION r24_money_event_guard();

CREATE FUNCTION r24_refund_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Refund requests cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'PENDING_POLICY' THEN
      RAISE EXCEPTION 'A refund request starts pending policy' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "MoneyPaymentConfirmation" c
      JOIN "MoneyPaymentIntent" i ON i."id" = c."paymentIntentId"
      JOIN "ProviderProfile" p ON p."id" = i."providerProfileId"
      WHERE c."id" = NEW."paymentConfirmationId" AND i."providerProfileId" = NEW."providerProfileId"
        AND p."userId" = NEW."requestedByUserId" AND c."currency" = NEW."currency"
        AND NEW."amountMinor" <= c."amountMinor") THEN
      RAISE EXCEPTION 'Refund request owner or amount differs from confirmed obligation' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','policyVersion','decisionCode','refundId','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','policyVersion','decisionCode','refundId','updatedAt'])
      OR (OLD."status" <> 'PENDING_POLICY' AND (to_jsonb(NEW) - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt')) THEN
      RAISE EXCEPTION 'Refund request identity and policy decision are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" = 'AUTHORIZED' AND NOT EXISTS (
      SELECT 1 FROM "MoneyRefund" r WHERE r."id" = NEW."refundId"
        AND r."paymentConfirmationId" = NEW."paymentConfirmationId"
        AND r."amountMinor" = NEW."amountMinor" AND r."currency" = NEW."currency"
        AND r."reasonCode" = NEW."reasonCode") THEN
      RAISE EXCEPTION 'Reservation differs from its authorized refund request' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyRefundRequest_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyRefundRequest"
  FOR EACH ROW EXECUTE FUNCTION r24_refund_request_guard();

CREATE FUNCTION r24_money_dispatch_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Money dispatch history cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'NOT_DISPATCHED' THEN
      RAISE EXCEPTION 'Dispatch must be durable before a network attempt' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."kind" = 'COLLECTION' AND NOT EXISTS (
      SELECT 1 FROM "MoneyPaymentAttempt" a WHERE a."id" = NEW."paymentAttemptId" AND a."paymentIntentId" = NEW."paymentIntentId") THEN
      RAISE EXCEPTION 'Collection dispatch differs from its obligation' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW."kind" = 'REFUND' AND NOT EXISTS (
      SELECT 1 FROM "MoneyRefund" r JOIN "MoneyPaymentConfirmation" c ON c."id" = r."paymentConfirmationId"
      WHERE r."id" = NEW."refundId" AND c."paymentIntentId" = NEW."paymentIntentId") THEN
      RAISE EXCEPTION 'Refund dispatch differs from its obligation' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','claimId','leaseUntil','externalOperationId','observation','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','claimId','leaseUntil','externalOperationId','observation','updatedAt']) THEN
      RAISE EXCEPTION 'Dispatch obligation and provider key are immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."externalOperationId" IS NOT NULL AND NEW."externalOperationId" IS DISTINCT FROM OLD."externalOperationId" THEN
      RAISE EXCEPTION 'External operation identity cannot be replaced' USING ERRCODE = 'restrict_violation';
    END IF;
    -- A verified terminal refund observation is durable before compensation.
    -- Local recovery may update its claim/status, but cannot replace or erase
    -- the external evidence when the ledger/audit transaction must be retried.
    IF OLD."kind" = 'REFUND' AND OLD."observation"->>'status' IN ('SUCCEEDED','FAILED')
      AND NEW."observation" IS DISTINCT FROM OLD."observation" THEN
      RAISE EXCEPTION 'Verified terminal refund evidence cannot be replaced' USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD."status" IN ('SUCCEEDED','FAILED') AND (to_jsonb(NEW) - 'updatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt') THEN
      RAISE EXCEPTION 'Terminal transport observation is immutable' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."status" <> OLD."status" AND NOT (
      (OLD."status" IN ('NOT_DISPATCHED','UNKNOWN') AND NEW."status" = 'PENDING')
      OR (OLD."status" = 'PENDING' AND NEW."status" IN ('UNKNOWN','SUCCEEDED','FAILED'))
      -- Verified authoritative evidence can resolve a previously unknown
      -- outcome without another network dispatch. Financial state is checked
      -- by the deferred guard below, after the whole transaction completes.
      OR (OLD."status" IN ('NOT_DISPATCHED','UNKNOWN') AND NEW."status" IN ('SUCCEEDED','FAILED'))
    ) THEN
      RAISE EXCEPTION 'Invalid dispatch knowledge transition' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "MoneyDispatch_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyDispatch"
  FOR EACH ROW EXECUTE FUNCTION r24_money_dispatch_guard();

CREATE FUNCTION r24_dispatch_finality_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_dispatch "MoneyDispatch"%ROWTYPE;
BEGIN
  SELECT * INTO current_dispatch FROM "MoneyDispatch" WHERE "id" = NEW."id";
  IF current_dispatch."status" IN ('SUCCEEDED','FAILED') THEN
    IF current_dispatch."kind" = 'COLLECTION' AND NOT EXISTS (
      SELECT 1 FROM "MoneyPaymentAttempt" a WHERE a."id" = current_dispatch."paymentAttemptId"
        AND a."status"::text = current_dispatch."status"::text) THEN
      RAISE EXCEPTION 'Terminal collection requires its matching attempt outcome' USING ERRCODE = 'check_violation';
    END IF;
    IF current_dispatch."kind" = 'REFUND' AND NOT EXISTS (
      SELECT 1 FROM "MoneyRefund" r WHERE r."id" = current_dispatch."refundId"
        AND r."status"::text = current_dispatch."status"::text) THEN
      RAISE EXCEPTION 'Terminal refund requires its matching financial outcome' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "MoneyDispatch_finality"
  AFTER INSERT OR UPDATE ON "MoneyDispatch" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION r24_dispatch_finality_guard();

-- Definitions only. There is deliberately no RolePermission or UserRole write.
INSERT INTO "Permission" ("id", "key", "description", "createdAt", "updatedAt") VALUES
 ('r24-money-purchase-self', 'money:purchase:self', 'Request server-priced purchases for the authenticated provider', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('r24-money-read-self', 'money:read:self', 'Read the authenticated provider subscription money records', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('r24-money-refund-request-self', 'money:refund:request:self', 'Request review of a refund for an owned confirmed subscription payment', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('r24-money-review-read', 'money:review:read', 'Read subscription money review projections', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('r24-money-receipt-review', 'money:receipt:review', 'Accept verified restricted subscription receipt evidence', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('r24-money-refund-review', 'money:refund:review', 'Invoke configured refund policy and transport orchestration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
