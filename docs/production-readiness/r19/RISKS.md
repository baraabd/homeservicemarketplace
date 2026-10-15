# R19 — Risks

## Corrective continuation, 2026-10-15

- **CR-004 implemented:** ambiguous bigint objects, sparse/extended arrays,
  hidden/symbol properties and accessors now fail closed in `canonicalJson`.
  Valid confirmation encodings and existing stored digests are unchanged.
  The 15-case regression suite is part of normal API unit tests. Final-head
  evidence belongs to the corrective PR, not PR #159's historical green CI.
- **Compatibility:** callers that previously passed ambiguous/non-JSON shapes
  now receive `NOT_CANONICAL`. Review any such adapter's historical payloads
  explicitly; do not rewrite financial history to make a replay pass.
- **CR-002 remains open:** current merged production source has no registered
  consumer for `money.subscription.activated.v1`; an enabled outbox worker
  dead-letters unknown event types. No live activation caller was added.
- **G1 remains open:** the current registry still records R19 as
  INTEGRATION_PENDING and other Wave 1 lanes as missing. A merged lane or green
  corrective PR cannot stand in for a coordinator-accepted integrated wave.
- **Contract freeze remains incomplete:** explicit internal callable ports
  for later payment/refund/reconciliation operations still need the reviewed
  catalog handoff described in CONTRACT_CATALOG.md.
- **Refund-link source finding:** the existing SQL guard verifies POSTED
  status/currency of a compensation but does not compare its amounts/accounts
  to the refund or the original target of a REVERSAL. This needs direct-SQL
  negative tests and a coordinator-owned additive-migration decision. It is a
  source-review finding, not a new real-database reproduction. The applied
  migration is unchanged.
- **Policy still blocked:** R16 P7, R16 P8/R18 D-2 and R19-P1/P2/P3 remain
  unresolved. No commercial configuration or real money movement is enabled.

CR-003 is APPLIED in the coordinator's current registry. Its older request
document is historical; CR-004 does not edit the shared registry or manufacture
new leases. The original risk table below describes the foundation's retained
constraints.

| #   | Risk                                                                                                                                                            | Severity                   | Handling                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | The outbox event `money.subscription.activated.v1` has no registered handler; the worker dead-letters unknown types                                             | Low while dark (no caller) | CR-002: register the name and a handler before the first live caller                      |
| 2   | Account purposes (R16 P7) are undecided; callers choose the debit and credit accounts                                                                           | Medium for live use        | the unit refuses equal or missing accounts; P7 must be approved before any rail goes live |
| 3   | Currencies and unit scale (R16 P8, R18 D-2) are undecided                                                                                                       | Medium                     | shape-only validation; no `/100`; projections per currency                                |
| 4   | Only an intent's status may change (DB guard); a future intent field needs a migration that also updates the guard                                              | Low                        | documented; the guard fails closed                                                        |
| 5   | A posting under a confirmation's derived key can exist without its confirmation row only through direct SQL; the unit then refuses (409) rather than re-linking | Low                        | reconciliation kind `POSTING_WITHOUT_CONFIRMATION` exists for R34                         |
| 6   | The R15 no-backfill assertion was re-scoped to the `it-` fixture namespace (CR-001)                                                                             | Low                        | a non-fixture account still fails the case (shown locally)                                |
| 7   | Refund dispatch and its failure policy are not implemented; reservations can stay open                                                                          | Low while dark             | R19-P2 and the refund lane                                                                |
| 8   | `TRUNCATE` by a table owner is not blocked (same limit as R15)                                                                                                  | Operational                | production must use an application role without TRUNCATE                                  |
| 9   | Runtime helpers in `@homeservicemarketplace/contracts` (`wire.ts`) must not be imported by the web build (CJS/Rollup boundary)                                  | Low                        | types only on the web side; noted in `money/index.ts`                                     |
| 10  | Local evidence ran on Windows with Docker PostgreSQL 16; the final acceptance is CI on the PR head                                                              | —                          | ACCEPTANCE.md separates local from CI counts                                              |
