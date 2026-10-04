# R15 — Implementation

Status: **R15_INTEGRATION_PENDING. NO LIVE MONEY MOVEMENT IS ENABLED.**

Base: `develop@a2b31c3090000d2ef8a5e96dd21e80023ee160a7` (the post-R12 baseline
repair #134, R13 #135 and R14 #136 are not yet merged). Policy:
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

Hermetic (`ledger.service.spec.ts`, 10 cases): validation before any database
work (short key, unbalanced, float, bad currency, empty description, > 100
lines), missing capability, unnamed system caller, digest conflict reveals
nothing, digest stability.

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
