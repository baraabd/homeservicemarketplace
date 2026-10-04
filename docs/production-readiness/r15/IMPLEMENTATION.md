# R15 — Implementation

Status: **R15_INTEGRATION_PENDING. NO LIVE MONEY MOVEMENT IS ENABLED.**

Original R15 base: `develop@a2b31c3090000d2ef8a5e96dd21e80023ee160a7`.
PR #139 integrates `develop@865636ac7691e6c3548bca7d741bcd93d06a116b`,
including the baseline repair, durable support, budget authority, tracked-tree
secret scan and R15 foundation from PR #137. Policy:
[`ACCOUNTING_POLICY.md`](ACCOUNTING_POLICY.md). Invariants:
[`LEDGER_INVARIANTS.md`](LEDGER_INVARIANTS.md). Inventory:
[`MONEY_AUTHORITY_MATRIX.md`](MONEY_AUTHORITY_MATRIX.md).

## What was added

| Layer     | Files                                                                                                                                                                                                                                                                 |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema    | `LedgerAccount`, `LedgerTransaction`, `LedgerEntry`; enums `LedgerAccountOwnerType`, `LedgerTransactionStatus`, `LedgerTransactionKind`, `LedgerEntrySide`; `AuditEventType` + `MONEY_LEDGER_POSTED`, `MONEY_LEDGER_REVERSED`; back-relations on `User` and `Booking` |
| Migration | `20261004150000_r15_ledger_foundation` — additive; Prisma DDL, 16 CHECK constraints, 5 trigger functions, `ledger:read` / `ledger:post` registered and granted to no role                                                                                             |
| API       | `infrastructure/persistence/ledger/ledger.repository.ts`, `modules/money/ledger/ledger.service.ts`, `ledger.module.ts` (mounted in `AppModule`, **no controller**); audit allowlist + `ledgerTransactionId`, `reversesTransactionId`, `actorSystem`                   |
| Tests     | `modules/money/ledger/ledger.service.spec.ts` (hermetic), `test/integration/r15-ledger.integration.spec.ts` (real PostgreSQL)                                                                                                                                         |

No contract, web, route, feature flag, payment adapter or booking hook changed.

## PR #139 integration repair

PR #137 merged while #139 was being verified. Its ledger service, real-PostgreSQL
caller transaction cases and accounting policy match this repair byte for byte.
The updated #139 retains those implementations and adds module/audit/transaction
unit regressions, stronger merge-integrity checks and this acceptance context.
Startup's fail-fast Bash defaults and the original merge-recovery report are
preserved from current develop. Schema, runtime modules, audit allowlist, model
inventory and existing migration contents match current develop.

- Preserve R13's `User` support back-relations, `SupportModule` registration,
  support audit identifiers and model-to-migration index alongside R15.
- Enlist account creation, posting, reversal, fresh permissions and audit in
  an optional caller-owned `PrismaTx`; retain standalone transaction behavior.
- Commit seven real-PostgreSQL caller transaction regressions into the normal
  API integration suite, plus hermetic module, audit and transaction tests.
- Restore R14's real-browser execution and retained artifact after R13;
  guard the R12/R13/R14 acceptance bindings and support/ledger integration.
- Remove temporary PR137 workflows that patched a historical checkout and
  published source blobs. Normal CI validates the current candidate instead.

Local built-in governance and tracked-tree scan regressions executed without
dependencies. Full application, Prisma, PostgreSQL and browser acceptance is
performed by GitHub Actions on the final PR head using Node 24.21.0 and
pnpm 10.32.1; results must be checked there before merge. The editing workspace
has Node 24.19.0/pnpm 11 and no PostgreSQL or Docker, so it cannot supply that
acceptance evidence. No migration contents or live money behavior changed.

## What is deliberately not done

- No checkout, capture, escrow, refund execution, withdrawal, payout, wallet
  cash-out, settlement or external provider call.
- No automatic posting from bookings; no booking-to-ledger event.
- No historical backfill.
- The wallet and admin financial screens still read booking-derived summaries;
  they are not switched to the ledger.
- No fee, commission, tax, payout schedule, escrow rule, currency list or FX.

## Migration acceptance

- Additive only; no existing table altered except `AuditEventType` values and
  new `User`/`Booking` back-relations (no column change).
- Folder timestamp sorts after R13's `20261004120000_r13_support_tickets` (on
  #135) and R12's `20261004090000_…` on develop.
- CI proves: `prisma validate`, schema-vs-migrations drift (empty diff),
  `verify:migrations` (empty database and fixture-upgraded databases), and
  migrate-deploy in every real-service job (existing R05–R12 rows and suites
  unaffected).
- Rollback: forward repair — a migration dropping the three tables, the trigger
  functions, the four enums and the two permissions. `AuditEventType` values
  cannot be dropped in PostgreSQL and are harmless. No other data depends on
  the ledger.

## Tests

Hermetic (`ledger.service.spec.ts`): validation before any database
work (short key, unbalanced, float, bad currency, empty description, > 100
lines), missing capability, unnamed system caller, digest conflict reveals
nothing, digest stability; caller transaction propagation and standalone
account-race recovery. Application module and audit tests separately preserve
support registration and private-data filtering.

Real PostgreSQL (`r15-ledger.integration.spec.ts`): no backfill and no live
grant; balanced 3-line posting with booking/external reference, audit
identifiers only, booking unchanged; 8 invalid shapes; currency shape and
SEK-in-USD; unknown account/booking; replay, changed-payload conflict,
other-actor conflict; 5 identical concurrent commands → one posting; 10
distinct concurrent postings on one account → exact balance; fault injection
after the header, after the first entry and before POSTED, then a clean retry;
audit failure rolls back; lost response recovered; mirrored linked reversal
with the original byte-identical; one reversal under 3-way concurrency;
reversal of a reversal refused; post-replay vs reversal race; authorization
(no capability, unnamed system, holder allowed, revocation immediate); raw-SQL
attacks on posted history; raw-SQL unbalanced/empty/one-sided/pre-posted/
mixed-currency/zero postings; raw-SQL non-mirroring and wrong-currency
reversals; 40 seeded property postings (seeds 1000–1039, mulberry32) with
per-transaction balance and per-account expected balances; deterministic
history paging; query plans over 3,000 bulk postings across 60 accounts.
The caller-owned transaction cases additionally cover visibility before commit,
outer rollback, account creation with posting, reversal rollback/retry, audit
failure, uncommitted permissions and a real uniqueness error without replay
outside the failed transaction.

## Performance

Indexes: `LedgerEntry(accountId, createdAt, id)` for account history,
`LedgerEntry(transactionId, lineNo)` unique for entry loading,
`LedgerTransaction(idempotencyKey)` unique, `(bookingId)`, `(externalReference)`,
`(reversesTransactionId)` unique, `(status, postedAt)`. The integration suite
runs `EXPLAIN (FORMAT JSON)` after `ANALYZE` and asserts each hot lookup uses
its index; the plans are printed in the CI log. History loads entries with their
transaction in one query (no N+1) and pages on immutable `(createdAt, id)`.

## Future R16 boundary

R16 (not started) would decide what events post to the ledger and from where
(payment confirmation per ADR 0014 decision 6/9), the chart of accounts, and any
read-model cut-over — each needing explicit product, compliance and payment
decisions. R15 provides only the authoritative, tested persistence.
