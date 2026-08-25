-- Sprint 9B.2 — verification policy publication and case creation.
--
-- docs/adr/0010-policy-versioned-verification.md
--
-- Three things, all additive and forward-only:
--
--   1. audit event types for policy publication/retirement and case creation
--   2. an idempotency key on VerificationCase, so a replayed create returns
--      the case the first call made
--   3. two PARTIAL unique indexes that turn service-layer rules into database
--      guarantees
--
-- No data is rewritten and no column is dropped, so a rollback is `git revert`
-- of the code plus leaving these in place: an older API build never writes
-- idempotencyKey, never emits the new audit values, and satisfies both indexes
-- trivially because it cannot create a case at all.

-- ── 1. audit event types ────────────────────────────────────────────────────
--
-- IF NOT EXISTS so a re-run against a database that already has them is a
-- no-op rather than a failed deploy. ALTER TYPE ... ADD VALUE cannot be rolled
-- back, but it cannot break a reader either: an older build simply never emits
-- these, and every existing row keeps the value it had.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_POLICY_PUBLISHED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_POLICY_RETIRED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_CREATED';
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'VERIFICATION_CASE_RESUMED';

-- ── 2. idempotency key ──────────────────────────────────────────────────────
ALTER TABLE "VerificationCase" ADD COLUMN "idempotencyKey" TEXT;

-- Unique per PROVIDER, not globally: two providers must not be able to collide
-- on a client-generated value. NULLs stay distinct here, which is what allows
-- any number of keyless cases for the same provider.
CREATE UNIQUE INDEX "VerificationCase_providerProfileId_idempotencyKey_key"
  ON "VerificationCase"("providerProfileId", "idempotencyKey");

-- ── 3a. one active case per provider ────────────────────────────────────────
--
-- Two open cases for one provider means two reviewers, two decisions, and no
-- defined answer about which governs work access. decideCaseCreation() already
-- resumes rather than duplicating; this is the guarantee under the race that
-- code cannot see — two concurrent POSTs both reading "no active case".
--
-- A plain UNIQUE (providerProfileId) would have been expressible in
-- schema.prisma and is WRONG: it would bar a rejected provider from ever
-- trying again. VERIFIED is excluded too — a finished case must not block the
-- re-verification a reviewer opens later.
--
-- Pre-condition, so a deploy against data that already violates the rule fails
-- with a sentence rather than a raw index error naming an oid.
DO $$
DECLARE offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "VerificationCase"
    WHERE "state" IN ('DRAFT','SUBMITTED','IN_REVIEW','ACTION_REQUIRED')
    GROUP BY "providerProfileId"
    HAVING COUNT(*) > 1
  ) x;
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one-active-verification-case-per-provider: % provider(s) already hold more than one open case. Resolve them before deploying.', offending;
  END IF;
END $$;

CREATE UNIQUE INDEX "verification_case_one_active_per_provider_uniq"
  ON "VerificationCase" ("providerProfileId")
  WHERE "state" IN ('DRAFT','SUBMITTED','IN_REVIEW','ACTION_REQUIRED');

-- ── 3b. one live policy per scope ───────────────────────────────────────────
--
-- resolveRequirements() throws AMBIGUOUS_POLICY when two live policies tie on
-- specificity. That is the right behaviour at the wrong MOMENT: it fails a
-- PROVIDER trying to start a case, over a mistake an admin made days earlier
-- and has no way to see. assertNoLiveOverlap() moves the failure to publish
-- time; this makes it impossible rather than merely checked.
--
-- NULLS NOT DISTINCT (PostgreSQL 15+) is load-bearing. The global default is
-- (NULL, NULL, NULL), and Postgres normally treats NULLs as distinct in a
-- unique index — so without this clause the global default could be published
-- twice and the index would not consider those rows equal at all.
--
-- Scoped to un-retired rows: retiring and republishing the same scope is the
-- ordinary way to correct a policy, and history must stay queryable.
DO $$
DECLARE offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "VerificationRequirementPolicy"
    WHERE "retiredAt" IS NULL
    GROUP BY "country", "providerType", "categoryId"
    HAVING COUNT(*) > 1
  ) x;
  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one-live-policy-per-scope: % scope(s) already have more than one un-retired policy. Retire the duplicates before deploying.', offending;
  END IF;
END $$;

CREATE UNIQUE INDEX "verification_policy_one_live_per_scope_uniq"
  ON "VerificationRequirementPolicy" ("country", "providerType", "categoryId")
  NULLS NOT DISTINCT
  WHERE "retiredAt" IS NULL;
