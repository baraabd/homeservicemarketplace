-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_RECEIPT_UPLOADED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_RECEIPT_SCANNED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_RECEIPT_VIEWED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_MANUAL_REVIEW_DECIDED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_MANUAL_SETTLEMENT_RECORDED';
ALTER TYPE "AuditEventType" ADD VALUE 'MONEY_MANUAL_REFUND_RECORDED';

-- AlterEnum
ALTER TYPE "MediaAssetPurpose" ADD VALUE 'FINANCIAL_RECEIPT';

-- CreateTable
CREATE TABLE "MoneyManualInstructionVersion" (
    "id" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "method" "MoneyPaymentMethod" NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL DEFAULT 'SANDBOX',
    "adapterId" TEXT NOT NULL,
    "accountReference" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "configVersion" TEXT NOT NULL,
    "instructions" JSONB NOT NULL,
    "market" TEXT NOT NULL,
    "minorUnitScale" INTEGER NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "referencePolicy" TEXT NOT NULL,
    "maxAmountMinor" BIGINT NOT NULL,
    "receiptMaxBytes" INTEGER NOT NULL,
    "uploadTtlSeconds" INTEGER NOT NULL,
    "quoteTtlSeconds" INTEGER NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualInstructionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyManualReceiptVersion" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "predecessorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "MoneyManualReceiptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyManualReview" (
    "paymentIntentId" TEXT NOT NULL,
    "instructionVersionId" TEXT NOT NULL,
    "currentReceiptId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'RECEIPT_REQUIRED',
    "pendingDecisionId" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyManualReview_pkey" PRIMARY KEY ("paymentIntentId")
);

-- CreateTable
CREATE TABLE "MoneyManualReviewDecision" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "settlementId" TEXT,
    "expectedVersion" INTEGER NOT NULL,
    "providerMessage" TEXT NOT NULL,
    "internalNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyManualSettlement" (
    "id" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" TEXT NOT NULL,
    "referenceCanonical" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "evidenceSource" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyManualSettlementClaim" (
    "settlementId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualSettlementClaim_pkey" PRIMARY KEY ("settlementId")
);

-- CreateTable
CREATE TABLE "MoneyManualReceiptInspection" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualReceiptInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyManualRefundOperation" (
    "refundId" TEXT NOT NULL,
    "providerIdempotencyKey" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "externalOperationId" TEXT,
    "dispatchUserId" TEXT,
    "confirmationUserId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyManualRefundOperation_pkey" PRIMARY KEY ("refundId")
);

