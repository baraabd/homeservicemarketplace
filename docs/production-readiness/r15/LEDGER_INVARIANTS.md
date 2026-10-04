# R15 — Ledger invariants and where each is enforced

"DB" means PostgreSQL refuses the violation even when the service is bypassed
(proven with raw SQL in `apps/api/test/integration/r15-ledger.integration.spec.ts`).

| #   | Invariant                                                                                | Service | DB  | Mechanism                                                                   |
| --- | ---------------------------------------------------------------------------------------- | ------- | --- | --------------------------------------------------------------------------- |
| 1   | Amount is a positive integer                                                             | ✓       | ✓   | `bigint` check; `LedgerEntry_amount_positive`, `BIGINT` column              |
| 2   | Currency present and well-formed                                                         | ✓       | ✓   | `normalizeCurrency`; `*_currency_format` CHECKs, `NOT NULL`                 |
| 3   | One currency per transaction; entry currency = transaction = account                     | ✓       | ✓   | composite FKs `(transactionId, currency)` and `(accountId, currency)`       |
| 4   | ≥ 2 lines, at least one debit and one credit                                             | ✓       | ✓   | `assertBalancedLedger`; `ledger_transaction_post_guard`                     |
| 5   | Σ debits = Σ credits                                                                     | ✓       | ✓   | same; sums as `numeric` (no overflow)                                       |
| 6   | Created only as `DRAFT`                                                                  | —       | ✓   | `ledger_transaction_insert_guard`                                           |
| 7   | Only `DRAFT → POSTED`, references unchanged                                              | —       | ✓   | `ledger_transaction_post_guard`                                             |
| 8   | Posted header never updated or deleted                                                   | —       | ✓   | `post_guard`, `ledger_transaction_delete_guard`                             |
| 9   | Entries never updated; never inserted into or deleted from a posted transaction          | —       | ✓   | `ledger_entry_guard` (`FOR SHARE` on the header serializes against posting) |
| 10  | Accounts immutable                                                                       | —       | ✓   | `ledger_account_immutable`                                                  |
| 11  | Idempotency key unique; same key + different command refused                             | ✓       | ✓   | unique index + digest comparison                                            |
| 12  | At most one reversal per transaction                                                     | ✓       | ✓   | unique `reversesTransactionId`                                              |
| 13  | Reversal mirrors the original exactly, same currency, original posted and not a reversal | ✓       | ✓   | `post_guard` multiset comparison (`EXCEPT ALL` both ways)                   |
| 14  | `kind = REVERSAL` ⇔ `reversesTransactionId` set; not self                                | —       | ✓   | `LedgerTransaction_reversal_link`, `_not_self_reversal`                     |
| 15  | `POSTED` ⇔ `postedAt` set                                                                | —       | ✓   | `LedgerTransaction_posted_at_consistent`                                    |
| 16  | Exactly one actor (user or named system)                                                 | ✓       | ✓   | `LedgerTransaction_single_actor`, `_actor_system_format`                    |
| 17  | Booking/account references exist                                                         | ✓       | ✓   | FKs, `ON DELETE RESTRICT` (history is never cascade-deleted)                |
| 18  | Posting + audit atomic                                                                   | ✓       | —   | one database transaction; AuditService rethrows                             |
| 19  | Reads see posted rows only                                                               | ✓       | —   | repository filters `status = 'POSTED'`; the view refuses a draft            |

## Deliberate limits

- `TRUNCATE` by a table owner is not blocked: it is an operator action outside
  the application role's normal use. Production should run the application with
  a role that cannot truncate; that is deployment hardening, not R15.
- A committed `DRAFT` can only arise from direct SQL (the service never commits
  one). It is ignored by every read and may be deleted with its entries.

## Concurrency model

READ COMMITTED with database uniqueness as the arbiter:

- identical concurrent commands: one inserts the key; the others block on the
  unique index, receive P2002 after commit, and replay;
- distinct postings on one account: no balance row is updated, so they never
  contend; balances are sums over entries;
- concurrent reversals: the unique `reversesTransactionId` admits one; the rest
  get `409 LEDGER_ALREADY_REVERSED`;
- no automatic retries: none of these paths raises a serialization failure, so
  nothing is retried and no error is hidden.
