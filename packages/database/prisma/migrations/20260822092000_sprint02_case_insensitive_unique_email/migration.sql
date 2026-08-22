-- Sprint 2 — invariant: email is unique CASE-INSENSITIVELY.
--
-- "User"."email" carries a plain UNIQUE, and Postgres compares text
-- case-sensitively. So Alice@example.com and alice@example.com are two
-- different accounts today. That is an account-takeover-adjacent defect, not a
-- cosmetic one: login, password reset, and "is this address already
-- registered" all resolve by exact match, so which account a person reaches
-- depends on how they happened to type their address.
--
-- FORWARD-ONLY. See docs/sprint-02/ROLLBACK.md.
--
-- == Why this migration REFUSES instead of remediating ======================
-- The other Sprint 2 constraints collapse their duplicates automatically. This
-- one must not, and the difference is worth stating plainly.
--
-- Two rows differing only in the case of their email are two real accounts.
-- Each has its own sessions, bookings, bids, and audit trail. There is no
-- mechanical rule for which one is "the" account, and choosing silently would
-- either strand one person's history or hand one person another's. Merging
-- accounts is a product decision with a human in the loop; it is not something
-- a migration may decide during a deploy.
--
-- If a collision exists this migration aborts and the deploy stops. That is
-- the intended behaviour, not a failure. Runbook: docs/sprint-02/ROLLBACK.md.
--
-- The exception reports account IDs and a count, never email addresses:
-- migration output lands in CI logs, and CI logs are not a place to spill a
-- list of real users' email addresses.

DO $$
DECLARE
  collisions INTEGER;
  sample     TEXT;
BEGIN
  SELECT COUNT(*) INTO collisions FROM (
    SELECT LOWER("email") FROM "User" GROUP BY 1 HAVING COUNT(*) > 1
  ) x;

  IF collisions > 0 THEN
    SELECT string_agg(ids, ' | ') INTO sample FROM (
      SELECT string_agg("id", ',' ORDER BY "id") AS ids
      FROM "User"
      WHERE LOWER("email") IN (
        SELECT LOWER("email") FROM "User" GROUP BY 1 HAVING COUNT(*) > 1
      )
      GROUP BY LOWER("email")
      LIMIT 20
    ) y;

    RAISE EXCEPTION USING
      MESSAGE = format(
        'Cannot enforce case-insensitive email uniqueness: %s address(es) are held by more than one account.',
        collisions
      ),
      DETAIL  = format('Colliding account id groups (max 20 shown): %s', COALESCE(sample, '(none)')),
      HINT    = 'These are distinct accounts with their own history; a migration must not choose between them. Follow the account-merge runbook in docs/sprint-02/ROLLBACK.md, then re-run this migration.';
  END IF;
END $$;

-- Expression index, so it cannot live in schema.prisma either. Deliberately
-- NOT scoped to "deletedAt" IS NULL: the existing User_email_key is unscoped,
-- so scoping this one would quietly WIDEN behaviour by letting a soft-deleted
-- account's address be re-registered. This migration changes case-sensitivity
-- and nothing else.
CREATE UNIQUE INDEX "user_email_lower_uniq" ON "User" (LOWER("email"));
