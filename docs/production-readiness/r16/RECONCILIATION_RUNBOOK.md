# R16 — Payout reconciliation and rollback runbook (draft)

Status: **DRAFT under R16_POLICY_BLOCKED.** No payout data, worker or rail
exists on `cc41787`, so there is nothing to reconcile today. This runbook fixes
the procedure the implementation must support; rail-specific steps are marked
_[rail]_.

## Authorities compared

1. **Local withdrawal state** — `Withdrawal` + `PayoutAttempt` rows.
2. **Ledger** — `POSTED` reservation, settlement, release and return
   transactions (R15 tables; immutable).
3. **External evidence** _[rail]_ — provider payout records retrieved by
   verified lookup, or, for an approved operator model, uploaded settlement
   evidence through the restricted-media pipeline.

UI wallet figures and booking-derived earnings are never an authority
(`docs/money/RECONCILIATION.md`).

## Discrepancy classes (stable reason codes)

| Code                                                                              | Meaning                                                     | Automatic action                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `PAYOUT_OUTCOME_UNKNOWN_STALE`                                                    | attempt unresolved past the rail's documented lookup window | lookup only; never release                                          |
| `PAYOUT_EXTERNAL_SETTLED_LOCAL_PENDING`                                           | rail reports settled, local not settled                     | settle once if amount/currency/reference match; otherwise exception |
| `PAYOUT_EXTERNAL_FAILED_LOCAL_PENDING`                                            | rail reports definitive failure, local pending              | release once if the failure is definitive under the rail docs       |
| `PAYOUT_LOCAL_SETTLED_NO_EXTERNAL`                                                | local settled without matching external record              | exception; operator decision                                        |
| `PAYOUT_AMOUNT_OR_CURRENCY_MISMATCH`                                              | external record disagrees with the withdrawal               | exception; no money effect                                          |
| `PAYOUT_DUPLICATE_EXTERNAL`                                                       | more than one external transfer for one withdrawal          | exception; operator decision                                        |
| `PAYOUT_RESERVATION_WITHOUT_WITHDRAWAL` / `PAYOUT_WITHDRAWAL_WITHOUT_RESERVATION` | ledger and withdrawal rows disagree                         | exception (should be impossible by atomicity)                       |
| `PAYOUT_RETURN_UNPOSTED`                                                          | rail reports a return with no return transaction            | blocked on approved return semantics                                |

Every exception persists first/last seen times, correlation ids and a
resolution history. Re-running reconciliation is idempotent: settle, release and
return postings use idempotency keys derived from `(withdrawalId, effect)`, so a
second run is a replay, not a second effect.

## Rules for operators

- Release reserved funds only on definitive failure or approved cancellation,
  never because a timer elapsed.
- Never resubmit a payout with a new external identity while an earlier attempt
  may have been accepted.
- Never edit or delete posted ledger rows; corrections are new transactions.
  R15 forbids reversing a reversal, so a payout return is its own transaction
  type, not a reversal of the settlement reversal.
- A manual "mark paid" action, if ever approved, requires evidence, a dedicated
  permission separate from request/approval, a fresh permission read and audit.

## Disable / rollback procedure

1. **Stop new requests:** turn the server feature flag off (fail closed). The
   request route returns a disabled error; reads remain available.
2. **Keep recovery running:** the dispatch worker may be paused, but webhook
   ingestion and reconciliation stay enabled for already accepted withdrawals,
   so no reserved money is stranded.
3. **Never drop financial tables** (`Withdrawal`, `PayoutAttempt`, inbox,
   ledger) as a rollback. Schema rollback is forward-fix only.
4. **Code rollback** to a version without the withdrawal module is allowed only
   when no withdrawal is in `REQUESTED`, `SUBMITTING`, `OUTCOME_UNKNOWN` or
   `PENDING_EXTERNAL`; otherwise roll forward with the flag off.
5. Record the action in the audit log and the release notes.

## Current applicability

Nothing in this runbook is executable on the baseline: there is no withdrawal
persistence, worker, inbox, rail, flag or admin route. The procedure becomes
testable only after `PAYOUT_POLICY.md` P1, P3, P5, P14 and P15 are confirmed.
