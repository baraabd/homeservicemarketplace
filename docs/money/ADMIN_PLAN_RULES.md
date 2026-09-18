# Admin plan and coupon rules

Admins edit a DRAFT plan version only. Publishing freezes billing interval, price, currency and entitlement values. Any later commercial change clones a new DRAFT version; existing subscriptions retain their purchased version.

Plan retirement prevents new purchases but does not revoke existing paid periods. Disabling a plan is therefore not an emergency subscription-revocation mechanism.

Coupon percentage values are represented as integer basis points (1% = 100, 100% = 10000); fixed discounts use integer minor units and require a currency. The server caps discount at subtotal and validates time window, eligible plan/interval and redemption limits transactionally.

Admin forms must preview the exact localized resulting price and entitlement matrix before publish. Destructive/irreversible publish/retire actions require explicit confirmation. Audit records include actor, reason/correlation id and affected immutable version, but no secrets.
