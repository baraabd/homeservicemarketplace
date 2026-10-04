# R15 — Accounting policy (dark foundation)

Status: **IMPLEMENTED AS DARK INFRASTRUCTURE. NO LIVE MONEY MOVEMENT IS ENABLED.**

Authority: ADR 0014 (accepted) and `docs/money/*` (normative). This document
defines only the accounting semantics R15 needs. It defines no fee, commission,
tax, payout schedule, escrow rule, supported-currency list or FX rule; none is
approved, and the foundation is neutral to all of them.

## Representation

- **Amounts:** positive integer minor units, PostgreSQL `BIGINT`
  (`LedgerEntry.amountMinor > 0`). TypeScript `bigint` end to end. No floats.
- **Sign convention:** amounts are unsigned; `LedgerEntry.side` is `DEBIT` or
  `CREDIT` (matches `LedgerEntryContract`). An account's net position is
  `sum(DEBIT) − sum(CREDIT)`; R15 attaches no normal-balance meaning to any
  account.
- **Zero:** a zero-value line is refused (it records nothing).
- **Currency:** uppercase three-letter code, stored on the account, the
  transaction and every entry. Which codes are supported is not decided; R15
  enforces shape only.
- **Single currency per transaction.** Every entry's currency equals its
  transaction's and its account's — enforced by composite foreign keys. There is
  no FX; a USD debit can never balance a SEK credit.

## Identity

- `LedgerAccount.id` (cuid) plus a unique caller-chosen `key`
  (`^[a-z0-9][a-z0-9:._-]{2,119}$`). Owner is `PLATFORM` (no user) or `USER`
  (a user id, `ON DELETE RESTRICT`). Accounts are immutable once opened.
- `LedgerTransaction.id` (cuid): one accounting event.
- `LedgerEntry.id` (cuid) with a unique `(transactionId, lineNo)`.

## Lifecycle and posting atomicity

`DRAFT → POSTED`, inside **one** database transaction (STATE_MACHINES.md):

1. authorize the actor (fresh permission read for a user);
2. replay or conflict on the idempotency key;
3. validate accounts, currency and booking reference;
4. insert the header as `DRAFT`;
5. insert every entry (only allowed while the header is `DRAFT`);
6. update the header to `POSTED` — the database trigger validates balance,
   both sides present, ≥ 2 lines and (for a reversal) exact mirroring;
7. write the audit row;
8. commit.

Any failure at any step rolls everything back: there is no committed half
posting. A `DRAFT` is never returned or read as authoritative; reads consider
`POSTED` rows only.

## Caller-owned transactions

`openAccount`, `post` and `reverse` accept an optional third `PrismaTx`
argument. With it, permission reads, account/reference validation, entries,
posting state and audit use the caller's transaction. No nested independent
transaction is opened or committed. Without it, the existing managed
transaction and post-rollback duplicate recovery behavior is unchanged.

This is the composition boundary required by ADR 0014 decision 9 and
`docs/money/FAILURE_RECOVERY.md`. It does not add a payment, subscription or
other live caller. Tests use synthetic caller-owned fixture writes.

The caller must await the ledger operation and propagate failure from its
transaction callback. It must not swallow an audit/validation/storage failure
and then commit related business state. A result obtained inside that callback
is provisional until the enclosing transaction commits; no external success
acknowledgement or side effect may be emitted before commit.

An enlisted operation never recovers from a uniqueness error by reading outside
its transaction or continuing in an aborted PostgreSQL transaction. That error
propagates to the owner, which rolls back and retries its whole idempotent unit
when appropriate. Normal same-key replay already visible to the transaction
still works. A failed outer transaction leaves no committed header, entries or
ledger audit. The same command may subsequently be retried safely.

## Idempotency

Every posting/reversal carries an `idempotencyKey` (`^[A-Za-z0-9_-]{16,128}$`),
unique in the database, and a `requestDigest` = SHA-256 of the canonical command
**including the actor**.

| Case                               | Result                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| same key, same command, same actor | the stored transaction, `replayed: true`                    |
| same key, different command        | `409 LEDGER_IDEMPOTENCY_CONFLICT`, nothing written          |
| same key, another actor            | `409`, and nothing about the stored transaction is returned |
| different key                      | a distinct event                                            |

Nothing is deduplicated by amount or time.

## Reversal

- Posted transactions and entries are never updated or deleted (triggers).
- A correction is a new `REVERSAL` transaction with `reversesTransactionId`
  pointing to the original; its entries mirror the original exactly (same
  accounts and amounts, opposite sides, same currency) — enforced at posting by
  the database.
- `reversesTransactionId` is unique: a transaction is reversed at most once.
- A reversal cannot itself be reversed (no chained reversals in R15).
- "Reversed" is a derived fact (a reversal exists), not a mutation of the
  original. This reconciles ADR 0014's `POSTED | REVERSED` wording with
  STATE_MACHINES.md's rule that the original record remains unchanged; it should
  be noted in the next ADR revision.

## References

- `bookingId` (FK, `RESTRICT`): explains _why_ a record exists. It never means a
  payment was captured.
- `externalReference`: an opaque identifier for a future external payment
  record. It never means capture, settlement or payout.

## Historical data

**No financial backfill.** Completed bookings, bid prices and the
booking-derived earnings summaries are not transactions and are not imported.
The migration creates no ledger rows. The integration suite asserts that the
only ledger rows in the database are its own.

## Authority

- No HTTP route exists. Ordinary users cannot post, reverse, read, choose
  accounts or forge references.
- Server code may call the service as a named `SYSTEM` actor.
- A `USER` actor needs a fresh database read of `ledger:post` (writes) or
  `ledger:read` (reads). The migration registers both and grants them to **no**
  role.

## Audit

`MONEY_LEDGER_POSTED` / `MONEY_LEDGER_REVERSED`, written in the posting database
transaction. Metadata: `ledgerTransactionId`, `reversesTransactionId`,
`bookingId`, `actorSystem` — identifiers only; no amounts, balances, external
payloads or credentials. **Audit failure policy: a failed audit write fails the
posting** (AuditService rethrows; the transaction rolls back).
