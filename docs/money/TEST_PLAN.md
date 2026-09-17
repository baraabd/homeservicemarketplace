# Money release verification matrix

Unit: integer precision; invalid currency/amount; discount boundaries; month/year end; entitlement disabled/expired/finite/unlimited; ledger positive entries, same currency and debit=credit.

Database/integration: plan publish immutability; one active subscription/provider; idempotency replay; conflicting idempotency payload; atomic usage increment; coupon max-total/max-provider under concurrency; payment confirmation creates exactly one subscription/ledger transaction; rollback leaves neither; posted ledger UPDATE/DELETE rejected; reversal creates a new balanced transaction; cross-currency posting rejected.

Authorization: provider can read only own subscription/payment intents; ordinary provider cannot mutate plans/coupons; admin permissions are explicit; IDOR matrix; CSRF mutation checks; suspended/expired subscription fails closed.

Sprint 14 evidence: size/type/magic-byte mismatch; malicious fixture; scanner unavailable fails closed; hash duplicate; reused receipt; owner/reviewer read matrix; expired read; audit-before-response; original remains immutable; watermark derivative contains no extra sensitive metadata.

Sprint 14 Stripe: invalid/missing signature; duplicate event; out-of-order event; retry storm; amount/currency mismatch; browser success without webhook grants nothing; webhook + DB failure is retryable and does not double-post.

UX/E2E: 320/390/430/768/1024/1440; EN/AR RTL; keyboard; focus; screen-reader labels; localized money; manual pending review; Stripe processing; active/expired plan; quota reached; offline/retry state.

Release gates: format/lint/typecheck, contracts build, Prisma validate/generate/drift, API unit/integration, browser E2E, CodeQL, dependency audit, secret scan, container build/boot and migration rehearsal. No live mode while High/Critical is open.