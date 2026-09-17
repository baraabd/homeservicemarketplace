# Money and payment-evidence threat model

Assets: subscription entitlements, payment state, ledger integrity, coupon value, receipt evidence, payment references, webhook secrets and audit history.

Trust boundaries: provider browser/app → API; admin browser → API; API → database/object store; Stripe → webhook endpoint; scanner worker → restricted object store.

Controls:
- Price tampering: ignore client totals; quote from immutable plan version and validated coupon server-side.
- Replay/double activation: command idempotency keys plus unique DB constraints and atomic activation.
- Concurrent quota/coupon spend: transaction/row lock or atomic conditional update; unique redemption/event key.
- Ledger manipulation: append-only posted transactions, positive entries, same-currency balanced posting, compensating transactions only.
- Webhook spoof/replay: raw-body signature verification, timestamp tolerance, unique external event id and idempotent processing (Sprint 14).
- Receipt malware/polyglot/path traversal: server-generated key, size/type allowlist, magic-byte detection, decode/re-encode for supported images, metadata stripping, malware scan, quarantine/fail-closed read path (Sprint 14).
- Receipt substitution: server SHA-256, immutable original, payment-intent binding, audit log. Perceptual/metadata checks are review signals only.
- Evidence disclosure/IDOR: restricted namespace, owner/reviewer authorization, short-lived audited reads, no public URL.
- Admin abuse: least-privilege financial permissions, reasoned decisions, append-only audit; optional four-eyes threshold.
- XSS from filenames/notes: sanitize display filename and render text as text, not HTML.
- Secret leakage: no credentials in repo/client/logs; environment secret manager; redact webhook/payment secrets.

Abuse tests required before live mode: forged amount, expired intent, reused receipt, duplicate admin approval, approve/reject race, coupon race, quota race, mixed currency ledger, unbalanced ledger, unauthorized evidence access, MIME spoof, oversized file, malicious fixture, duplicate/out-of-order webhook, invalid signature and webhook retry storm.