# Concurrency boundaries

Read-then-write is forbidden for limited financial resources unless protected by a transaction lock/serializable retry or a single atomic conditional statement. This applies to coupon redemption counts, monthly entitlement usage, manual payment decision, subscription activation and ledger reference creation.

Expected conflicts are domain outcomes, not 500s. Unique/partial indexes are the final authority for one-active-subscription and one-side-effect-per-reference invariants. Transaction retries are bounded and observable. Tests must run genuinely concurrent commands and assert exactly-once side effects.