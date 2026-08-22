-- Sprint 2 — invariant: at most ONE active bid per (provider, request).
--
-- ProviderBidsService.submit enforces this with a SELECT followed by an INSERT
-- inside a transaction. Postgres' default READ COMMITTED isolation does not
-- make that atomic: two concurrent submissions both find no existing bid and
-- both insert. The seeker then sees the same provider twice on one request,
-- at two different prices.
--
-- The predicate mirrors BidRepository.findActiveBidForRequest exactly
-- (status <> 'WITHDRAWN' AND "deletedAt" IS NULL), so the index is a true
-- backstop for the check the application already makes rather than a second,
-- subtly different rule. Withdrawn bids stay excluded, so withdraw-then-
-- resubmit keeps working.
--
-- FORWARD-ONLY. See docs/sprint-02/ROLLBACK.md.
--
-- == Why this migration REFUSES instead of remediating ======================
-- A bid is a live commercial offer. Resolving a duplicate means retracting
-- one, which changes what a provider has offered and what a seeker may accept,
-- and can change who wins the job. Unlike a demoted address flag, that is not
-- undone by flipping a boolean back: a seeker may already have acted on what
-- they saw.
--
-- Duplicates here also should not exist — the application check only loses the
-- race under genuine concurrency — so a non-empty result means something
-- unusual happened and deserves a human's attention, not an automated
-- retraction during a deploy.

DO $$
DECLARE
  offending INTEGER;
  sample    TEXT;
BEGIN
  SELECT COUNT(*) INTO offending FROM (
    SELECT 1 FROM "Bid"
    WHERE "status" <> 'WITHDRAWN' AND "deletedAt" IS NULL
    GROUP BY "providerId", "requestId" HAVING COUNT(*) > 1
  ) x;

  IF offending > 0 THEN
    SELECT string_agg(
             format('(provider=%s, request=%s, bids=%s)', "providerId", "requestId", cnt), ' | '
           ) INTO sample
    FROM (
      SELECT "providerId", "requestId", COUNT(*) AS cnt
      FROM "Bid"
      WHERE "status" <> 'WITHDRAWN' AND "deletedAt" IS NULL
      GROUP BY "providerId", "requestId" HAVING COUNT(*) > 1
      LIMIT 20
    ) y;

    RAISE EXCEPTION USING
      MESSAGE = format(
        'Cannot enforce one-active-bid-per-request: %s (provider, request) pair(s) hold more than one active bid.',
        offending
      ),
      DETAIL  = format('Affected pairs (max 20 shown): %s', COALESCE(sample, '(none)')),
      HINT    = 'Each duplicate is a live offer to a seeker. Retract the surplus bids deliberately through the application, which notifies the parties and writes the audit trail, then re-run this migration. Runbook: docs/sprint-02/ROLLBACK.md.';
  END IF;
END $$;

CREATE UNIQUE INDEX "bid_one_active_per_provider_request_uniq"
  ON "Bid" ("providerId", "requestId")
  WHERE "status" <> 'WITHDRAWN' AND "deletedAt" IS NULL;
