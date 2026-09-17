-- Sprint 13 follow-up invariants. Additive hardening for the dark money foundation.

CREATE FUNCTION hsm_guard_published_plan_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND (
       NEW."planId" IS DISTINCT FROM OLD."planId" OR NEW."version" IS DISTINCT FROM OLD."version"
       OR NEW."billingInterval" IS DISTINCT FROM OLD."billingInterval" OR NEW."priceMinor" IS DISTINCT FROM OLD."priceMinor"
       OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt") THEN
    RAISE EXCEPTION 'published plan version is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_version_published_immutable BEFORE UPDATE ON "PlanVersion" FOR EACH ROW EXECUTE FUNCTION hsm_guard_published_plan_version();

CREATE FUNCTION hsm_guard_published_plan_entitlement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_plan_version TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN target_plan_version := NEW."planVersionId"; ELSE target_plan_version := OLD."planVersionId"; END IF;
  IF EXISTS (SELECT 1 FROM "PlanVersion" p WHERE p."id" = target_plan_version AND p."publishedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'published plan entitlements are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER plan_entitlement_published_immutable BEFORE INSERT OR UPDATE OR DELETE ON "PlanEntitlement" FOR EACH ROW EXECUTE FUNCTION hsm_guard_published_plan_entitlement();

ALTER TABLE "Coupon"
  ADD CONSTRAINT "coupon_currency_upper" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "coupon_window_valid" CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "coupon_percentage_valid" CHECK ("kind" <> 'PERCENTAGE' OR ("value" > 0 AND "value" <= 10000));
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "payment_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "EntitlementUsage" ADD CONSTRAINT "usage_period_valid" CHECK ("periodEnd" > "periodStart");
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "ledger_transaction_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_entry_currency_upper" CHECK ("currency" ~ '^[A-Z]{3}$');

CREATE FUNCTION hsm_guard_ledger_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT','POSTED') THEN RAISE EXCEPTION 'invalid ledger status transition'; END IF;
  IF OLD."status" IN ('POSTED','REVERSED') AND NEW."status" IS DISTINCT FROM OLD."status" THEN RAISE EXCEPTION 'posted ledger status is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_status_transition_guard BEFORE UPDATE OF "status" ON "LedgerTransaction" FOR EACH ROW EXECUTE FUNCTION hsm_guard_ledger_status_transition();

CREATE FUNCTION hsm_validate_ledger_entry_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transaction_currency TEXT; account_currency TEXT; transaction_status "LedgerTransactionStatus";
BEGIN
  SELECT "currency", "status" INTO transaction_currency, transaction_status FROM "LedgerTransaction" WHERE "id" = NEW."transactionId";
  SELECT "currency" INTO account_currency FROM "LedgerAccount" WHERE "id" = NEW."accountId";
  IF transaction_status <> 'DRAFT' THEN RAISE EXCEPTION 'entries may only be added to draft ledger transactions'; END IF;
  IF NEW."currency" <> transaction_currency OR NEW."currency" <> account_currency THEN RAISE EXCEPTION 'ledger currency mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_entry_currency_guard BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION hsm_validate_ledger_entry_currency();
