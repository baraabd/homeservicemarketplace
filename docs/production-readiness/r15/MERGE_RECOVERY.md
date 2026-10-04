# R15 integration recovery (PR #137)

Mode A: a focused integration/bug fix, not a new sprint or financial rollout.

## Inspected source

- Failed PR head: `232f5a145726536f1bf4b7e9622a928765e668dc`.
- Failed integration source: `312581a24565e662aec0fda8889e830531ace140`.
- Integration target: `develop@dff53bb702b82e81506bcdc05c523143a8900979`, after R14 (#136).
- Original schema blob: `0e970befdd99b77df708e0809fa0c44241833a56`.
- Restored schema blob: `59cb848a6bb86885b8d3d58139399ff8d879cb34`.

The source was inspected from immutable tracked-source artifacts and compared
file by file. The correction preserves both parent histories and the latest
R13/R14 and secret-scanning changes. No direct write to develop is made.

## Independent findings and dependent failures

1. **Invalid Prisma relation graph.** The User model retained `ledgerAccounts`
   while losing `supportTicketsRequested`, `supportTicketsClosed` and
   `supportMessages`. The owning support models remained present. Prisma 5.22.0
   rejected all three missing inverse relations with P1012. Restore the three
   fields with their original relation names, retaining the ledger relation.
   These are ORM back-relations, not new foreign-key columns. No migration is
   added or rewritten for the recovery.
2. **Support runtime registration lost.** The root module imported the
   SupportModule symbol but its imports array replaced SupportModule with
   LedgerModule. Restore both registrations. Merely formatting the schema
   would leave support routes unmounted.
3. **Support audit identifiers lost.** The ledger metadata additions displaced
   the existing supportTicketId/supportMessageId allowlist. Preserve both
   reviewed identifier sets, without adding message bodies or financial values.
4. **Migration inventory lost.** Support models and their permission migration
   references were displaced by ledger entries. Restore the union and index
   the actual ledger references to User, Booking and Permission. The existing
   inventory verifier still checks that each indexed SQL file contains its
   claimed model token.
5. **Windows startup false success.** Job `111452295121` in startup run
   `37207715389` logged P1012 and failed database/API compiler commands, yet the
   multiline PowerShell steps ended successfully after later Node/web commands.
   Use explicit bash for the cross-platform startup job. GitHub's bash invocation
   enables errexit and pipefail; negative tests prove an early native failure and
   an upstream pipeline failure cannot be hidden by a later successful command.
6. **Metadata drift (already corrected on the old head).** A previous description
   declared an obsolete Final SHA. Keep metadata synchronized after the final
   source commit; do not weaken the validator or create a self-referential commit.
7. **R14 browser acceptance lost from integrated CI.** The R14 browser spec
   remains in develop, but its execution and artifact steps disappeared from
   the integrated workflow. Restore the exact approved step from R14 source
   `b7d240a373497e50fecdcb1c7c79da5d491aa411`, after R13 and before the existing
   aggregate evidence checks. Preserve every other existing acceptance step.
   A new regression fails when any R12/R13/R14 journey or evidence entry is
   missing. A previous green workflow without that execution cannot certify R14.
8. **Ledger operations could not enlist in a caller transaction.** Review
   comment `4177959774` identified the conflict with ADR 0014 decision 9 and
   `docs/money/FAILURE_RECOVERY.md`: unconditional independent transactions
   could commit the ledger even if the caller later rolls back. `openAccount`,
   `post` and `reverse` now accept an optional caller-owned `PrismaTx`.
   Permission checks, persistence, posting state and audit all use that
   transaction. Enlisted failures propagate to the owner instead of performing
   recovery outside an aborted transaction. Standalone behavior is retained.
   The accounting policy documents provisional results and the requirement
   to propagate errors and retry the complete caller-owned unit.

CI run `37207715558` stopped in database verification and consequently skipped
its downstream real-service/browser/security jobs. Its aggregate failure is a
consequence, not a second database defect. The Ubuntu startup job stopped at
Prisma generation before browser evidence existed; the artifact failure is
secondary. Staging's Docker build stopped at the same generation command,
causing its aggregate gate to fail. Authentication acceptance likewise stopped
in its database preparation phase, before the actual lifecycle journey ran.
None of those skipped journeys or scans counts as accepted evidence.

## Verification boundaries

The added `.github/scripts/merge-integrity.test.mjs` is an early source-integration
regression fence, not a replacement for Prisma or real database/browser tests.
Its initial 14 checks cover support/ledger coexistence, module registration,
audit and inventory preservation, and failing native shell commands. Seven
checks fail against the original source; all 14 passed on the first repaired
source in the offline Node 22 diagnostic environment. A fifteenth check now
preserves the actual R12/R13/R14 CI executions and evidence entries.

Isolated preflight `37230345225` used the original immutable PR source,
Node 24.21.0 and the frozen dependency graph. It reproduced exactly three P1012
errors, restored only the reviewed back-relations, and passed Prisma validate,
generate, database typecheck and database build.

Caller-transaction preflight `37231994152` checked out the first repaired source
`61f5bf7ee14c3e432abb16a67a54a05c456e3579`, Node 24.21.0 and the frozen graph.
Seven new cases executed on real PostgreSQL before the service correction:
six failed for the demonstrated transaction-escape behavior, while the existing
audit-failure rollback case passed. After the narrow correction, API typecheck,
lint and build passed. A fresh independently migrated database then passed the
complete ledger integration and unit suites: **2 suites, 46 tests, no skips**.
These cover caller commit visibility, outer rollback, account creation,
reversal, audit failure, uncommitted permissions, and a real unique-constraint
failure that must not be recovered outside the caller transaction. The
controlled stale-read and audit faults are labelled in the tests.

Acceptance-wiring preflight `37232500145` proved the missing R14 step on the
first repaired source, restored only the approved R14 execution/artifact block,
and passed all **15** merge-regression checks on the pinned Node runtime.

The isolated preflights published only verified immutable source blobs. Their
temporary workflows are not included in this PR and must not be merged.
Their successful component-level results are not final integrated acceptance.

Final acceptance requires the normal six workflow families, actual R13/R14
browser executions, the enabled full R15 PostgreSQL suite, Docker/Compose, and
all required security evidence on the final source. Final-head run IDs belong
in the PR handoff rather than in another commit changing the accepted head.

## Safety and rollback

The ledger schema, SQL triggers, migration and pre-existing tests are retained.
The follow-up service change only adds caller-transaction composition and
regression coverage; it introduces no live business caller. No public money
route, payment provider or financial rollout is introduced. Do not revert this
integration wholesale: doing so would restore invalid schema/module state.
Any later correction must preserve both support and ledger invariants and
follow normal review. No production data was changed.
