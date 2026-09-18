# Financial idempotency contract

Every money mutation receives a caller-generated idempotency key scoped to the authenticated actor/command boundary. The first accepted request persists a canonical hash of business inputs with the key. A replay with the same key and same canonical input returns the original result; the same key with different input returns IDEMPOTENCY_CONFLICT and performs no side effect.

Database uniqueness is mandatory at the side-effect authority (for example provider+intent command, external webhook event, payment-to-subscription and ledger reference). Cache-only idempotency is insufficient. Keys have retention at least as long as the external retry/reconciliation window; posted financial references are durable.