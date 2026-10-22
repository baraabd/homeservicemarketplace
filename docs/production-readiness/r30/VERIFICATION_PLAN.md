# R30 — verification map and evidence boundaries

This file describes the required product verification after an accepted G2
handoff. **No R30 application, migration, browser journey, storage scan, payment
or refund is implemented or tested by writing this plan.** Actual prerequisite
results belong in `ACCEPTANCE.md`; source identity belongs in
`SOURCE_MANIFEST.json` and the published PR body.

## Current prerequisite verification

The conditional registration must preserve the canonical blocked gate, null
freeze, all peer ownership and accepted G1 history. Validate the exact 70-file
union, every proposed shared existing path, absent future modules and unchanged
schema/contracts/budgets. Run governance records and their positive/negative
tests. A `--ready R30` refusal is the expected blocked state, not a failing
product test to bypass.

The separate G2 query repair must pass the affected API lint/type/unit/build
checks and real PostgreSQL equivalence tests against the prior Prisma selectors.
Check authorized filtering, nullable scheduling and category/provider relations,
stable ties, empty/final pages, transaction usage and owned/deleted/missing cursor
anchors. Preserve service authorization and exact DTO/financial values. Run the
unchanged remote R27 populated query/plan/browser harness and evaluate its
downloaded candidate reports against the unchanged proposed limits 5/10/7/3.
Record exact head/tree, run/artifact identity, evaluator count and scope. A green
measurement workflow alone does not imply a passing budget evaluator or owner
policy approval.

Use the repository's exact Node/pnpm pins, frozen lockfile and normal hooks.
Retain security-audit and secret-scan results and complete final PR CI/official
CodeQL. No test suppression, threshold increase, timeout relaxation or fabricated
service identity is allowed. Local native PostgreSQL correctness is distinct
from the real-container R27 harness and hosted acceptance.

## Future product matrix

| Required behavior               | Executable evidence                                                                           | Negative/rollback boundary                                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server-owned manual obligation  | Existing R24 real API plus owned adapter/policy tests                                         | Altered amount/currency/owner/recipient/version, disabled method, unapproved market and expired instruction refused.                                                                                                |
| Actual-byte restricted upload   | Dedicated `r30-receipt-storage.integration.spec.ts`, real private local/S3 storage and ClamAV | MIME/signature mismatch, oversize/truncated/absent/quarantined bytes, scanner outage, same-size substitution, failed finalize and public resolver bypass.                                                           |
| Immutable replacement           | Dedicated receipt-storage and review-lifecycle tests plus direct SQL                          | New asset/revision preserves old bytes/history; purpose/intent mutation, cross-intent asset reuse, invalid predecessors and stale scan/finalize writes refused.                                                     |
| Identity/finance isolation      | Shared identity scan, cleanup, key and restricted-boundary regressions from CR-003            | Legacy NULL-purpose identity rows remain eligible; financial rows never receive identity scan decisions or storage deletion, including stale candidates.                                                            |
| Private receipt read            | Real HTTP storage tests, audit assertions and real browser routes                             | Cross-provider, admin without capability, revoked finance/account, erased, erasure-started, policy-read-blocked or missing evidence, hash mismatch and stale preview cannot disclose bytes.                         |
| Independent finance review      | `r30-review-lifecycle.integration.spec.ts`                                                    | Image/hash/QR alone cannot confirm funds; deny self-review, insufficient policy/authority, wrong amount/currency/account or late/invalid settlement.                                                                |
| Atomic confirmation             | `r30-review-concurrency.integration.spec.ts` plus coordinated R24 tests                       | Race two reviewers/obligations, replacement after inspection, permission revocation and unique deposit claims; inject failure at every participant and assert all financial/final-review writes roll back together. |
| Durable inbox recovery          | Owned processing-job tests and process restart in the dedicated runtime fixture               | Crash after receipt acceptance leaves recoverable RECEIVED work; bounded claim/lease retry preserves command/event keys and final idempotency.                                                                      |
| Correction and decision notices | Real R22 outbox integration and browser reload/relogin                                        | Post-commit delivery, duplicate suppression, provider-visible reason persists; internal notes/deposit evidence never appear in public payloads.                                                                     |
| Manual refund transport         | `r30-manual-refund.integration.spec.ts`, existing R32 port and atomic confirmation tests      | Dispatch/ledger reversal do not mean transfer; uncertain submit retains the same operation key, queries first and never invents a negative confirmation.                                                            |
| Actual routes and accessibility | Dedicated `manual-payments.real-api.spec.ts`, route regressions and inspected screenshots     | AR/EN copy parity, RTL/LTR, mobile/desktop, keyboard/focus, safe errors, session isolation, unauthorized deep links and no false ACTIVE UI.                                                                         |

The dedicated API files and fixture are enumerated in
`PROPOSED_OWNERSHIP.json`; CR-002 through CR-005 name every proposed shared test
change. No file count is an executed test count.

## Future service identity and commands

Before starting product tests, record coordinator-assigned disposable database
and role, isolated Redis/queue identities, storage paths/buckets, scanner,
Compose project/container/volume names, ports and distinct browser contexts.
Inspect effective configuration without secrets. Do not copy a working `.env`,
reset another database, flush shared Redis or erase unrelated objects.

Discover current scripts again at the accepted freeze. The current source
provides these applicable commands; run only after their required files/services
exist, capturing exit codes and precise test/pass/fail/skip counts:

```bash
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/api lint
pnpm --filter @homeservicemarketplace/api typecheck
pnpm --filter @homeservicemarketplace/api test --runInBand
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web typecheck
pnpm --filter @homeservicemarketplace/web test
pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/web exec tsc --noEmit -p manual-payment-tests/tsconfig.json
pnpm --filter @homeservicemarketplace/web exec playwright test --config playwright.r30.config.ts
pnpm security:audit
pnpm security:audit:prod
```

Apply reviewed forward migrations only to the assigned fixture, seed only
approved definitions, and verify drift and constraint preservation. Enable the
real-service suite gates deliberately; a skipped gated test is not a passing
runtime test. Real ClamAV and storage must be exercised, while external funds
remain an explicitly labeled operator simulation until separately authorized.

## Acceptance states

| State                             | Evidence required                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED                       | Reviewed source and tests exist in exact leased paths.                                                                            |
| SOURCE_VERIFIED                   | Exact committed source passed applicable static/unit checks; no inference of external behavior.                                   |
| INTEGRATION_PENDING               | Required shared wiring/participant or service evidence remains missing.                                                           |
| SANDBOX_ACCEPTED                  | Real isolated API/database/private storage/scanner/browser lifecycle passes, with simulated funds labeled.                        |
| HOSTED_ACCEPTED                   | Authorized deployed configuration and real hosted-service evidence pass separately.                                               |
| POLICY_BLOCKED / EXTERNAL_BLOCKED | Name the exact missing decision/resource and owner; do not simulate acceptance.                                                   |
| RELEASE_ACCEPTED                  | Coordinator acceptance plus explicit owner publication/release authority and all retained holds resolved for the requested scope. |

Retain aggregate reports, exact run/artifact IDs and inspected sanitized images.
Never commit receipt bytes, merchant credentials, private reference values,
session traces, raw environment files or signed/private URLs. Approval of a
subscription never grants identity verification, legal/age eligibility or work
access. R16/R18 and live-money restrictions remain independently applicable.
