# Sprint 13 money API boundary

All mutation endpoints require authenticated authorization, CSRF protection where cookie-authenticated, an idempotency key, validation and audit correlation. Amounts returned to JSON clients are decimal strings of integer minor units to avoid JavaScript precision loss.

Provider reads/commands planned for Sprint 13 integration:
- GET `/v1/provider/plans`
- POST `/v1/provider/payment-intents/quote`
- POST `/v1/provider/payment-intents`
- GET `/v1/provider/subscription`
- GET `/v1/provider/entitlements`

Admin plan operations:
- GET/POST `/v1/admin/subscription-plans`
- POST `/v1/admin/subscription-plans/:id/versions`
- POST `/v1/admin/plan-versions/:id/publish`
- POST `/v1/admin/plan-versions/:id/retire`
- GET/POST `/v1/admin/coupons`

Creating an intent snapshots planVersionId, currency, subtotal, discount, total, method and expiry. Neither quote nor intent grants access. Activation belongs to the authoritative payment-confirmation transaction introduced with the payment rail.

Errors use stable machine codes such as INVALID_PLAN_VERSION, PLAN_NOT_PUBLISHED, COUPON_INVALID, COUPON_EXPIRED, COUPON_LIMIT_REACHED, CURRENCY_MISMATCH, IDEMPOTENCY_CONFLICT, SUBSCRIPTION_REQUIRED and ENTITLEMENT_LIMIT_REACHED; localized UI text is client-owned.