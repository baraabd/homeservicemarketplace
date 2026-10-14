-- R19 — subscription money foundation (dark, additive, expand-only).
--
-- Provider subscriptions paid TO HSM. New enums and tables only; existing
-- tables gain no column (back-relations are Prisma-only). No row is inserted:
-- no plan, price, currency, coupon, account purpose or permission.
-- Rollback: forward repair dropping these tables, functions and enums; no
-- other data depends on them. Never edit this file once applied.

-- CreateEnum
CREATE TYPE "MoneyBillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "MoneyPaymentMethod" AS ENUM ('STRIPE', 'SHAM_CASH', 'SYRIATEL_CASH', 'CASH_OFFICE');

-- CreateEnum
CREATE TYPE "MoneyPaymentIntentStatus" AS ENUM ('CREATED', 'AWAITING_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MoneyPaymentAttemptStatus" AS ENUM ('STARTED', 'FAILED', 'SUCCEEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MoneyConfirmationSource" AS ENUM ('PROVIDER_WEBHOOK', 'MANUAL_REVIEW');

-- CreateEnum
CREATE TYPE "MoneySubscriptionStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MoneyRefundStatus" AS ENUM ('RESERVED', 'DISPATCHED', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MoneyCouponKind" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "MoneyReconciliationKind" AS ENUM ('CONFIRMATION_WITHOUT_POSTING', 'POSTING_WITHOUT_CONFIRMATION', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE_EXTERNAL_CONFIRMATION', 'REFUND_WITHOUT_COMPENSATION', 'PERIOD_WITHOUT_CONFIRMATION');

-- CreateTable
CREATE TABLE "SubscriptionPlanVersion" (
    "id" TEXT NOT NULL,
    "planKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "billingInterval" "MoneyBillingInterval" NOT NULL,
    "priceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "entitlements" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyPaymentIntent" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "method" "MoneyPaymentMethod" NOT NULL,
    "status" "MoneyPaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "currency" CHAR(3) NOT NULL,
    "subtotalMinor" BIGINT NOT NULL,
    "discountMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "couponId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyPaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyPaymentAttempt" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "status" "MoneyPaymentAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "externalAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyPaymentConfirmation" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "source" "MoneyConfirmationSource" NOT NULL,
    "externalConfirmationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "receiptMediaAssetId" TEXT,
    "reviewerUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyPaymentConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSubscription" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "status" "MoneySubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPeriod" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentConfirmationId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyRefund" (
    "id" TEXT NOT NULL,
    "paymentConfirmationId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "MoneyRefundStatus" NOT NULL DEFAULT 'RESERVED',
    "reasonCode" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" CHAR(64) NOT NULL,
    "externalRefundId" TEXT,
    "compensatingLedgerTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyCoupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "MoneyCouponKind" NOT NULL,
    "value" BIGINT NOT NULL,
    "currency" CHAR(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "maxRedemptions" INTEGER,
    "maxRedemptionsPerProvider" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyCouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyCouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyEntitlementUsage" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "entitlementKey" TEXT NOT NULL,
    "usageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyEntitlementUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyReconciliationException" (
    "id" TEXT NOT NULL,
    "kind" "MoneyReconciliationKind" NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolutionCode" TEXT,

    CONSTRAINT "MoneyReconciliationException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanVersion_planKey_version_key" ON "SubscriptionPlanVersion"("planKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlanVersion_id_currency_key" ON "SubscriptionPlanVersion"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentIntent_idempotencyKey_key" ON "MoneyPaymentIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MoneyPaymentIntent_providerProfileId_createdAt_idx" ON "MoneyPaymentIntent"("providerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyPaymentIntent_status_expiresAt_idx" ON "MoneyPaymentIntent"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentIntent_id_currency_key" ON "MoneyPaymentIntent"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentAttempt_externalAttemptId_key" ON "MoneyPaymentAttempt"("externalAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentAttempt_paymentIntentId_attemptNo_key" ON "MoneyPaymentAttempt"("paymentIntentId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_paymentIntentId_key" ON "MoneyPaymentConfirmation"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_idempotencyKey_key" ON "MoneyPaymentConfirmation"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_ledgerTransactionId_key" ON "MoneyPaymentConfirmation"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_source_externalConfirmationId_key" ON "MoneyPaymentConfirmation"("source", "externalConfirmationId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_id_currency_key" ON "MoneyPaymentConfirmation"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_paymentIntentId_currency_key" ON "MoneyPaymentConfirmation"("paymentIntentId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyPaymentConfirmation_ledgerTransactionId_currency_key" ON "MoneyPaymentConfirmation"("ledgerTransactionId", "currency");

-- CreateIndex
CREATE INDEX "ProviderSubscription_providerProfileId_status_idx" ON "ProviderSubscription"("providerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPeriod_paymentConfirmationId_key" ON "SubscriptionPeriod"("paymentConfirmationId");

-- CreateIndex
CREATE INDEX "SubscriptionPeriod_subscriptionId_startsAt_idx" ON "SubscriptionPeriod"("subscriptionId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRefund_idempotencyKey_key" ON "MoneyRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRefund_externalRefundId_key" ON "MoneyRefund"("externalRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyRefund_compensatingLedgerTransactionId_key" ON "MoneyRefund"("compensatingLedgerTransactionId");

-- CreateIndex
CREATE INDEX "MoneyRefund_paymentConfirmationId_status_idx" ON "MoneyRefund"("paymentConfirmationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyCoupon_code_key" ON "MoneyCoupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyCouponRedemption_paymentIntentId_key" ON "MoneyCouponRedemption"("paymentIntentId");

-- CreateIndex
CREATE INDEX "MoneyCouponRedemption_couponId_providerProfileId_idx" ON "MoneyCouponRedemption"("couponId", "providerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyEntitlementUsage_subscriptionId_entitlementKey_usageKe_key" ON "MoneyEntitlementUsage"("subscriptionId", "entitlementKey", "usageKey");

-- CreateIndex
CREATE INDEX "MoneyReconciliationException_resolvedAt_detectedAt_idx" ON "MoneyReconciliationException"("resolvedAt", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyReconciliationException_kind_subjectType_subjectId_key" ON "MoneyReconciliationException"("kind", "subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "MoneyPaymentIntent" ADD CONSTRAINT "MoneyPaymentIntent_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentIntent" ADD CONSTRAINT "MoneyPaymentIntent_planVersionId_currency_fkey" FOREIGN KEY ("planVersionId", "currency") REFERENCES "SubscriptionPlanVersion"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentIntent" ADD CONSTRAINT "MoneyPaymentIntent_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "MoneyCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentAttempt" ADD CONSTRAINT "MoneyPaymentAttempt_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentConfirmation" ADD CONSTRAINT "MoneyPaymentConfirmation_paymentIntentId_currency_fkey" FOREIGN KEY ("paymentIntentId", "currency") REFERENCES "MoneyPaymentIntent"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentConfirmation" ADD CONSTRAINT "MoneyPaymentConfirmation_ledgerTransactionId_currency_fkey" FOREIGN KEY ("ledgerTransactionId", "currency") REFERENCES "LedgerTransaction"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentConfirmation" ADD CONSTRAINT "MoneyPaymentConfirmation_receiptMediaAssetId_fkey" FOREIGN KEY ("receiptMediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyPaymentConfirmation" ADD CONSTRAINT "MoneyPaymentConfirmation_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSubscription" ADD CONSTRAINT "ProviderSubscription_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSubscription" ADD CONSTRAINT "ProviderSubscription_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "SubscriptionPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ProviderSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPeriod" ADD CONSTRAINT "SubscriptionPeriod_paymentConfirmationId_fkey" FOREIGN KEY ("paymentConfirmationId") REFERENCES "MoneyPaymentConfirmation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefund" ADD CONSTRAINT "MoneyRefund_paymentConfirmationId_currency_fkey" FOREIGN KEY ("paymentConfirmationId", "currency") REFERENCES "MoneyPaymentConfirmation"("id", "currency") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyRefund" ADD CONSTRAINT "MoneyRefund_compensatingLedgerTransactionId_fkey" FOREIGN KEY ("compensatingLedgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyCouponRedemption" ADD CONSTRAINT "MoneyCouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "MoneyCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyCouponRedemption" ADD CONSTRAINT "MoneyCouponRedemption_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "MoneyPaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyCouponRedemption" ADD CONSTRAINT "MoneyCouponRedemption_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyEntitlementUsage" ADD CONSTRAINT "MoneyEntitlementUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ProviderSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────────────────────────────────────────────────────────────────────
-- R19 — rules PostgreSQL enforces even when the service is bypassed.
-- Additive only: no existing table, column or applied migration is changed.
-- No row is inserted: no plan, price, currency, coupon or permission.
-- ───────────────────────────────────────────────────────────────────────────

-- Shapes and arithmetic -------------------------------------------------------

ALTER TABLE "SubscriptionPlanVersion"
  ADD CONSTRAINT "SubscriptionPlanVersion_plan_key_format" CHECK ("planKey" ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  ADD CONSTRAINT "SubscriptionPlanVersion_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "SubscriptionPlanVersion_price_non_negative" CHECK ("priceMinor" >= 0),
  ADD CONSTRAINT "SubscriptionPlanVersion_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "SubscriptionPlanVersion_entitlements_array" CHECK (jsonb_typeof("entitlements") = 'array'),
  ADD CONSTRAINT "SubscriptionPlanVersion_retired_after_published" CHECK ("retiredAt" IS NULL OR "retiredAt" >= "publishedAt");

ALTER TABLE "MoneyPaymentIntent"
  ADD CONSTRAINT "MoneyPaymentIntent_amounts_non_negative" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" >= 0),
  ADD CONSTRAINT "MoneyPaymentIntent_total_is_subtotal_minus_discount" CHECK ("totalMinor" = "subtotalMinor" - "discountMinor"),
  ADD CONSTRAINT "MoneyPaymentIntent_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyPaymentIntent_idempotency_key_format" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "MoneyPaymentIntent_request_digest_format" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$');

ALTER TABLE "MoneyPaymentAttempt"
  ADD CONSTRAINT "MoneyPaymentAttempt_attempt_no_positive" CHECK ("attemptNo" >= 1);

-- At most one successful attempt per intent.
CREATE UNIQUE INDEX "MoneyPaymentAttempt_one_success_per_intent"
  ON "MoneyPaymentAttempt" ("paymentIntentId") WHERE "status" = 'SUCCEEDED';

ALTER TABLE "MoneyPaymentConfirmation"
  ADD CONSTRAINT "MoneyPaymentConfirmation_amount_non_negative" CHECK ("amountMinor" >= 0),
  ADD CONSTRAINT "MoneyPaymentConfirmation_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyPaymentConfirmation_external_id_format" CHECK (length("externalConfirmationId") BETWEEN 1 AND 200),
  ADD CONSTRAINT "MoneyPaymentConfirmation_idempotency_key_format" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "MoneyPaymentConfirmation_request_digest_format" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  -- A manual confirmation names its receipt and reviewer; a webhook names neither.
  ADD CONSTRAINT "MoneyPaymentConfirmation_source_evidence" CHECK (
    ("source" = 'MANUAL_REVIEW' AND "receiptMediaAssetId" IS NOT NULL AND "reviewerUserId" IS NOT NULL)
    OR ("source" = 'PROVIDER_WEBHOOK' AND "receiptMediaAssetId" IS NULL AND "reviewerUserId" IS NULL)
  );

ALTER TABLE "SubscriptionPeriod"
  ADD CONSTRAINT "SubscriptionPeriod_ends_after_start" CHECK ("endsAt" > "startsAt");

ALTER TABLE "MoneyRefund"
  ADD CONSTRAINT "MoneyRefund_amount_positive" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "MoneyRefund_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "MoneyRefund_reason_code_format" CHECK ("reasonCode" ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  ADD CONSTRAINT "MoneyRefund_idempotency_key_format" CHECK ("idempotencyKey" ~ '^[A-Za-z0-9_-]{16,128}$'),
  ADD CONSTRAINT "MoneyRefund_request_digest_format" CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  -- A compensating posting exists only for a refund that succeeded.
  ADD CONSTRAINT "MoneyRefund_compensation_only_when_succeeded" CHECK ("compensatingLedgerTransactionId" IS NULL OR "status" = 'SUCCEEDED');

ALTER TABLE "MoneyCoupon"
  ADD CONSTRAINT "MoneyCoupon_code_format" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  ADD CONSTRAINT "MoneyCoupon_value_positive" CHECK ("value" > 0),
  ADD CONSTRAINT "MoneyCoupon_kind_shape" CHECK (
    ("kind" = 'FIXED' AND "currency" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$')
    OR ("kind" = 'PERCENTAGE' AND "currency" IS NULL AND "value" <= 10000)
  ),
  ADD CONSTRAINT "MoneyCoupon_window" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "MoneyCoupon_limits_positive" CHECK (
    ("maxRedemptions" IS NULL OR "maxRedemptions" >= 1)
    AND ("maxRedemptionsPerProvider" IS NULL OR "maxRedemptionsPerProvider" >= 1)
  );

ALTER TABLE "MoneyEntitlementUsage"
  ADD CONSTRAINT "MoneyEntitlementUsage_key_format" CHECK ("entitlementKey" ~ '^[a-z][a-z0-9_.:-]{1,63}$' AND length("usageKey") BETWEEN 1 AND 200);

ALTER TABLE "MoneyReconciliationException"
  ADD CONSTRAINT "MoneyReconciliationException_subject_type" CHECK ("subjectType" IN ('PaymentConfirmation', 'LedgerTransaction', 'Refund', 'SubscriptionPeriod')),
  ADD CONSTRAINT "MoneyReconciliationException_resolution" CHECK (
    ("resolvedAt" IS NULL AND "resolutionCode" IS NULL)
    OR ("resolvedAt" IS NOT NULL AND "resolvedAt" >= "detectedAt" AND "resolutionCode" ~ '^[A-Z][A-Z0-9_]{2,63}$')
  );

-- Append-only rows: refuse UPDATE and DELETE -----------------------------------

CREATE FUNCTION money_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER "MoneyPaymentConfirmation_append_only" BEFORE UPDATE OR DELETE ON "MoneyPaymentConfirmation"
  FOR EACH ROW EXECUTE FUNCTION money_append_only();
CREATE TRIGGER "SubscriptionPeriod_append_only" BEFORE UPDATE OR DELETE ON "SubscriptionPeriod"
  FOR EACH ROW EXECUTE FUNCTION money_append_only();
CREATE TRIGGER "MoneyCouponRedemption_append_only" BEFORE UPDATE OR DELETE ON "MoneyCouponRedemption"
  FOR EACH ROW EXECUTE FUNCTION money_append_only();
CREATE TRIGGER "MoneyEntitlementUsage_append_only" BEFORE UPDATE OR DELETE ON "MoneyEntitlementUsage"
  FOR EACH ROW EXECUTE FUNCTION money_append_only();

-- History rows are never deleted.
CREATE FUNCTION money_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER "SubscriptionPlanVersion_no_delete" BEFORE DELETE ON "SubscriptionPlanVersion"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();
CREATE TRIGGER "MoneyPaymentIntent_no_delete" BEFORE DELETE ON "MoneyPaymentIntent"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();
CREATE TRIGGER "MoneyPaymentAttempt_no_delete" BEFORE DELETE ON "MoneyPaymentAttempt"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();
CREATE TRIGGER "ProviderSubscription_no_delete" BEFORE DELETE ON "ProviderSubscription"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();
CREATE TRIGGER "MoneyRefund_no_delete" BEFORE DELETE ON "MoneyRefund"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();
CREATE TRIGGER "MoneyReconciliationException_no_delete" BEFORE DELETE ON "MoneyReconciliationException"
  FOR EACH ROW EXECUTE FUNCTION money_no_delete();

-- Plan versions are immutable snapshots; only retiredAt may be set, once ------

CREATE FUNCTION subscription_plan_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."retiredAt" IS NOT NULL OR NEW."retiredAt" IS NULL
     OR (NEW."id", NEW."planKey", NEW."version", NEW."billingInterval", NEW."priceMinor", NEW."currency", NEW."entitlements", NEW."publishedAt", NEW."createdAt")
        IS DISTINCT FROM
        (OLD."id", OLD."planKey", OLD."version", OLD."billingInterval", OLD."priceMinor", OLD."currency", OLD."entitlements", OLD."publishedAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'A published plan version is immutable; only retiredAt may be set once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SubscriptionPlanVersion_immutable" BEFORE UPDATE ON "SubscriptionPlanVersion"
  FOR EACH ROW EXECUTE FUNCTION subscription_plan_version_guard();

-- Payment intents: priced once; status follows the domain transition table ----

CREATE FUNCTION money_payment_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."providerProfileId", NEW."planVersionId", NEW."method", NEW."currency", NEW."subtotalMinor", NEW."discountMinor", NEW."totalMinor", NEW."couponId", NEW."idempotencyKey", NEW."requestDigest", NEW."expiresAt", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."providerProfileId", OLD."planVersionId", OLD."method", OLD."currency", OLD."subtotalMinor", OLD."discountMinor", OLD."totalMinor", OLD."couponId", OLD."idempotencyKey", OLD."requestDigest", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'A payment intent is priced once; only its status may change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'CREATED' AND NEW."status" IN ('AWAITING_PAYMENT', 'PROCESSING', 'CANCELLED', 'EXPIRED'))
    OR (OLD."status" = 'AWAITING_PAYMENT' AND NEW."status" IN ('PROCESSING', 'CANCELLED', 'EXPIRED'))
    OR (OLD."status" = 'PROCESSING' AND NEW."status" IN ('SUCCEEDED', 'FAILED'))
  ) THEN
    RAISE EXCEPTION 'Payment intent cannot transition from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyPaymentIntent_guard" BEFORE UPDATE ON "MoneyPaymentIntent"
  FOR EACH ROW EXECUTE FUNCTION money_payment_intent_guard();

CREATE FUNCTION money_payment_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."paymentIntentId", NEW."attemptNo", NEW."createdAt") IS DISTINCT FROM (OLD."id", OLD."paymentIntentId", OLD."attemptNo", OLD."createdAt")
     OR (OLD."externalAttemptId" IS NOT NULL AND NEW."externalAttemptId" IS DISTINCT FROM OLD."externalAttemptId") THEN
    RAISE EXCEPTION 'A payment attempt identity is immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (OLD."status" = 'STARTED' AND NEW."status" IN ('FAILED', 'SUCCEEDED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'Payment attempt cannot transition from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyPaymentAttempt_guard" BEFORE UPDATE ON "MoneyPaymentAttempt"
  FOR EACH ROW EXECUTE FUNCTION money_payment_attempt_guard();

-- A confirmation: a succeeded intent, exactly its total, one posted ledger
-- STANDARD transaction in the same currency ----------------------------------

CREATE FUNCTION money_payment_confirmation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  intent_status "MoneyPaymentIntentStatus";
  intent_total BIGINT;
  ledger_status "LedgerTransactionStatus";
  ledger_kind "LedgerTransactionKind";
BEGIN
  SELECT "status", "totalMinor" INTO intent_status, intent_total
    FROM "MoneyPaymentIntent" WHERE "id" = NEW."paymentIntentId" FOR SHARE;
  IF intent_status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Only a SUCCEEDED payment intent can be confirmed' USING ERRCODE = 'check_violation';
  END IF;
  IF intent_total <> NEW."amountMinor" THEN
    RAISE EXCEPTION 'Confirmed amount must equal the payment intent total' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "status", "kind" INTO ledger_status, ledger_kind
    FROM "LedgerTransaction" WHERE "id" = NEW."ledgerTransactionId";
  IF ledger_status IS DISTINCT FROM 'POSTED' OR ledger_kind IS DISTINCT FROM 'STANDARD' THEN
    RAISE EXCEPTION 'A confirmation needs exactly one POSTED STANDARD ledger transaction' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyPaymentConfirmation_insert_guard" BEFORE INSERT ON "MoneyPaymentConfirmation"
  FOR EACH ROW EXECUTE FUNCTION money_payment_confirmation_insert_guard();

-- Subscriptions: provider and plan fixed; status follows the domain table ----

CREATE FUNCTION provider_subscription_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id", NEW."providerProfileId", NEW."planVersionId", NEW."createdAt") IS DISTINCT FROM (OLD."id", OLD."providerProfileId", OLD."planVersionId", OLD."createdAt") THEN
    RAISE EXCEPTION 'A subscription keeps its provider and plan version' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'PENDING_PAYMENT' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
    OR (OLD."status" = 'ACTIVE' AND NEW."status" IN ('EXPIRED', 'SUSPENDED', 'CANCELLED'))
    OR (OLD."status" = 'SUSPENDED' AND NEW."status" IN ('ACTIVE', 'CANCELLED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'Subscription cannot transition from % to %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "ProviderSubscription_guard" BEFORE UPDATE ON "ProviderSubscription"
  FOR EACH ROW EXECUTE FUNCTION provider_subscription_guard();

-- A period: same provider and plan as its confirmed intent; no overlap -------

CREATE FUNCTION subscription_period_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sub_provider TEXT;
  sub_plan TEXT;
  intent_provider TEXT;
  intent_plan TEXT;
BEGIN
  -- Serializes period inserts of one subscription so the overlap check holds.
  SELECT "providerProfileId", "planVersionId" INTO sub_provider, sub_plan
    FROM "ProviderSubscription" WHERE "id" = NEW."subscriptionId" FOR UPDATE;
  SELECT i."providerProfileId", i."planVersionId" INTO intent_provider, intent_plan
    FROM "MoneyPaymentConfirmation" c JOIN "MoneyPaymentIntent" i ON i."id" = c."paymentIntentId"
    WHERE c."id" = NEW."paymentConfirmationId";
  IF sub_provider IS DISTINCT FROM intent_provider OR sub_plan IS DISTINCT FROM intent_plan THEN
    RAISE EXCEPTION 'A period must be paid by the subscription''s provider for its plan version' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "SubscriptionPeriod" p
     WHERE p."subscriptionId" = NEW."subscriptionId"
       AND p."startsAt" < NEW."endsAt" AND NEW."startsAt" < p."endsAt"
  ) THEN
    RAISE EXCEPTION 'Subscription periods cannot overlap' USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "SubscriptionPeriod_insert_guard" BEFORE INSERT ON "SubscriptionPeriod"
  FOR EACH ROW EXECUTE FUNCTION subscription_period_insert_guard();

-- Refunds: capped by the confirmed amount, serialized on the confirmation ----

CREATE FUNCTION money_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  confirmed BIGINT;
  committed BIGINT;
  compensation_status "LedgerTransactionStatus";
  compensation_kind "LedgerTransactionKind";
  compensation_currency TEXT;
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

  SELECT "amountMinor" INTO confirmed FROM "MoneyPaymentConfirmation"
    WHERE "id" = NEW."paymentConfirmationId" FOR UPDATE;
  SELECT COALESCE(sum("amountMinor"), 0) INTO committed FROM "MoneyRefund"
    WHERE "paymentConfirmationId" = NEW."paymentConfirmationId"
      AND "id" <> NEW."id"
      AND "status" IN ('RESERVED', 'DISPATCHED', 'SUCCEEDED');
  IF NEW."status" IN ('RESERVED', 'DISPATCHED', 'SUCCEEDED') AND committed + NEW."amountMinor" > confirmed THEN
    RAISE EXCEPTION 'Refunds cannot exceed the confirmed amount' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."compensatingLedgerTransactionId" IS NOT NULL THEN
    SELECT "status", "kind", "currency" INTO compensation_status, compensation_kind, compensation_currency
      FROM "LedgerTransaction" WHERE "id" = NEW."compensatingLedgerTransactionId";
    IF compensation_status IS DISTINCT FROM 'POSTED' OR compensation_currency IS DISTINCT FROM NEW."currency" THEN
      RAISE EXCEPTION 'A refund compensation must be a POSTED ledger transaction in the refund currency' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyRefund_guard" BEFORE INSERT OR UPDATE ON "MoneyRefund"
  FOR EACH ROW EXECUTE FUNCTION money_refund_guard();

-- Coupon redemptions: limits enforced under a lock on the coupon -------------

CREATE FUNCTION money_coupon_redemption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  coupon "MoneyCoupon"%ROWTYPE;
  total INT;
  per_provider INT;
  intent_provider TEXT;
  intent_coupon TEXT;
BEGIN
  SELECT * INTO coupon FROM "MoneyCoupon" WHERE "id" = NEW."couponId" FOR UPDATE;
  SELECT "providerProfileId", "couponId" INTO intent_provider, intent_coupon
    FROM "MoneyPaymentIntent" WHERE "id" = NEW."paymentIntentId";
  IF intent_provider IS DISTINCT FROM NEW."providerProfileId" OR intent_coupon IS DISTINCT FROM NEW."couponId" THEN
    RAISE EXCEPTION 'A redemption must match its payment intent''s provider and coupon' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO total FROM "MoneyCouponRedemption" WHERE "couponId" = NEW."couponId";
  SELECT count(*) INTO per_provider FROM "MoneyCouponRedemption"
    WHERE "couponId" = NEW."couponId" AND "providerProfileId" = NEW."providerProfileId";
  IF coupon."maxRedemptions" IS NOT NULL AND total >= coupon."maxRedemptions" THEN
    RAISE EXCEPTION 'Coupon redemption limit reached' USING ERRCODE = 'check_violation';
  END IF;
  IF coupon."maxRedemptionsPerProvider" IS NOT NULL AND per_provider >= coupon."maxRedemptionsPerProvider" THEN
    RAISE EXCEPTION 'Coupon provider redemption limit reached' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyCouponRedemption_guard" BEFORE INSERT ON "MoneyCouponRedemption"
  FOR EACH ROW EXECUTE FUNCTION money_coupon_redemption_guard();

-- Reconciliation exceptions: identity fixed; resolved once -------------------

CREATE FUNCTION money_reconciliation_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."resolvedAt" IS NOT NULL
     OR (NEW."id", NEW."kind", NEW."subjectType", NEW."subjectId", NEW."detectedAt") IS DISTINCT FROM (OLD."id", OLD."kind", OLD."subjectType", OLD."subjectId", OLD."detectedAt") THEN
    RAISE EXCEPTION 'A reconciliation exception keeps its identity and is resolved once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "MoneyReconciliationException_guard" BEFORE UPDATE ON "MoneyReconciliationException"
  FOR EACH ROW EXECUTE FUNCTION money_reconciliation_exception_guard();
