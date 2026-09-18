# Stripe integration contract — Sprint 14

Stripe is an adapter behind HSM PaymentIntent; Stripe identifiers never become HSM authorization decisions by themselves. Server creates the Stripe payment/checkout object from the HSM server-calculated amount/currency and stores external identifiers without secrets.

The browser return route is informational only and remains Processing until persisted webhook processing reports success. The webhook endpoint verifies the signature over the raw body, enforces configured timestamp tolerance, stores a unique external event id, and processes events idempotently. Duplicate or out-of-order events cannot double-post the ledger or activate another subscription.

Before success, HSM rechecks expected amount, currency, provider/payment-intent binding and acceptable external state. Financial side effects run transactionally; failures remain retryable. Refunds create their own domain record and compensating ledger transaction rather than mutating history.

Only sandbox/test mode is allowed until the Money Gate and Sprint 14 exit criteria are green.