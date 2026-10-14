# CR-001 — R15 no-backfill assertion by fixture namespace

- **Path:** `apps/api/test/integration/r15-ledger.integration.spec.ts`, the
  case "ships no historical financial backfill and grants the capabilities to
  no live role".
- **Status:** APPLIED in the R19 PR under a coordinator lease limited to this
  one case (recorded in `post-r18/SPRINT_REGISTRY.json`).
- **Why.** The case asserted that every ledger row in the database belonged
  to the R15 run. R19's suite legitimately posts ledger rows, and CI runs both
  suites against one database in nondeterministic order. R15 would therefore
  fail whenever R19 ran first. Observed locally: 3136 foreign transactions
  from an earlier run.
- **Patch.** Foreign accounts are those whose key does not start with `it-`
  (the `fixturePrefix` namespace). Foreign transactions are those with an
  entry on such an account. Both must be 0, and R15's own rows must stay in
  its namespace. The grant assertion is unchanged.
- **Contract kept.** No backfill: a migration importing bookings or earnings
  would create accounts and postings outside the fixture namespace. Shown
  locally: one non-fixture account makes the case fail.
- **Tests.** The R15 suite passes 37/37 on a database shared with the R19
  suite, and fails as intended with one non-fixture account.
- **Owner:** coordinator (R15 owner).
