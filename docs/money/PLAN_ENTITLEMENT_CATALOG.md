# Plan entitlement catalog

Keys are stable machine identifiers. Plan names are presentation data and MUST NOT appear in authorization conditionals.

Initial catalog:
- `requests.view.monthly` — LIMIT; null means unlimited.
- `requests.accept.monthly` — LIMIT; null means unlimited.
- `customer.contact` — BOOLEAN.
- `customer.phone.view` — BOOLEAN.
- `requests.priority_access` — BOOLEAN.

Example Free version: view=5, accept=5, contact=false, phone=false, priority=false.
Example VIP version: view=unlimited, accept=unlimited, contact=true, phone=true, priority=true.

These are seed examples, not hard-coded product rules. Admin-managed published plan versions bind values. New entitlement keys can be introduced without changing existing plan semantics. Enforcement is server-side at the protected command/query boundary; hiding a UI control is not authorization.
