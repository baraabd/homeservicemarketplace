# G2 — Rollback and stop conditions

## Before merge

The review branch is isolated. If the candidate fails a required test or artifact validation, keep G2 blocked and the PR Draft, retain failures and correct the same branch. Do not mark the wave ready, rewrite accepted historical evidence, raise budgets or import a running peer branch. Withdrawing the review changes affects no deployed application or user database.

## After an explicitly authorized merge

No merge or deployment is performed by this task. If a later authorized integration needs reversal, the owner/coordinator prepares normal reviewed revert commits for this successor's source/CI changes. The execution base is `96e92825f9b65cf124317f43b55ce42fc97f5b49`; no schema, migration, lockfile or feature flag changes are introduced by this repair. Preserve any newer independent work and never reset develop or force-push it.

Return affected future waves to a recorded hold when acceptance is withdrawn. Preserve publication history, exact source/trees, failed artifacts and the original prompt provenance. Do not remove existing G1 acceptance or reopen its frozen source by rewriting its files. A live runtime rollback is a separate owner-approved operation using the existing compatible image/configuration procedure.

## Local fixture cleanup

The disposable database and binary tooling belong only to this G2 task. Stop the exact PostgreSQL instance at `/tmp/hsm-g2-postgres/data` through its recorded owner and `pg_ctl` identity after tests. Do not signal unrelated processes, drop shared databases, remove shared volumes or flush Redis. No task fixture is a production recovery target.

## Money boundary

Application rollback is not a payment refund or ledger reversal. This repair writes no monetary records and enables no live rail. R15 immutable history, R16 payout holds, R18 open owner decisions and `docs/money/LIVE_MONEY_GATE.md` remain binding after any technical revert.
