# Financial audit vocabulary

Stable event names: MONEY_PLAN_VERSION_PUBLISHED, MONEY_PLAN_VERSION_RETIRED, MONEY_COUPON_CREATED, MONEY_COUPON_REDEEMED, MONEY_PAYMENT_INTENT_CREATED, MONEY_PAYMENT_PROCESSING, MONEY_PAYMENT_SUCCEEDED, MONEY_PAYMENT_FAILED, MONEY_MANUAL_REVIEW_APPROVED, MONEY_MANUAL_REVIEW_REJECTED, MONEY_LEDGER_POSTED, MONEY_LEDGER_REVERSED, MONEY_SUBSCRIPTION_ACTIVATED, MONEY_SUBSCRIPTION_SUSPENDED, MONEY_SUBSCRIPTION_EXPIRED, MONEY_ENTITLEMENT_DENIED.

Metadata is minimal and structured: actor/user id, provider id, planVersion/paymentIntent/subscription/ledger ids as applicable, reason code, request/correlation id and non-secret external reference fingerprint. Never include receipt bytes, access URLs, webhook signatures, secrets or full sensitive payment credentials.