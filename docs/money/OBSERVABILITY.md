# Money observability

Every financial command carries request/correlation id, command/idempotency id, provider id, payment-intent id where applicable, result code and duration. Metrics count intents by state/method, confirmation latency, idempotency replays/conflicts, ledger-post failures, entitlement denials, reconciliation exceptions and manual-review age.

Logs/metrics must not contain receipt bytes, QR secrets, webhook secrets, payment credentials, full sensitive references or unrestricted personal data. Alerts target invariant failures and stuck workflows rather than raw customer content. Trace propagation must preserve correlation across API, worker, webhook and database command boundaries.