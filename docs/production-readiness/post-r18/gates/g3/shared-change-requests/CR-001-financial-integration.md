# CR-001 — complete actual Wave 3 financial integration

Status: **REQUESTED; NOT APPLIED**. This is a concrete handoff, not approval of
new financial policy, a source lease, or permission to start R34 early.

## Exact integration boundaries

| Existing path                                                      | Minimal required future change                                                                                                                                      | Prerequisite                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/money/money.module.ts`                       | Register one reviewed router per configuration/collection/refund port that preserves the existing manual path and delegates STRIPE to the actual R29 implementation | R29 delivered on its assigned branch, reviewed and integrated serially; never import an unmerged lane                                    |
| `apps/api/src/app.module.ts`                                       | Mount the accepted Stripe ingress/handler composition once, only if the accepted R29 module requires root registration                                              | Raw-body/signature boundary and durable inbox proved; no duplicate authority                                                             |
| `apps/api/src/modules/money/refunds/refund-eligibility.policy.ts`  | Keep the existing evaluator; supply a real immutable approved source implementing `RefundPolicySourcePort` instead of the unavailable binding                       | Owner-approved sandbox policy, version history, scope and decision reference; exact new source-file lease recorded before implementation |
| `apps/api/src/modules/money/money.module.ts`                       | Replace only the unavailable refund-policy-source and confirmed-refund-participant bindings with the accepted implementations                                       | R31/R32 approved transaction-bound consequences; never a no-op success participant                                                       |
| `apps/api/src/modules/money/money.module.spec.ts`                  | Update composition assertions to require exactly one real router/participant per token, retaining live-off and unconfigured-policy negative assertions              | Runtime implementation exists; tests must not assert an absent implementation is present                                                 |
| `apps/api/test/integration/r24-money-api.integration.spec.ts`      | Preserve existing negative/atomicity cases; exercise real registered providers in a separately leased G3 suite with no financial-port overrides                     | Independent disposable PostgreSQL/Redis/storage/scanner and authorized sandbox account                                                   |
| `.github/workflows/ci.yml`                                         | Add a source-bound integrated G3 job and sanitized artifacts, without removing existing jobs or converting missing external authority into a pass                   | Reviewed integration harness and secure sandbox credentials; no changes applied in this PR                                               |
| `docs/production-readiness/post-r18/gates/g3/SOURCE_MANIFEST.json` | Populate PASS artifacts only from the actual executed combined source; freeze only after every required category passes                                             | Complete exact-source checks and verified external/manual evidence                                                                       |

No implementation files are added speculatively. The existing Wave 3 plan is
the exact-file starting point for R29. If approved source needs another path,
the coordinator records its exclusive writer/lease first. A policy provider's
storage format cannot be chosen here without the missing policy authority.

## Tests required to close the request

1. Real sandbox Stripe confirmation from untouched signed bytes, inbox durability,
   amount/currency/payer/mode binding, duplicates, out-of-order events and missed
   webhook recovery from the external provider.
2. Real manual receipt/scan/review and settlement evidence, current permissions,
   no self review, duplicate references, double-approval races and rollback.
3. Actual R31 activation once, immutable plan/period/usage behavior, expiry and
   coupon/usage concurrency; no identity or work-access grant from payment.
4. Real partial/full refund transport, unknown outcome query before retry,
   unchanged provider key, no over-refund, linked compensation and approved
   entitlement consequence in the same transaction. Inject failures at the
   audit/consequence boundary and prove no partial local success.
5. Actual R33 read routes/UI with fresh login, permissions, exact amounts and
   honest unavailable reconciliation state. Repeat AR/EN/RTL/mobile/keyboard
   browser checks and inspect the captures.
6. Same-source full CI/security/CodeQL and R27 unchanged-budget acceptance;
   preserve exact pass/fail/skip counts and authenticate run/artifact identities.

## Schema, dependency and operational consequences

This request applies no migration or dependency change. Prefer the frozen
schema/ports; any demonstrated gap requires a separate exact schema/migration
request and serialized ownership. Select and verify R29 vendor/API versions
against official documentation when implementing that sprint, without changing
the repository Node/pnpm/Prisma pins to clear warnings.

Keep live rails off. Do not invent fees, supported currencies, refunds, price
policy, payout or escrow. Do not generate internal success rows as a substitute
for independent settlement evidence. R34 will later own reconciliation windows,
cursors, exception actions and domain/browser evidence after G3 publication.
