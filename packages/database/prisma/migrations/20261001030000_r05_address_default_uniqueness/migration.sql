-- R05 — one live default address per user.
--
-- Application transactions now serialize default-affecting writes by locking
-- the owning User row. This partial unique index is the final database backstop
-- so a future code path cannot commit two live defaults.
--
-- Do NOT silently choose a winner if historical data already violates the
-- invariant: that would overwrite a user's intent. Fail the migration and
-- require explicit operator remediation instead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM "Address"
     WHERE "isDefault" = TRUE
       AND "deletedAt" IS NULL
     GROUP BY "userId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'R05 migration blocked: a user has multiple live default addresses';
  END IF;
END
$$;

CREATE UNIQUE INDEX "address_one_live_default_per_user_uniq"
  ON "Address" ("userId")
  WHERE "isDefault" = TRUE
    AND "deletedAt" IS NULL;
