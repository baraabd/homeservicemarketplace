-- CreateEnum
CREATE TYPE "MoneyRefundEntitlementEffect" AS ENUM ('SUSPEND_SUBSCRIPTION', 'CANCEL_SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "MoneyReconciliationRunState" AS ENUM ('RUNNING', 'COMPLETED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "MoneyReconciliationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MoneyReconciliationKind" ADD VALUE 'TIMING_DIFFERENCE';
ALTER TYPE "MoneyReconciliationKind" ADD VALUE 'MISSING_EXTERNAL_EFFECT';
ALTER TYPE "MoneyReconciliationKind" ADD VALUE 'UNMATCHED_EXTERNAL_REFERENCE';
ALTER TYPE "MoneyReconciliationKind" ADD VALUE 'MISSING_ACTIVATION';
ALTER TYPE "MoneyReconciliationKind" ADD VALUE 'AMBIGUOUS_REFUND_OUTCOME';

-- CreateTable
CREATE TABLE "MoneyApprovedRefundPolicy" (
    "version" VARCHAR(100) NOT NULL,
    "planVersionId" VARCHAR(64) NOT NULL,
    "method" "MoneyPaymentMethod" NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "approvalReference" VARCHAR(200) NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "rules" JSONB NOT NULL,
    "entitlementEffect" "MoneyRefundEntitlementEffect" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyApprovedRefundPolicy_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationWindow" (
    "id" TEXT NOT NULL,
    "adapterId" VARCHAR(100) NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" VARCHAR(200) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "cursor" VARCHAR(2048),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" VARCHAR(100),
    "leaseUntil" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyReconciliationWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationRun" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "state" "MoneyReconciliationRunState" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceKind" VARCHAR(40) NOT NULL,
    "sourceReference" VARCHAR(200) NOT NULL,
    "evidenceDigest" CHAR(64),
    "sourceComplete" BOOLEAN NOT NULL DEFAULT false,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "failureCode" VARCHAR(80),
    "fence" INTEGER NOT NULL,

    CONSTRAINT "MoneyReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationObservation" (
    "id" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "adapterId" VARCHAR(100) NOT NULL,
    "mode" "MoneyAdapterMode" NOT NULL,
    "accountReference" VARCHAR(200) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "sourceEventId" VARCHAR(200) NOT NULL,
    "payloadDigest" CHAR(64) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyReconciliationObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationCase" (
    "exceptionId" TEXT NOT NULL,
    "windowId" TEXT NOT NULL,
    "severity" "MoneyReconciliationSeverity" NOT NULL,
    "originalEvidenceDigest" CHAR(64) NOT NULL,
    "originalResolvedAt" TIMESTAMP(3),
    "originalResolutionCode" VARCHAR(64),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MoneyReconciliationCase_pkey" PRIMARY KEY ("exceptionId")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationDecision" (
    "id" TEXT NOT NULL,
    "exceptionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "makerUserId" VARCHAR(64) NOT NULL,
    "checkerUserId" VARCHAR(64),
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "reasonCode" VARCHAR(64) NOT NULL,
    "correctionTransactionId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyReconciliationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MoneyApprovedRefundPolicy_planVersionId_method_mode_currenc_idx" ON "MoneyApprovedRefundPolicy"("planVersionId", "method", "mode", "currency", "validFrom", "validUntil");

-- CreateIndex
CREATE INDEX "MoneyReconciliationWindow_leaseUntil_updatedAt_id_idx" ON "MoneyReconciliationWindow"("leaseUntil", "updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "money_reconciliation_window_scope_key" ON "MoneyReconciliationWindow"("adapterId", "mode", "accountReference", "currency", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "MoneyReconciliationRun_windowId_startedAt_id_idx" ON "MoneyReconciliationRun"("windowId", "startedAt", "id");

-- CreateIndex
CREATE INDEX "MoneyReconciliationRun_state_completedAt_id_idx" ON "MoneyReconciliationRun"("state", "completedAt", "id");

-- CreateIndex
CREATE INDEX "MoneyReconciliationObservation_windowId_recordedAt_id_idx" ON "MoneyReconciliationObservation"("windowId", "recordedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "money_reconciliation_observation_source_key" ON "MoneyReconciliationObservation"("adapterId", "mode", "accountReference", "currency", "sourceEventId");

-- CreateIndex
CREATE INDEX "MoneyReconciliationCase_severity_lastCheckedAt_exceptionId_idx" ON "MoneyReconciliationCase"("severity", "lastCheckedAt", "exceptionId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyReconciliationDecision_idempotencyKey_key" ON "MoneyReconciliationDecision"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyReconciliationDecision_exceptionId_revision_key" ON "MoneyReconciliationDecision"("exceptionId", "revision");

-- AddForeignKey
ALTER TABLE "MoneyReconciliationRun" ADD CONSTRAINT "MoneyReconciliationRun_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MoneyReconciliationWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyReconciliationObservation" ADD CONSTRAINT "MoneyReconciliationObservation_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MoneyReconciliationWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyReconciliationCase" ADD CONSTRAINT "MoneyReconciliationCase_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "MoneyReconciliationException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyReconciliationCase" ADD CONSTRAINT "MoneyReconciliationCase_windowId_fkey" FOREIGN KEY ("windowId") REFERENCES "MoneyReconciliationWindow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyReconciliationDecision" ADD CONSTRAINT "MoneyReconciliationDecision_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "MoneyReconciliationCase"("exceptionId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No rows, grants, money or acceptance state are inserted by this migration.
ALTER TABLE "MoneyApprovedRefundPolicy" ADD CONSTRAINT "g3_refund_policy_scope" CHECK (
  "mode" = 'SANDBOX' AND "currency" ~ '^[A-Z]{3}$' AND
  "approvedAt" <= "validFrom" AND "validFrom" < "validUntil" AND
  length(btrim("approvalReference")) > 0 AND jsonb_typeof("rules") = 'object'
);
ALTER TABLE "MoneyReconciliationWindow" ADD CONSTRAINT "g3_window_bounds" CHECK (
  "startsAt" < "endsAt" AND "currency" ~ '^[A-Z]{3}$' AND "revision" >= 0 AND "fence" >= 0 AND
  (("leaseOwner" IS NULL AND "leaseUntil" IS NULL) OR ("leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL))
);
ALTER TABLE "MoneyReconciliationRun" ADD CONSTRAINT "g3_run_evidence" CHECK (
  "matchedCount" >= 0 AND "unmatchedCount" >= 0 AND "fence" >= 0 AND
  "sourceKind" IN ('PROVIDER_STATEMENT', 'AUTHORIZED_MANUAL_EVIDENCE') AND
  ("evidenceDigest" IS NULL OR "evidenceDigest" ~ '^[0-9a-f]{64}$') AND
  ("state" <> 'COMPLETED' OR ("sourceComplete" AND "evidenceDigest" IS NOT NULL AND "completedAt" IS NOT NULL)) AND
  ("completedAt" IS NULL OR "completedAt" >= "startedAt")
);
ALTER TABLE "MoneyReconciliationObservation" ADD CONSTRAINT "g3_observation_hash" CHECK (
  "payloadDigest" ~ '^[0-9a-f]{64}$' AND "currency" ~ '^[A-Z]{3}$' AND length("sourceEventId") > 0
);
ALTER TABLE "MoneyReconciliationCase" ADD CONSTRAINT "g3_case_evidence" CHECK (
  "originalEvidenceDigest" ~ '^[0-9a-f]{64}$' AND "revision" >= 0
);
ALTER TABLE "MoneyReconciliationDecision" ADD CONSTRAINT "g3_decision_authority" CHECK (
  "revision" > 0 AND "payloadHash" ~ '^[0-9a-f]{64}$' AND "reasonCode" ~ '^[A-Z][A-Z0-9_]{2,63}$' AND
  "action" IN ('ACKNOWLEDGE', 'REQUEST_RECHECK', 'RESOLVE', 'REOPEN') AND
  ("action" <> 'RESOLVE' OR ("checkerUserId" IS NOT NULL AND "checkerUserId" <> "makerUserId"))
);
ALTER TABLE "MoneyReconciliationDecision" ADD CONSTRAINT "g3_decision_maker_fk" FOREIGN KEY ("makerUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "MoneyReconciliationDecision" ADD CONSTRAINT "g3_decision_checker_fk" FOREIGN KEY ("checkerUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "MoneyReconciliationDecision" ADD CONSTRAINT "g3_decision_correction_fk" FOREIGN KEY ("correctionTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT;

CREATE FUNCTION g3_immutable_financial_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approved policy and reconciliation evidence are append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
CREATE TRIGGER g3_refund_policy_immutable BEFORE UPDATE OR DELETE ON "MoneyApprovedRefundPolicy" FOR EACH ROW EXECUTE FUNCTION g3_immutable_financial_evidence();
CREATE TRIGGER g3_observation_immutable BEFORE UPDATE OR DELETE ON "MoneyReconciliationObservation" FOR EACH ROW EXECUTE FUNCTION g3_immutable_financial_evidence();
CREATE TRIGGER g3_decision_immutable BEFORE UPDATE OR DELETE ON "MoneyReconciliationDecision" FOR EACH ROW EXECUTE FUNCTION g3_immutable_financial_evidence();

CREATE FUNCTION g3_preserve_reconciliation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (NEW."exceptionId", NEW."windowId", NEW."originalEvidenceDigest", NEW."originalResolvedAt", NEW."originalResolutionCode") IS DISTINCT FROM
    (OLD."exceptionId", OLD."windowId", OLD."originalEvidenceDigest", OLD."originalResolvedAt", OLD."originalResolutionCode") THEN
    RAISE EXCEPTION 'Reopening preserves original exception evidence' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."revision" < OLD."revision" OR NEW."lastCheckedAt" < OLD."lastCheckedAt" THEN
    RAISE EXCEPTION 'Reconciliation provenance cannot move backwards' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER g3_case_source_immutable BEFORE UPDATE OR DELETE ON "MoneyReconciliationCase" FOR EACH ROW EXECUTE FUNCTION g3_preserve_reconciliation_source();

CREATE FUNCTION g3_observation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "MoneyReconciliationWindow" w WHERE w."id" = NEW."windowId" AND
      (w."adapterId", w."mode", w."accountReference", w."currency") =
      (NEW."adapterId", NEW."mode", NEW."accountReference", NEW."currency")) THEN
    RAISE EXCEPTION 'Observation must match its source window scope' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER g3_observation_scope_guard BEFORE INSERT ON "MoneyReconciliationObservation" FOR EACH ROW EXECUTE FUNCTION g3_observation_scope();

CREATE FUNCTION g3_preserve_window_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."adapterId", NEW."mode", NEW."accountReference", NEW."currency", NEW."startsAt", NEW."endsAt", NEW."createdAt") IS DISTINCT FROM
     (OLD."id", OLD."adapterId", OLD."mode", OLD."accountReference", OLD."currency", OLD."startsAt", OLD."endsAt", OLD."createdAt") OR
     NEW."revision" < OLD."revision" OR NEW."fence" < OLD."fence" THEN
    RAISE EXCEPTION 'Reconciliation windows retain their scope and monotone checkpoint' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER g3_window_identity_guard BEFORE UPDATE ON "MoneyReconciliationWindow" FOR EACH ROW EXECUTE FUNCTION g3_preserve_window_identity();

-- Preserve the pre-existing resolution when attaching operational provenance to
-- a legacy exception. A future reopen cannot erase that original fact.
CREATE FUNCTION g3_snapshot_original_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT "resolvedAt", "resolutionCode" INTO NEW."originalResolvedAt", NEW."originalResolutionCode"
    FROM "MoneyReconciliationException" WHERE "id" = NEW."exceptionId";
  RETURN NEW;
END;
$$;
CREATE TRIGGER g3_case_resolution_snapshot BEFORE INSERT ON "MoneyReconciliationCase" FOR EACH ROW EXECUTE FUNCTION g3_snapshot_original_resolution();

-- Legacy exceptions retain their resolved-once behavior. Cases with new run
-- provenance require a matching append-only decision for every state change.
CREATE OR REPLACE FUNCTION money_reconciliation_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  case_revision INTEGER;
  decision_action TEXT;
  decision_reason TEXT;
  decision_time TIMESTAMP(3);
BEGIN
  IF (NEW."id", NEW."kind", NEW."subjectType", NEW."subjectId", NEW."detectedAt") IS DISTINCT FROM
     (OLD."id", OLD."kind", OLD."subjectType", OLD."subjectId", OLD."detectedAt") THEN
    RAISE EXCEPTION 'A reconciliation exception keeps its original identity' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "revision" INTO case_revision FROM "MoneyReconciliationCase" WHERE "exceptionId" = OLD."id";
  IF case_revision IS NULL THEN
    IF OLD."resolvedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Legacy exception requires operational provenance before reopening' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."resolvedAt", NEW."resolutionCode") IS NOT DISTINCT FROM (OLD."resolvedAt", OLD."resolutionCode") THEN RETURN NEW; END IF;
  SELECT "action", "reasonCode", "createdAt" INTO decision_action, decision_reason, decision_time
    FROM "MoneyReconciliationDecision" WHERE "exceptionId" = OLD."id" AND "revision" = case_revision;
  IF OLD."resolvedAt" IS NULL AND NEW."resolvedAt" IS NOT NULL AND
     decision_action = 'RESOLVE' AND NEW."resolutionCode" = decision_reason AND NEW."resolvedAt" >= decision_time THEN
    RETURN NEW;
  END IF;
  IF OLD."resolvedAt" IS NOT NULL AND NEW."resolvedAt" IS NULL AND NEW."resolutionCode" IS NULL AND decision_action = 'REOPEN' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Exception transition requires a matching immutable decision' USING ERRCODE = 'restrict_violation';
END;
$$;