-- CreateTable
CREATE TABLE "MoneyManualRefundEvent" (
    "id" TEXT NOT NULL,
    "refundId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "reference" TEXT,
    "externalOperationId" TEXT,
    "evidenceSource" TEXT NOT NULL,
    "internalNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyManualRefundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualInstructionVersion_configVersion_key" ON "MoneyManualInstructionVersion"("configVersion");

-- CreateIndex
CREATE INDEX "MoneyManualInstructionVersion_planVersionId_method_enabled__idx" ON "MoneyManualInstructionVersion"("planVersionId", "method", "enabled", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReceiptVersion_mediaAssetId_key" ON "MoneyManualReceiptVersion"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReceiptVersion_predecessorId_key" ON "MoneyManualReceiptVersion"("predecessorId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReceiptVersion_paymentIntentId_revision_key" ON "MoneyManualReceiptVersion"("paymentIntentId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReview_currentReceiptId_key" ON "MoneyManualReview"("currentReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReview_pendingDecisionId_key" ON "MoneyManualReview"("pendingDecisionId");

-- CreateIndex
CREATE INDEX "MoneyManualReview_state_nextAttemptAt_paymentIntentId_idx" ON "MoneyManualReview"("state", "nextAttemptAt", "paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualReviewDecision_idempotencyKey_key" ON "MoneyManualReviewDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyManualReviewDecision_paymentIntentId_createdAt_id_idx" ON "MoneyManualReviewDecision"("paymentIntentId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualSettlement_idempotencyKey_key" ON "MoneyManualSettlement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyManualSettlement_adapterId_mode_accountReference_creat_idx" ON "MoneyManualSettlement"("adapterId", "mode", "accountReference", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualSettlement_scoped_reference_key" ON "MoneyManualSettlement"("adapterId", "mode", "accountReference", "referenceCanonical");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualSettlementClaim_paymentIntentId_key" ON "MoneyManualSettlementClaim"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualSettlementClaim_decisionId_key" ON "MoneyManualSettlementClaim"("decisionId");

-- CreateIndex
CREATE INDEX "MoneyManualReceiptInspection_receiptId_reviewerUserId_creat_idx" ON "MoneyManualReceiptInspection"("receiptId", "reviewerUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualRefundOperation_providerIdempotencyKey_key" ON "MoneyManualRefundOperation"("providerIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualRefundOperation_scoped_operation_key" ON "MoneyManualRefundOperation"("adapterId", "mode", "accountReference", "externalOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualRefundOperation_scoped_reference_key" ON "MoneyManualRefundOperation"("adapterId", "mode", "accountReference", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyManualRefundEvent_idempotencyKey_key" ON "MoneyManualRefundEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyManualRefundEvent_refundId_createdAt_id_idx" ON "MoneyManualRefundEvent"("refundId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "MoneyManualInstructionVersion" ADD CONSTRAINT "MoneyManualInstructionVersion_planVersionId_currency_fkey" FOREIGN KEY ("planVersionId", "currency") REFERENCES "SubscriptionPlanVersion"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualInstructionVersion" ADD CONSTRAINT "MoneyManualInstructionVersion_debitAccountId_currency_fkey" FOREIGN KEY ("debitAccountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualInstructionVersion" ADD CONSTRAINT "MoneyManualInstructionVersion_creditAccountId_currency_fkey" FOREIGN KEY ("creditAccountId", "currency") REFERENCES "LedgerAccount"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReceiptVersion" ADD CONSTRAINT "MoneyManualReceiptVersion_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReceiptVersion" ADD CONSTRAINT "MoneyManualReceiptVersion_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReceiptVersion" ADD CONSTRAINT "MoneyManualReceiptVersion_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "MoneyManualReceiptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReview" ADD CONSTRAINT "MoneyManualReview_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReview" ADD CONSTRAINT "MoneyManualReview_instructionVersionId_fkey" FOREIGN KEY ("instructionVersionId") REFERENCES "MoneyManualInstructionVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReview" ADD CONSTRAINT "MoneyManualReview_currentReceiptId_fkey" FOREIGN KEY ("currentReceiptId") REFERENCES "MoneyManualReceiptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReview" ADD CONSTRAINT "MoneyManualReview_pendingDecisionId_fkey" FOREIGN KEY ("pendingDecisionId") REFERENCES "MoneyManualReviewDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "MoneyManualReviewDecision_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "MoneyManualReviewDecision_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MoneyManualReceiptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "MoneyManualReviewDecision_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "MoneyManualReceiptInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "MoneyManualReviewDecision_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "MoneyManualReviewDecision_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "MoneyManualSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualSettlement" ADD CONSTRAINT "MoneyManualSettlement_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualSettlementClaim" ADD CONSTRAINT "MoneyManualSettlementClaim_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "MoneyManualSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualSettlementClaim" ADD CONSTRAINT "MoneyManualSettlementClaim_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualSettlementClaim" ADD CONSTRAINT "MoneyManualSettlementClaim_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "MoneyManualReviewDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReceiptInspection" ADD CONSTRAINT "MoneyManualReceiptInspection_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MoneyManualReceiptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualReceiptInspection" ADD CONSTRAINT "MoneyManualReceiptInspection_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualRefundOperation" ADD CONSTRAINT "MoneyManualRefundOperation_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "MoneyRefund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualRefundOperation" ADD CONSTRAINT "MoneyManualRefundOperation_dispatchUserId_fkey" FOREIGN KEY ("dispatchUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualRefundOperation" ADD CONSTRAINT "MoneyManualRefundOperation_confirmationUserId_fkey" FOREIGN KEY ("confirmationUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualRefundEvent" ADD CONSTRAINT "MoneyManualRefundEvent_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "MoneyManualRefundOperation"("refundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyManualRefundEvent" ADD CONSTRAINT "MoneyManualRefundEvent_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R30 safety constraints. No existing policy, ledger row or permission grant changes.
ALTER TABLE "MoneyManualInstructionVersion" ADD CONSTRAINT "r30_instruction_policy_check"
  CHECK ("method"::text IN ('SHAM_CASH','SYRIATEL_CASH','CASH_OFFICE')
    AND "minorUnitScale" BETWEEN 0 AND 6 AND "maxAmountMinor" > 0
    AND "receiptMaxBytes" BETWEEN 1 AND 10485760 AND "uploadTtlSeconds" > 0
    AND "quoteTtlSeconds" > 0 AND "retentionDays" > 0 AND "validUntil" > "validFrom"
    AND "referencePolicy" = 'EXACT_TRIM'
    AND length("market") BETWEEN 2 AND 64 AND length("policyVersion") BETWEEN 1 AND 100
    AND length("configVersion") BETWEEN 1 AND 100 AND length("adapterId") BETWEEN 1 AND 80
    AND length("accountReference") BETWEEN 1 AND 200
    AND "debitAccountId" <> "creditAccountId"
    AND jsonb_typeof("instructions") = 'object'
    AND "instructions" ?& ARRAY['ar','en']
    AND jsonb_typeof("instructions"->'ar') = 'string'
    AND jsonb_typeof("instructions"->'en') = 'string'
    AND length("instructions"->>'ar') BETWEEN 1 AND 4000
    AND length("instructions"->>'en') BETWEEN 1 AND 4000
    AND (NOT "enabled" OR "approvedAt" IS NOT NULL));
ALTER TABLE "MoneyManualReceiptVersion" ADD CONSTRAINT "r30_receipt_revision_check" CHECK ("revision" > 0);
ALTER TABLE "MoneyManualReview" ADD CONSTRAINT "r30_review_state_check"
  CHECK ("version" >= 0 AND "attemptCount" >= 0
    AND ("lastErrorCode" IS NULL OR "lastErrorCode" ~ '^[A-Z0-9_]{1,80}$')
    AND "state" IN
    ('RECEIPT_REQUIRED','IN_REVIEW','ACTION_REQUIRED','REJECTED','CONFIRMING','APPROVED'));
ALTER TABLE "MoneyManualReviewDecision" ADD CONSTRAINT "r30_decision_check"
  CHECK ("expectedVersion" >= 0 AND "action" IN
    ('PENDING_APPROVAL','APPROVED','REJECTED','REPLACEMENT_REQUESTED')
    AND length("providerMessage") BETWEEN 1 AND 2000
    AND ("internalNote" IS NULL OR length("internalNote") <= 4000)
    AND "requestDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "MoneyManualSettlement" ADD CONSTRAINT "r30_settlement_check"
  CHECK ("amountMinor" > 0 AND length("referenceCanonical") BETWEEN 1 AND 200
    AND "referenceCanonical" = btrim("referenceCanonical")
    AND length("policyVersion") BETWEEN 1 AND 100 AND "requestDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "MoneyManualReceiptInspection" ADD CONSTRAINT "r30_inspection_hash_check"
  CHECK ("sha256" ~ '^[a-f0-9]{64}$');
ALTER TABLE "MoneyManualRefundOperation" ADD CONSTRAINT "r30_refund_operation_check"
  CHECK ("state" IN ('PENDING','UNKNOWN','SUCCEEDED','FAILED') AND "amountMinor" > 0
    AND ("confirmationUserId" IS NULL OR "confirmationUserId" <> "dispatchUserId")
    AND ("state" NOT IN ('SUCCEEDED','FAILED') OR
      ("externalOperationId" IS NOT NULL AND "reference" IS NOT NULL
       AND "dispatchUserId" IS NOT NULL AND "confirmationUserId" IS NOT NULL)));
ALTER TABLE "MoneyManualRefundEvent" ADD CONSTRAINT "r30_refund_event_check"
  CHECK ("type" IN ('DISPATCH','CONFIRM_SUCCEEDED','CONFIRM_FAILED')
    AND "requestDigest" ~ '^[a-f0-9]{64}$');

CREATE FUNCTION r30_instruction_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'enabled') IS DISTINCT FROM (to_jsonb(OLD) - 'enabled') THEN
    RAISE EXCEPTION 'Manual instruction versions are immutable; publish a new version'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_instruction_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualInstructionVersion"
  FOR EACH ROW EXECUTE FUNCTION r30_instruction_immutable();
CREATE TRIGGER "r30_decision_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();
CREATE TRIGGER "r30_settlement_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualSettlement"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();
CREATE TRIGGER "r30_claim_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualSettlementClaim"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();
CREATE TRIGGER "r30_inspection_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualReceiptInspection"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();
CREATE TRIGGER "r30_refund_event_immutable" BEFORE UPDATE OR DELETE ON "MoneyManualRefundEvent"
  FOR EACH ROW EXECUTE FUNCTION r24_money_immutable();

CREATE FUNCTION r30_financial_media_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purpose"::text = 'FINANCIAL_RECEIPT' THEN
      RAISE EXCEPTION 'Financial evidence history cannot be deleted' USING ERRCODE='restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."purpose"::text = 'FINANCIAL_RECEIPT' OR NEW."purpose"::text = 'FINANCIAL_RECEIPT') THEN
    IF NEW."purpose" IS DISTINCT FROM OLD."purpose" OR NEW."ownerUserId" IS DISTINCT FROM OLD."ownerUserId" THEN
      RAISE EXCEPTION 'Financial evidence purpose and owner are immutable' USING ERRCODE='restrict_violation';
    END IF;
    IF OLD."uploadCompletedAt" IS NOT NULL AND
      ROW(NEW."storageKey",NEW."declaredMimeType",NEW."detectedMimeType",NEW."sizeBytes",NEW."sha256",NEW."uploadCompletedAt")
      IS DISTINCT FROM ROW(OLD."storageKey",OLD."declaredMimeType",OLD."detectedMimeType",OLD."sizeBytes",OLD."sha256",OLD."uploadCompletedAt") THEN
      RAISE EXCEPTION 'Finalized financial evidence bytes are immutable' USING ERRCODE='restrict_violation';
    END IF;
  END IF;
  IF NEW."purpose"::text = 'FINANCIAL_RECEIPT' AND
    (NEW."visibility"::text <> 'RESTRICTED' OR NEW."ownerUserId" IS NULL OR
      NEW."verificationCaseId" IS NOT NULL OR NEW."pendingDocumentKind" IS NOT NULL OR
      NEW."pendingServiceCategoryId" IS NOT NULL OR NEW."serviceRequestId" IS NOT NULL OR
      NEW."requestClaimedAt" IS NOT NULL OR NEW."requestAttachmentPosition" IS NOT NULL OR
      NEW."storageKey" NOT LIKE 'financial-receipts/%') THEN
    RAISE EXCEPTION 'Financial evidence is restricted and separate from identity/public media' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_financial_media_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION r30_financial_media_guard();

CREATE FUNCTION r30_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior "MoneyManualReceiptVersion"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Receipt revisions cannot be deleted' USING ERRCODE='restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW)-'submittedAt') IS DISTINCT FROM (to_jsonb(OLD)-'submittedAt') OR
      (OLD."submittedAt" IS NOT NULL AND NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt") THEN
      RAISE EXCEPTION 'Receipt revision identity and submission are immutable' USING ERRCODE='restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('r30.receipt.' || NEW."paymentIntentId",0));
  IF NOT EXISTS (
    SELECT 1 FROM "MediaAsset" a JOIN "MoneyPaymentIntent" i ON i.id=NEW."paymentIntentId"
    JOIN "ProviderProfile" p ON p.id=i."providerProfileId"
    WHERE a.id=NEW."mediaAssetId" AND a."purpose"::text='FINANCIAL_RECEIPT'
      AND a."visibility"::text='RESTRICTED' AND a."ownerUserId"=p."userId"
      AND a."uploadCompletedAt" IS NULL AND i.method::text <> 'STRIPE') THEN
    RAISE EXCEPTION 'A receipt must be reserved for its actual obligation owner before upload' USING ERRCODE='check_violation';
  END IF;
  SELECT * INTO prior FROM "MoneyManualReceiptVersion" WHERE "paymentIntentId"=NEW."paymentIntentId"
    ORDER BY revision DESC LIMIT 1;
  IF NEW.revision <> coalesce(prior.revision,0)+1 OR NEW."predecessorId" IS DISTINCT FROM prior.id THEN
    RAISE EXCEPTION 'Receipt replacement must retain its immediate predecessor' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_receipt_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyManualReceiptVersion"
  FOR EACH ROW EXECUTE FUNCTION r30_receipt_guard();

CREATE FUNCTION r30_financial_media_obligation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose::text='FINANCIAL_RECEIPT' AND NOT EXISTS
    (SELECT 1 FROM "MoneyManualReceiptVersion" WHERE "mediaAssetId"=NEW.id) THEN
    RAISE EXCEPTION 'Financial evidence requires an immutable obligation association' USING ERRCODE='check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "r30_financial_media_obligation" AFTER INSERT OR UPDATE ON "MediaAsset"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r30_financial_media_obligation();

CREATE FUNCTION r30_refuse_identity_receipt_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaAsset" WHERE id=NEW."mediaAssetId" AND purpose::text='FINANCIAL_RECEIPT') THEN
    RAISE EXCEPTION 'Financial receipts cannot become identity or portfolio evidence' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_no_identity_receipt" BEFORE INSERT OR UPDATE ON "VerificationDocument"
  FOR EACH ROW EXECUTE FUNCTION r30_refuse_identity_receipt_link();
CREATE TRIGGER "r30_no_portfolio_receipt" BEFORE INSERT OR UPDATE ON "ProviderPortfolioItem"
  FOR EACH ROW EXECUTE FUNCTION r30_refuse_identity_receipt_link();
CREATE TRIGGER "r30_no_identity_receipt_retention" BEFORE INSERT OR UPDATE ON "EvidenceRetentionJob"
  FOR EACH ROW EXECUTE FUNCTION r30_refuse_identity_receipt_link();

CREATE FUNCTION r30_review_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Manual review history cannot be deleted' USING ERRCODE='restrict_violation';
  END IF;
  IF TG_OP='UPDATE' AND (NEW."paymentIntentId" <> OLD."paymentIntentId" OR
    NEW."instructionVersionId" <> OLD."instructionVersionId" OR NEW.version < OLD.version OR
    (OLD.state='APPROVED' AND (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt'))) THEN
    RAISE EXCEPTION 'Manual review identity and final state are immutable' USING ERRCODE='restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "MoneyPaymentIntent" i JOIN "MoneyIntentBinding" b ON b."paymentIntentId"=i.id
    JOIN "MoneyManualInstructionVersion" v ON v.id=NEW."instructionVersionId"
    WHERE i.id=NEW."paymentIntentId" AND v."planVersionId"=i."planVersionId" AND v.method=i.method
      AND v."configVersion"=b."configVersion" AND v.currency=i.currency AND v.mode=b.mode
      AND v."adapterId"=b."adapterId" AND v."accountReference"=b."accountReference") OR
    (NEW."currentReceiptId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "MoneyManualReceiptVersion" WHERE id=NEW."currentReceiptId" AND "paymentIntentId"=NEW."paymentIntentId")) OR
    (NEW."pendingDecisionId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "MoneyManualReviewDecision" WHERE id=NEW."pendingDecisionId" AND "paymentIntentId"=NEW."paymentIntentId")) THEN
    RAISE EXCEPTION 'Manual review differs from its immutable obligation' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_review_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyManualReview"
  FOR EACH ROW EXECUTE FUNCTION r30_review_guard();

CREATE FUNCTION r30_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "MoneyManualReceiptVersion" r
    JOIN "MediaAsset" a ON a.id=r."mediaAssetId"
    JOIN "MoneyManualReceiptInspection" x ON x.id=NEW."inspectionId"
    WHERE r.id=NEW."receiptId" AND r."paymentIntentId"=NEW."paymentIntentId"
      AND x."receiptId"=r.id AND x."reviewerUserId"=NEW."reviewerUserId" AND x.sha256=a.sha256
      AND a."ownerUserId" <> NEW."reviewerUserId") THEN
    RAISE EXCEPTION 'Manual decision requires this actor inspected the bound receipt' USING ERRCODE='check_violation';
  END IF;
  IF NEW.action IN ('PENDING_APPROVAL','APPROVED') AND NOT EXISTS (
    SELECT 1 FROM "MoneyManualSettlement" s JOIN "MoneyPaymentIntent" i ON i.id=NEW."paymentIntentId"
    JOIN "MoneyIntentBinding" b ON b."paymentIntentId"=i.id
    JOIN "ProviderProfile" p ON p.id=i."providerProfileId"
    WHERE s.id=NEW."settlementId" AND s."amountMinor"=i."totalMinor" AND s.currency=i.currency
      AND s."adapterId"=b."adapterId" AND s.mode=b.mode AND s."accountReference"=b."accountReference"
      AND s."recordedByUserId" <> NEW."reviewerUserId" AND s."recordedByUserId" <> p."userId") THEN
    RAISE EXCEPTION 'Manual approval requires independently recorded matching settlement' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_decision_guard" BEFORE INSERT ON "MoneyManualReviewDecision"
  FOR EACH ROW EXECUTE FUNCTION r30_decision_guard();

CREATE FUNCTION r30_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "MoneyManualReviewDecision" d WHERE d.id=NEW."decisionId"
    AND d.action='APPROVED' AND d."paymentIntentId"=NEW."paymentIntentId"
    AND d."settlementId"=NEW."settlementId") THEN
    RAISE EXCEPTION 'Settlement claims require the final bound approval' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_claim_guard" BEFORE INSERT ON "MoneyManualSettlementClaim"
  FOR EACH ROW EXECUTE FUNCTION r30_claim_guard();

CREATE FUNCTION r30_approved_review_atomicity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='APPROVED' AND NOT EXISTS (
    SELECT 1 FROM "MoneyManualSettlementClaim" c
    JOIN "MoneyPaymentConfirmation" p ON p."paymentIntentId"=c."paymentIntentId"
    JOIN "MoneyManualReceiptVersion" r ON r.id=NEW."currentReceiptId"
    WHERE c."paymentIntentId"=NEW."paymentIntentId" AND p."receiptMediaAssetId"=r."mediaAssetId") THEN
    RAISE EXCEPTION 'Final review and financial confirmation must commit together' USING ERRCODE='check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "r30_approved_review_atomicity" AFTER INSERT OR UPDATE ON "MoneyManualReview"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r30_approved_review_atomicity();

CREATE FUNCTION r30_refund_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Manual refund operations cannot be deleted' USING ERRCODE='restrict_violation';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state <> 'PENDING' OR NOT EXISTS (
      SELECT 1 FROM "MoneyRefund" r JOIN "MoneyPaymentConfirmation" c ON c.id=r."paymentConfirmationId"
      JOIN "MoneyIntentBinding" b ON b."paymentIntentId"=c."paymentIntentId"
      JOIN "MoneyDispatch" d ON d."refundId"=r.id
      WHERE r.id=NEW."refundId" AND r."amountMinor"=NEW."amountMinor" AND r.currency=NEW.currency
        AND d."providerIdempotencyKey"=NEW."providerIdempotencyKey"
        AND b."adapterId"=NEW."adapterId" AND b.mode=NEW.mode AND b."accountReference"=NEW."accountReference") THEN
      RAISE EXCEPTION 'Manual refund transport requires its durable bound reservation' USING ERRCODE='check_violation';
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['state','externalOperationId','dispatchUserId','confirmationUserId','reference','updatedAt'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','externalOperationId','dispatchUserId','confirmationUserId','reference','updatedAt']) OR
      (OLD.state IN ('SUCCEEDED','FAILED') AND (to_jsonb(NEW)-'updatedAt') IS DISTINCT FROM (to_jsonb(OLD)-'updatedAt')) OR
      (OLD."externalOperationId" IS NOT NULL AND NEW."externalOperationId" IS DISTINCT FROM OLD."externalOperationId") OR
      (OLD."dispatchUserId" IS NOT NULL AND NEW."dispatchUserId" IS DISTINCT FROM OLD."dispatchUserId") OR
      (OLD.state='UNKNOWN' AND NEW.state='PENDING') THEN
      RAISE EXCEPTION 'Manual refund identity and terminal observations are immutable' USING ERRCODE='restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "r30_refund_operation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "MoneyManualRefundOperation"
  FOR EACH ROW EXECUTE FUNCTION r30_refund_operation_guard();

-- Definitions only. Existing roles and users receive no grant.
INSERT INTO "Permission" (id,key,description,"createdAt","updatedAt") VALUES
 ('r30_money_receipt_view','money:receipt:view','Read audited private subscription receipts',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
 ('r30_money_receipt_settlement','money:receipt:settlement','Record independently permitted subscription settlement evidence',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
 ON CONFLICT (key) DO NOTHING;


