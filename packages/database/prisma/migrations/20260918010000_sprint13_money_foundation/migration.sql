-- Sprint 13 dark money foundation. Additive only; no live-money behavior.
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY','ANNUAL');
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE','SHAM_CASH','SYRIATEL_CASH','CASH_OFFICE');
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED','AWAITING_PAYMENT','PROCESSING','SUCCEEDED','FAILED','CANCELLED','EXPIRED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_PAYMENT','ACTIVE','EXPIRED','SUSPENDED','CANCELLED');
CREATE TYPE "DiscountKind" AS ENUM ('PERCENTAGE','FIXED');
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET','LIABILITY','REVENUE','EXPENSE','EQUITY');
CREATE TYPE "LedgerSide" AS ENUM ('DEBIT','CREDIT');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('DRAFT','POSTED','REVERSED');

CREATE TABLE "SubscriptionPlan" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
  "description" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PlanVersion" (
  "id" TEXT PRIMARY KEY, "planId" TEXT NOT NULL REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL, "billingInterval" "BillingInterval" NOT NULL,
  "priceMinor" BIGINT NOT NULL, "currency" VARCHAR(3) NOT NULL,
  "publishedAt" TIMESTAMP(3), "retiredAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_version_price_nonnegative" CHECK ("priceMinor" >= 0),
  CONSTRAINT "plan_version_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$'),
  UNIQUE("planId","version","billingInterval")
);
CREATE TABLE "EntitlementDefinition" (
  "id" TEXT PRIMARY KEY, "key" TEXT NOT NULL UNIQUE, "description" TEXT,
  "kind" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entitlement_kind" CHECK ("kind" IN ('BOOLEAN','LIMIT'))
);
CREATE TABLE "PlanEntitlement" (
  "planVersionId" TEXT NOT NULL REFERENCES "PlanVersion"("id") ON DELETE CASCADE,
  "entitlementId" TEXT NOT NULL REFERENCES "EntitlementDefinition"("id") ON DELETE RESTRICT,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "limit" INTEGER,
  PRIMARY KEY("planVersionId","entitlementId"), CONSTRAINT "entitlement_limit_nonnegative" CHECK ("limit" IS NULL OR "limit" >= 0)
);
CREATE TABLE "Coupon" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "kind" "DiscountKind" NOT NULL,
  "value" BIGINT NOT NULL, "currency" VARCHAR(3), "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER, "maxPerProvider" INTEGER NOT NULL DEFAULT 1, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupon_value_positive" CHECK ("value" > 0), CONSTRAINT "coupon_limits_positive" CHECK (("maxRedemptions" IS NULL OR "maxRedemptions" > 0) AND "maxPerProvider" > 0)
);
CREATE TABLE "PaymentIntent" (
  "id" TEXT PRIMARY KEY, "providerProfileId" TEXT NOT NULL REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT,
  "planVersionId" TEXT NOT NULL REFERENCES "PlanVersion"("id") ON DELETE RESTRICT, "couponId" TEXT REFERENCES "Coupon"("id") ON DELETE SET NULL,
  "method" "PaymentMethod" NOT NULL, "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
  "currency" VARCHAR(3) NOT NULL, "subtotalMinor" BIGINT NOT NULL, "discountMinor" BIGINT NOT NULL DEFAULT 0, "totalMinor" BIGINT NOT NULL,
  "idempotencyKey" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL, "succeededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_amounts_valid" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "totalMinor" >= 0 AND "subtotalMinor" - "discountMinor" = "totalMinor"),
  UNIQUE("providerProfileId","idempotencyKey")
);
CREATE TABLE "ProviderSubscription" (
  "id" TEXT PRIMARY KEY, "providerProfileId" TEXT NOT NULL REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT,
  "planVersionId" TEXT NOT NULL REFERENCES "PlanVersion"("id") ON DELETE RESTRICT,
  "paymentIntentId" TEXT UNIQUE REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_PAYMENT', "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_period_valid" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt")
);
CREATE UNIQUE INDEX "provider_subscription_one_active" ON "ProviderSubscription"("providerProfileId") WHERE "status"='ACTIVE';
CREATE TABLE "EntitlementUsage" (
  "id" TEXT PRIMARY KEY, "subscriptionId" TEXT NOT NULL REFERENCES "ProviderSubscription"("id") ON DELETE CASCADE,
  "entitlementId" TEXT NOT NULL REFERENCES "EntitlementDefinition"("id") ON DELETE RESTRICT,
  "periodStart" TIMESTAMP(3) NOT NULL, "periodEnd" TIMESTAMP(3) NOT NULL, "used" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "usage_nonnegative" CHECK ("used" >= 0), UNIQUE("subscriptionId","entitlementId","periodStart")
);
CREATE TABLE "CouponRedemption" (
  "id" TEXT PRIMARY KEY, "couponId" TEXT NOT NULL REFERENCES "Coupon"("id") ON DELETE RESTRICT,
  "providerProfileId" TEXT NOT NULL REFERENCES "ProviderProfile"("id") ON DELETE RESTRICT,
  "paymentIntentId" TEXT NOT NULL UNIQUE REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT,
  "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "coupon_redemption_provider" ON "CouponRedemption"("couponId","providerProfileId");
CREATE TABLE "LedgerAccount" (
  "id" TEXT PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "type" "LedgerAccountType" NOT NULL,
  "currency" VARCHAR(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_account_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$')
);
CREATE TABLE "LedgerTransaction" (
  "id" TEXT PRIMARY KEY, "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'DRAFT', "currency" VARCHAR(3) NOT NULL,
  "referenceType" TEXT NOT NULL, "referenceId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL UNIQUE,
  "reversesTransactionId" TEXT UNIQUE REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT,
  "postedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("referenceType","referenceId")
);
CREATE TABLE "LedgerEntry" (
  "id" TEXT PRIMARY KEY, "transactionId" TEXT NOT NULL REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT,
  "accountId" TEXT NOT NULL REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT, "side" "LedgerSide" NOT NULL,
  "amountMinor" BIGINT NOT NULL, "currency" VARCHAR(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entry_amount_positive" CHECK ("amountMinor" > 0)
);
CREATE INDEX "ledger_entry_transaction" ON "LedgerEntry"("transactionId");

-- Posted ledger records are immutable. Corrections are compensating transactions.
CREATE FUNCTION hsm_reject_posted_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'LedgerTransaction' AND OLD."status" IN ('POSTED','REVERSED') THEN RAISE EXCEPTION 'posted ledger transaction is immutable'; END IF;
  IF TG_TABLE_NAME = 'LedgerEntry' AND EXISTS (SELECT 1 FROM "LedgerTransaction" t WHERE t."id"=OLD."transactionId" AND t."status" IN ('POSTED','REVERSED')) THEN RAISE EXCEPTION 'posted ledger entry is immutable'; END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER ledger_transaction_immutable BEFORE UPDATE OR DELETE ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION hsm_reject_posted_ledger_mutation();
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION hsm_reject_posted_ledger_mutation();

-- Posting validates double-entry balance in the transaction currency.
CREATE FUNCTION hsm_validate_ledger_post() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit_total BIGINT; credit_total BIGINT; bad_currency INTEGER;
BEGIN
  IF NEW."status"='POSTED' AND OLD."status"='DRAFT' THEN
    SELECT COALESCE(SUM(CASE WHEN "side"='DEBIT' THEN "amountMinor" ELSE 0 END),0), COALESCE(SUM(CASE WHEN "side"='CREDIT' THEN "amountMinor" ELSE 0 END),0), COUNT(*) FILTER (WHERE "currency"<>NEW."currency")
      INTO debit_total, credit_total, bad_currency FROM "LedgerEntry" WHERE "transactionId"=NEW."id";
    IF debit_total=0 OR debit_total<>credit_total OR bad_currency<>0 THEN RAISE EXCEPTION 'ledger transaction is unbalanced or currency-mismatched'; END IF;
    NEW."postedAt"=COALESCE(NEW."postedAt",CURRENT_TIMESTAMP);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_validate_before_post BEFORE UPDATE OF "status" ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION hsm_validate_ledger_post();
