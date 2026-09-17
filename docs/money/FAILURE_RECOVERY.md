# Failure recovery invariants

Network timeout is an unknown outcome, never automatic failure. Retrying the same command uses the same idempotency key and returns/reconciles the original result.

If authoritative payment confirmation is received but the database transaction fails, the external event remains retryable and no partial local subscription/ledger state may survive. If ledger posting fails, subscription activation fails in the same transaction. If notification delivery fails after a committed activation, notification retries independently and never rolls back money state.

Manual approval races are serialized by locking/rechecking current state; only one terminal decision may create financial side effects. Reconciliation detects stuck PROCESSING intents and authoritative-success/local-missing cases without fabricating payment success.