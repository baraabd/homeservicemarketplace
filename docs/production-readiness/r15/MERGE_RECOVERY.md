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
Its 14 checks cover support/ledger coexistence, module registration, audit and
inventory preservation, and failing native shell commands. Seven checks fail
against the original source; all 14 pass on the repaired source in the offline
Node 22 diagnostic environment. Canonical Node 24, database and browser results
must come from the exact corrected PR head's hosted workflows.

An isolated preflight run (`37230345225`) used the original immutable PR source,
Node 24.21.0 and the frozen dependency graph. It reproduced exactly three P1012
errors, restored only the reviewed back-relations, and passed Prisma validate,
generate, database typecheck and database build. It published only the verified
immutable schema blob. Its temporary workflow is not included in this PR and
its result is not final integrated acceptance.

Final acceptance requires the normal six workflow families, real R13/R14
regressions, the enabled R15 PostgreSQL suite, Docker/Compose, and all required
security evidence on the final source. Run IDs belong in the PR handoff rather
than in another commit that changes the accepted head.

## Safety and rollback

The ledger implementation, triggers, migration and existing tests are retained.
No public money route, posting caller, payment provider or financial rollout is
introduced. Do not revert this integration wholesale: doing so would restore
invalid schema/module state. Any later correction must preserve both support
and ledger invariants and follow normal review. No production data was changed.
