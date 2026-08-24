-- Sprint 9 — backfill a work-access grant for every currently-working provider.
--
-- docs/adr/0013-evidence-to-work-access-capability-transition.md §5
--
-- THIS MIGRATION MUST LAND BEFORE `WORK_ACCESS_ENFORCED` IS TURNED ON.
--
-- ADR 0005 names the reverse order as the way to lock out the entire supply
-- side: rank 7 denies work when no live grant exists, and today NO grant
-- exists for anyone. Arming the gate against an empty table denies every
-- provider on the platform at once.
--
-- What this does NOT do, deliberately:
--
--   It does not touch `verificationState`. Every one of these providers is
--   truthfully UNVERIFIED — nobody ever looked at a document (ADR 0007). The
--   backfill grants ACCESS; it does not invent a VERIFICATION. Writing
--   VERIFIED here would fabricate an audit trail for thousands of people and
--   destroy the one query that makes a later verify-the-back-catalogue
--   campaign possible:
--
--     SELECT * FROM "ProviderWorkAccessGrant" WHERE source = 'LEGACY_BACKFILL';
--
--   It does not set an expiry. `expiresAt = NULL` is open-ended on purpose:
--   giving a whole cohort the same endsAt schedules a mass lapse on one day.
--   Any future bulk renewal must stagger.

-- Recoverability first, matching the Sprint 2 remediation pattern: the log row
-- is written BEFORE the change so the prior state is reconstructible.
INSERT INTO "DataRemediationLog" (
  "id", "migration", "constraintName", "entity", "entityId", "action", "before", "details", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  '20260824084700_sprint09_backfill_legacy_work_access_grants',
  'every_working_provider_holds_a_grant',
  'ProviderProfile',
  p."id",
  'GRANTED_LEGACY_WORK_ACCESS',
  jsonb_build_object(
    'status', p."status",
    'verificationState', p."verificationState",
    'liveGrantsBefore', 0
  ),
  jsonb_build_object(
    'source', 'LEGACY_BACKFILL',
    'note', 'Approved under the pre-Sprint-9 single-status process; identity never verified.'
  ),
  NOW()
FROM "ProviderProfile" p
WHERE p."status" = 'ACTIVE'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProviderWorkAccessGrant" g
    WHERE g."providerProfileId" = p."id"
      AND g."revokedAt" IS NULL
      AND g."status" = 'ACTIVE'
      AND (g."expiresAt" IS NULL OR g."expiresAt" > NOW())
  );

-- The grant itself. Same predicate, so the log and the write cover exactly the
-- same set of rows.
INSERT INTO "ProviderWorkAccessGrant" (
  "id", "providerProfileId", "status", "reason", "source", "caseId",
  "grantedAt", "grantedByUserId", "expiresAt", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  'ACTIVE',
  'LEGACY_APPROVED',
  'LEGACY_BACKFILL',
  -- No case backs this grant, and saying so is the point.
  NULL,
  NOW(),
  -- No human actor: this was the system honouring a prior approval, not a
  -- reviewer making a decision. Attributing it to an admin would be a lie in
  -- the audit trail.
  NULL,
  NULL,
  NOW(),
  NOW()
FROM "ProviderProfile" p
WHERE p."status" = 'ACTIVE'
  AND p."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ProviderWorkAccessGrant" g
    WHERE g."providerProfileId" = p."id"
      AND g."revokedAt" IS NULL
      AND g."status" = 'ACTIVE'
      AND (g."expiresAt" IS NULL OR g."expiresAt" > NOW())
  );

-- Verification, in the migration itself.
--
-- ADR 0013 §5 step 3 requires the live-grant count to equal the
-- previously-working count BEFORE the flag flips. Asserting it here rather
-- than in a runbook means a partial backfill aborts the deploy instead of
-- being discovered later by a provider who cannot work.
DO $$
DECLARE
  working_providers INT;
  granted_providers INT;
BEGIN
  SELECT COUNT(*) INTO working_providers
  FROM "ProviderProfile"
  WHERE "status" = 'ACTIVE' AND "deletedAt" IS NULL;

  SELECT COUNT(DISTINCT g."providerProfileId") INTO granted_providers
  FROM "ProviderWorkAccessGrant" g
  JOIN "ProviderProfile" p ON p."id" = g."providerProfileId"
  WHERE p."status" = 'ACTIVE'
    AND p."deletedAt" IS NULL
    AND g."revokedAt" IS NULL
    AND g."status" = 'ACTIVE'
    AND (g."expiresAt" IS NULL OR g."expiresAt" > NOW());

  IF working_providers <> granted_providers THEN
    RAISE EXCEPTION
      'Sprint 9 backfill incomplete: % working providers but only % hold a live grant. Refusing to complete — arming WORK_ACCESS_ENFORCED against this state would lock out % providers.',
      working_providers, granted_providers, (working_providers - granted_providers);
  END IF;

  RAISE NOTICE 'Sprint 9 backfill: % working providers, % hold a live grant.',
    working_providers, granted_providers;
END $$;
