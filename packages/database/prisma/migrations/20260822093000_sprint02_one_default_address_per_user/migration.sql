-- Sprint 2 — invariant: a user has at most ONE default address.
--
-- AddressesService demotes the previous default inside a transaction when a
-- new default is set, which is correct but racy: two concurrent
-- "make this my default" calls each demote what they read and each promote,
-- leaving two defaults. Downstream, "the" default is read with findFirst, so
-- which one wins becomes arbitrary — a seeker's request silently goes to
-- whichever row the planner happened to return.
--
-- FORWARD-ONLY. See docs/sprint-02/ROLLBACK.md.
--
-- == Remediation policy for pre-existing duplicates =========================
-- Safe to automate, because demoting a default DESTROYS NOTHING: the address
-- row, its label, coordinates, and history are untouched; one boolean flips.
-- The user keeps every address they had and can re-pick a default in one tap.
-- Contrast the email collision, where no mechanical choice is safe.
--
-- The most recently updated default survives, as the closest available proxy
-- for "the one the user most recently chose". Every demoted row is written to
-- DataRemediationLog first, so the previous state is recoverable from the
-- database itself rather than from a backup.

INSERT INTO "DataRemediationLog" (
  "id", "migration", "constraintName", "entity", "entityId", "action", "before", "details"
)
SELECT
  gen_random_uuid()::text,
  '20260822093000_sprint02_one_default_address_per_user',
  'address_one_default_per_user_uniq',
  'Address',
  dup."id",
  'DEMOTED',
  jsonb_build_object('isDefault', dup."isDefault", 'updatedAt', dup."updatedAt"),
  jsonb_build_object(
    'userId', dup."userId",
    'label', dup."label",
    'keptAsDefault', dup."keeper_id",
    'reason', 'multiple default addresses; kept the most recently updated'
  )
FROM (
  SELECT
    a."id", a."userId", a."label", a."isDefault", a."updatedAt",
    FIRST_VALUE(a."id") OVER w AS "keeper_id",
    ROW_NUMBER()        OVER w AS "rn"
  FROM "Address" a
  WHERE a."isDefault" IS TRUE AND a."deletedAt" IS NULL
  WINDOW w AS (PARTITION BY a."userId" ORDER BY a."updatedAt" DESC, a."id" DESC)
) dup
WHERE dup."rn" > 1;

UPDATE "Address" t
SET "isDefault" = FALSE
FROM (
  SELECT a."id",
         ROW_NUMBER() OVER (
           PARTITION BY a."userId" ORDER BY a."updatedAt" DESC, a."id" DESC
         ) AS "rn"
  FROM "Address" a
  WHERE a."isDefault" IS TRUE AND a."deletedAt" IS NULL
) dup
WHERE t."id" = dup."id" AND dup."rn" > 1;

-- Partial: soft-deleted addresses are excluded, matching how the repository
-- already reads defaults (isDefault: true, deletedAt: null). Without the
-- deletedAt clause a soft-deleted former default would permanently block the
-- user from ever having a default again.
CREATE UNIQUE INDEX "address_one_default_per_user_uniq"
  ON "Address" ("userId")
  WHERE "isDefault" IS TRUE AND "deletedAt" IS NULL;

DO $$
DECLARE offending INTEGER;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "Address" WHERE "isDefault" IS TRUE AND "deletedAt" IS NULL
    GROUP BY "userId" HAVING COUNT(*) > 1
  ) x;
  IF offending > 0 THEN
    RAISE EXCEPTION 'one-default-address invariant still violated for % user(s)', offending;
  END IF;
END $$;
