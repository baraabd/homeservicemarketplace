# S10 — financial runtime invariants; persistence remains open

Base: `66e336cb4823802aabacc536584972aa43056d23`; final head/checks are in the PR. Status: PARTIAL IMPLEMENTATION, not authoritative financial persistence. S10 remains the reserved Migration Owner, but this initial diff creates no migration, schema, API, contract change, dependency or live-money flag.

## Actual defects repaired

Positive JavaScript numbers could pass the old relational amount check despite bigint types, permitting number arithmetic in the pure quote path. Ledger sides other than DEBIT fell into the CREDIT branch. Unknown coupon kinds fell into the percentage branch. Unknown payment/subscription states transitioning to themselves bypassed validation through the early idempotent return. Invalid billing intervals fell into the annual branch. These runtime paths now fail closed, while valid integer/currency/state behavior remains unchanged.

The source status document corrects the historical claim that financial SQL persistence exists in this baseline. No fictitious migration or unmounted repository is counted as implementation.

## Tests

Executed locally with transpiled pure modules: runtime-invalid amount/side/coupon/state/billing cases and 5000 deterministic balanced/unbalanced bigint cases beyond Number.MAX_SAFE_INTEGER. Added Jest regressions in the actual Money module. Those are pure-domain tests, NOT real PostgreSQL, migration, immutability, transaction rollback, idempotency-receipt or concurrency evidence. Full final-head CI/CodeQL and repository-pinned Jest/build must run on the PR.

## Remaining S10 objective

Financial Prisma authority and additive migrations with constraints, durable repositories/transactional application services, command receipts, append-only posted entries, new-transaction reversals, dark authorization/audit surfaces and real PostgreSQL migration/concurrency/rollback tests are NOT implemented by this commit. S10 cannot pass until those are delivered and proven. No live checkout, webhook, provider secret or money movement exists or is activated here.

Rollback: revert runtime validators/tests and status correction only if replacing them with equivalent truthful/safe behavior. There is no data migration to roll back. Never reinterpret computed marketplace earnings as captured/settled/payout balances. No merge or deployment performed.
