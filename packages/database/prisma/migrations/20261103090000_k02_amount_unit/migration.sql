-- K02 — exact amount-unit contract for bid and booking amounts (R18 D-2).
--
-- Forward-only and data-preserving. No existing row is updated:
--   * existing rows get amountScale = NULL, which means LEGACY_UNVERIFIED.
--     Their unit cannot be proven (the bid form wrote whole units while the
--     wallet/admin displays assumed cents), so they are quarantined for a
--     reviewed reconciliation instead of a blanket x100 / /100 rewrite;
--   * existing currency values are kept as written (provenance);
--   * the 'USD' column default is dropped so a write that forgets the
--     currency fails instead of silently becoming USD.
--
-- A row may only be marked verified (non-NULL scale) in an approved
-- currency at that currency's ISO 4217 exponent. Today: SAR at 2. Adding a
-- currency changes this constraint and APPROVED_CURRENCY_SCALES together.

ALTER TABLE "Bid" ADD COLUMN "amountScale" SMALLINT;
ALTER TABLE "Booking" ADD COLUMN "amountScale" SMALLINT;

ALTER TABLE "Bid" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Booking" ALTER COLUMN "currency" DROP DEFAULT;

ALTER TABLE "Bid" ADD CONSTRAINT "Bid_amountScale_currency_check"
  CHECK ("amountScale" IS NULL OR ("currency" = 'SAR' AND "amountScale" = 2));
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_amountScale_currency_check"
  CHECK ("amountScale" IS NULL OR ("currency" = 'SAR' AND "amountScale" = 2));

-- Verified amounts are strictly positive minor units. Legacy rows are not
-- constrained retroactively (NOT VALID would still be checked on update of
-- any column, so the predicate is scoped to verified rows instead).
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_verified_amount_positive_check"
  CHECK ("amountScale" IS NULL OR "amount" > 0);
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_verified_amount_positive_check"
  CHECK ("amountScale" IS NULL OR "priceAmount" > 0);
