-- Sprint 9B.20 — earned service-area expansion.
--
-- docs/sprint-09b20/EARNED_SERVICE_AREA.md
--
-- Two tables and five audit events. Nothing existing is altered, nothing is
-- backfilled, and no row is created for any provider: with the feature switch
-- (`provider_service_area_expansion_enabled`, default false) off, both tables
-- stay empty and every provider's radius bounds are exactly what they were
-- before this migration ran.
--
-- WHY A SECOND POLICY TABLE
--
-- VerificationRequirementPolicy is the existing versioned-policy framework and
-- it is the right SHAPE, but it is also a foreign-key target for
-- VerificationCase and its `requirements` JSON is validated against the
-- document schema. A service-area ladder stored there would be a policy a
-- verification case could legally point at and no reviewer could read. The
-- lifecycle RULES are shared instead — same version format, same append-only
-- publish/retire, same one-live-per-scope guarantee below.
--
-- ROLLBACK / COMPATIBILITY
--
-- Forward-only, like every migration here, but cleanly reversible in practice:
--
--   * Dropping both tables loses only expansion state. No column on
--     ProviderProfile, Booking, Bid or VerificationCase is touched, so every
--     existing reader is unaffected and no provider's stored radius changes.
--   * An OLD binary against a NEW database never queries either table and
--     never emits the new audit values, so it behaves exactly as it does now.
--   * A NEW binary against an OLD database is the only unsafe direction, and
--     only when the feature switch is on — which is why the switch defaults to
--     false and is a separate decision from deploying this.
--   * The five enum values cannot be removed from AuditEventType once added
--     (Postgres does not support DROP VALUE). They are inert if unused, and
--     removing them would in any case orphan the audit rows that explain why
--     someone's service area changed.

-- ── Audit events ────────────────────────────────────────────────────────────
--
-- Publishing a ladder decides who in a market may travel further; an override
-- decides it for one person. Both are the kind of change an appeal turns on,
-- so both are named events rather than a metadata field on a generic one.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SERVICE_AREA_POLICY_PUBLISHED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SERVICE_AREA_POLICY_RETIRED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SERVICE_AREA_EXPANSION_TIER_CHANGED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SERVICE_AREA_EXPANSION_OVERRIDE_SET';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'SERVICE_AREA_EXPANSION_OVERRIDE_CLEARED';

-- ── The ladder ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ServiceAreaExpansionPolicy" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "country" TEXT,
    "tiers" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceAreaExpansionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ServiceAreaExpansionPolicy_version_key"
  ON "ServiceAreaExpansionPolicy"("version");
CREATE INDEX IF NOT EXISTS "ServiceAreaExpansionPolicy_country_retiredAt_idx"
  ON "ServiceAreaExpansionPolicy"("country", "retiredAt");
CREATE INDEX IF NOT EXISTS "ServiceAreaExpansionPolicy_retiredAt_publishedAt_idx"
  ON "ServiceAreaExpansionPolicy"("retiredAt", "publishedAt");

-- One live ladder per market, enforced by the DATABASE.
--
-- The service checks this before writing too, but that check is a read-then-
-- write and loses a race: two admins publishing a ladder for the same country
-- at the same moment would both pass it. The resolver would then have to pick
-- between two live ladders, and whichever rule it used would be arbitrary —
-- a provider's ceiling would depend on which row a query happened to return
-- first. That is exactly the non-deterministic eligibility this sprint forbids,
-- so the guarantee lives here rather than in a comment.
--
-- NULLS NOT DISTINCT because the global default has country = NULL, and
-- Postgres would otherwise treat two such rows as different and allow both.
--
-- Scoped to un-retired rows: retiring and republishing is the ordinary way to
-- correct a ladder, and history has to stay queryable.
DO $$
DECLARE offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "ServiceAreaExpansionPolicy"
    WHERE "retiredAt" IS NULL
    GROUP BY "country"
    HAVING COUNT(*) > 1
  ) x;
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one-live-ladder-per-market: % market(s) already have more than one un-retired policy. Retire the duplicates before deploying.', offending;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "service_area_policy_one_live_per_market_uniq"
  ON "ServiceAreaExpansionPolicy" ("country")
  NULLS NOT DISTINCT
  WHERE "retiredAt" IS NULL;

