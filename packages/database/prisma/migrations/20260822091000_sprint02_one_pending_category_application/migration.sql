-- Sprint 2 — invariant: at most ONE live PENDING category application per
-- (provider, category).
--
-- Until now this was a service-layer convention: ProviderCategoryApplications
-- was checked with a SELECT and then INSERTed. Two concurrent applications
-- both pass the SELECT and both insert, so a provider could sit in the admin
-- queue twice for the same skill and an admin could approve the same skill
-- twice. This migration makes the database the authority.
--
-- FORWARD-ONLY. See the rollback / forward-fix plan in
-- docs/sprint-02/ROLLBACK.md before considering a DROP INDEX.
--
-- ── Remediation policy for pre-existing duplicates ────────────────────────
-- Duplicates here are genuinely redundant: the same provider asking for the
-- same skill more than once, with no admin decision on any of them. They can
-- be collapsed automatically, and this migration does so — but never by
-- deleting, and never by flipping the loser to REJECTED. REJECTED means "an
-- admin considered this and said no"; writing it here would fabricate a
-- decision nobody made and corrupt the audit trail that state exists to carry.
--
-- Instead the OLDEST application in each group survives (the provider asked
-- first; that request keeps its queue position), and the rest are marked
-- superseded: status stays PENDING, which is what they honestly were, and
-- supersededAt/supersededById take them out of the index and out of the
-- provider's pendingCategories surface. Every superseded row is written to
-- DataRemediationLog with its pre-change values first, so the change is
-- reversible from the database itself.

-- Step 1 of 3: record what we are about to touch, BEFORE touching it.
INSERT INTO "DataRemediationLog" (
  "id", "migration", "constraintName", "entity", "entityId", "action", "before", "details"
)
SELECT
  gen_random_uuid()::text,
  '20260822091000_sprint02_one_pending_category_application',
  'provider_category_application_one_pending_uniq',
  'ProviderCategoryApplication',
  dup."id",
  'SUPERSEDED',
  jsonb_build_object(
    'status', dup."status",
    'supersededAt', dup."supersededAt",
    'supersededById', dup."supersededById",
    'createdAt', dup."createdAt"
  ),
  jsonb_build_object(
    'providerProfileId', dup."providerProfileId",
    'serviceCategoryId', dup."serviceCategoryId",
    'supersededBy', dup."keeper_id",
    'reason', 'duplicate PENDING application collapsed to the earliest request'
  )
FROM (
  SELECT
    a."id",
    a."status",
    a."supersededAt",
    a."supersededById",
    a."createdAt",
    a."providerProfileId",
    a."serviceCategoryId",
    FIRST_VALUE(a."id") OVER w AS "keeper_id",
    ROW_NUMBER()      OVER w AS "rn"
  FROM "ProviderCategoryApplication" a
  WHERE a."status" = 'PENDING' AND a."supersededAt" IS NULL
  WINDOW w AS (
    PARTITION BY a."providerProfileId", a."serviceCategoryId"
    ORDER BY a."createdAt" ASC, a."id" ASC
  )
) dup
WHERE dup."rn" > 1;

-- Step 2 of 3: collapse the duplicates. Same window, same ordering, so the
-- rows updated here are exactly the rows logged above.
UPDATE "ProviderCategoryApplication" t
SET "supersededAt" = NOW(),
    "supersededById" = dup."keeper_id"
FROM (
  SELECT
    a."id",
    FIRST_VALUE(a."id") OVER w AS "keeper_id",
    ROW_NUMBER()      OVER w AS "rn"
  FROM "ProviderCategoryApplication" a
  WHERE a."status" = 'PENDING' AND a."supersededAt" IS NULL
  WINDOW w AS (
    PARTITION BY a."providerProfileId", a."serviceCategoryId"
    ORDER BY a."createdAt" ASC, a."id" ASC
  )
) dup
WHERE t."id" = dup."id" AND dup."rn" > 1;

-- Step 3 of 3: the constraint itself.
--
-- Partial, so the apply -> rejected -> re-apply flow keeps working: only rows
-- that are actually live and pending occupy the unique slot. A plain UNIQUE on
-- (providerProfileId, serviceCategoryId) would have been expressible in
-- schema.prisma but would permanently bar a provider from re-applying after a
-- rejection.
--
-- Prisma cannot represent a partial index, so it is invisible to
-- `prisma migrate diff` — which is exactly why the CI drift gate stays green,
-- and also why Prisma will never recreate this for you.
CREATE UNIQUE INDEX "provider_category_application_one_pending_uniq"
  ON "ProviderCategoryApplication" ("providerProfileId", "serviceCategoryId")
  WHERE "status" = 'PENDING' AND "supersededAt" IS NULL;

-- Post-condition. If the collapse above missed anything the index creation
-- would already have failed; this asserts the invariant in terms a human can
-- read in the migration log rather than as a raw index violation.
DO $$
DECLARE offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "ProviderCategoryApplication"
    WHERE "status" = 'PENDING' AND "supersededAt" IS NULL
    GROUP BY "providerProfileId", "serviceCategoryId"
    HAVING COUNT(*) > 1
  ) x;
  IF offending > 0 THEN
    RAISE EXCEPTION
      'one-pending-application invariant still violated for % provider/category pair(s)', offending;
  END IF;
END $$;