-- ── What a provider holds ───────────────────────────────────────────────────
--
-- One row per provider, and only for providers the evaluator has actually run
-- for. Absent means "no tier, no override" — which is what every provider is
-- until the feature is switched on.
CREATE TABLE IF NOT EXISTS "ProviderServiceAreaExpansion" (
    "id" TEXT NOT NULL,
    "providerProfileId" TEXT NOT NULL,
    "policyVersion" TEXT,
    "tierKey" TEXT,
    "earnedMaxKm" INTEGER,
    "evaluatedAt" TIMESTAMP(3),
    "overrideMaxKm" INTEGER,
    "overrideReason" TEXT,
    "overrideByUserId" TEXT,
    "overrideAt" TIMESTAMP(3),
    "overrideExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderServiceAreaExpansion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderServiceAreaExpansion_providerProfileId_key"
  ON "ProviderServiceAreaExpansion"("providerProfileId");
CREATE INDEX IF NOT EXISTS "ProviderServiceAreaExpansion_policyVersion_idx"
  ON "ProviderServiceAreaExpansion"("policyVersion");
CREATE INDEX IF NOT EXISTS "ProviderServiceAreaExpansion_overrideByUserId_idx"
  ON "ProviderServiceAreaExpansion"("overrideByUserId");
CREATE INDEX IF NOT EXISTS "ProviderServiceAreaExpansion_evaluatedAt_idx"
  ON "ProviderServiceAreaExpansion"("evaluatedAt");

-- An override without a stated reason is an unattributable change to someone's
-- reach. The service requires one; this makes it true of the table as well, so
-- a future writer cannot bypass it. Both NULL is the ordinary "no override".
ALTER TABLE "ProviderServiceAreaExpansion"
  DROP CONSTRAINT IF EXISTS "provider_service_area_override_needs_reason";
ALTER TABLE "ProviderServiceAreaExpansion"
  ADD CONSTRAINT "provider_service_area_override_needs_reason"
  CHECK (
    ("overrideMaxKm" IS NULL AND "overrideReason" IS NULL)
    OR ("overrideMaxKm" IS NOT NULL AND "overrideReason" IS NOT NULL AND length(btrim("overrideReason")) > 0)
  );

-- A ceiling of zero or less is not an override, it is a mistake that would
-- read as one.
ALTER TABLE "ProviderServiceAreaExpansion"
  DROP CONSTRAINT IF EXISTS "provider_service_area_positive_km";
ALTER TABLE "ProviderServiceAreaExpansion"
  ADD CONSTRAINT "provider_service_area_positive_km"
  CHECK (
    ("overrideMaxKm" IS NULL OR "overrideMaxKm" > 0)
    AND ("earnedMaxKm" IS NULL OR "earnedMaxKm" > 0)
  );

DO $$
BEGIN
  ALTER TABLE "ProviderServiceAreaExpansion"
    ADD CONSTRAINT "ProviderServiceAreaExpansion_providerProfileId_fkey"
    FOREIGN KEY ("providerProfileId") REFERENCES "ProviderProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NO ACTION both ways: the ladder is append-only, so a version a grant points
-- at must not be deletable out from under it.
DO $$
BEGIN
  ALTER TABLE "ProviderServiceAreaExpansion"
    ADD CONSTRAINT "ProviderServiceAreaExpansion_policyVersion_fkey"
    FOREIGN KEY ("policyVersion") REFERENCES "ServiceAreaExpansionPolicy"("version")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SET NULL: a deleted admin account must not delete the record that a
-- provider's ceiling was raised. The reason text and timestamp survive.
DO $$
BEGIN
  ALTER TABLE "ProviderServiceAreaExpansion"
    ADD CONSTRAINT "ProviderServiceAreaExpansion_overrideByUserId_fkey"
    FOREIGN KEY ("overrideByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
