# K07 — subscription payments: implementation record

Status: **PARTIALLY IMPLEMENTED · EXTERNAL_BLOCKED · POLICY_BLOCKED · NOT ACCEPTED**.
This record is not G3 acceptance, not a merge decision and not a deployment.
No live charge, payout, secret or approval is involved. LIVE stays disabled:
nothing in this change touches the rail routers, the refund source or the
`SANDBOX`-only guards.

| Field          | Value                                                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base           | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306` (the audit reference; develop had not moved on 2026-11-03) |
| Branch         | `release/ksa-k07-subscription-payments` (worktree `../HSM-k07`)                                                                                                         |
| Toolchain      | Node 24.21.0, pnpm 10.32.1, `pnpm install --frozen-lockfile`                                                                                                            |
| Migration head | Unchanged: 74 migrations, latest `20261024120000_g3_financial_integration`. No schema change                                                                            |
| Flags          | None added. Existing `VITE_STRIPE_SANDBOX_ENABLED` and refund flags unchanged                                                                                           |
| Modes          | Mode A (repeat-purchase defect, finance links); Mode C boundary for the new copy and button. No Mode B redesign                                                         |

## Scope delivered

1. **Same-tab repeat-purchase trap (fixed).** Before: `stripePurchaseKeys`
   stored one set of idempotency identities per user and plan in
   `sessionStorage` and never rotated them. After a confirmed purchase, every
   later "Review purchase" replayed the old intent key, and the server returned
   the old stored snapshot. A second purchase of the same plan version was
   impossible in that tab. FAILED and EXPIRED intents also showed a permanent
   "retry the same purchase" error.
   After: the component reads `GET /v1/money/intents/:id` after every create
   and after any failed step, because a replay returns the stored snapshot, not
   the current status. It offers **Start a new purchase** only when the server
   reports a settled outcome:
   - `SUCCEEDED` → confirmed;
   - `FAILED`, `CANCELLED`, `EXPIRED` → closed.

   Then it rotates all three identities. Pending and unknown purchases keep
   their original identities. The server allows `PROCESSING` to become only
   `SUCCEEDED` or `FAILED`, so `EXPIRED` already means nothing was dispatched.
   An elapsed `expiresAt` on a `PROCESSING` intent is never treated as settled.
   "Check payment status" resumes the same attempt with the original resume key
   and states that the result is not recorded yet.

2. **Finance action links (reconnected).** `financial-report.service.ts`
   returned hard-coded `R30/R31/R32_INTEGRATION_PENDING` links, even though
   R30, R31 and R32 are merged. Links are now computed from the caller's fresh
   permissions and point only to routes the web application serves:
   - receipt review → `/admin/manual-payments`, only with
     `money:receipt:review`; otherwise `PERMISSION_REQUIRED`;
   - My Plan → `/provider/my-plan`, provider audience only;
   - refund → `REFUND_WORKSPACE_ROUTE_ABSENT`, because no such web route
     exists (OD-05);
   - reconciliation actions → still `R34_INTEGRATION_PENDING`.

   Links are navigation hints only. Every destination re-authorizes.

3. **Real-services regression** `apps/api/test/integration/k07-repeat-purchase.integration.spec.ts`,
   added to the existing R30 real-services CI job with an exact-count,
   zero-skip check of 2 cases.

## Not delivered (blocked; see OWNER_DECISIONS.md)

- Selected-provider adapter, production-capable composition boundary and
  external sandbox journeys: **no K02 provider selection exists**. Stripe's
  official availability page does not list Saudi Arabia (OD-02). No adapter
  was written against an invented contract.
- Signed-webhook, decline, 3DS, timeout and over-refund external scenarios:
  these need provider credentials and webhook routing (OD-03). The existing G3
  external runner remains NOT_RUN.
- Repeat-purchase subscription semantics: renew, parallel or refuse (OD-01).
  Today a second purchase opens a parallel overlapping subscription.
- Refund workspace UI (OD-05). Plan, fee, tax and refund policy (OD-04).
- G3 freeze, acceptance and publication. These need K01–K07 accepted and
  merged together, then coordinator approval.

## Issue-to-test matrix

| Issue                                                                                                          | Test (pre-fix result → post-fix result)                                                       |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Second purchase of the same plan in the same tab impossible                                                    | `StripePlanPurchase.repeat.test.tsx` "offers an explicit new purchase…" (FAIL → PASS)         |
| Reload after unobserved success                                                                                | "…after reload from the replayed key…" (FAIL → PASS)                                          |
| Reload or logout/login keeps unused rotated identities; other account isolated                                 | "keeps rotated, still unused identities…" (FAIL → PASS)                                       |
| Pending purchase must not rotate                                                                               | "never offers a new purchase…while pending" (PASS → PASS; invariant)                          |
| Expired quote with unknown outcome keeps identities and recovers                                               | "recovers an expired quote…" (FAIL → PASS)                                                    |
| Definitive failure / pre-dispatch expiry trapped the user                                                      | "…after a definitive server failure", "…expired the intent before any dispatch" (FAIL → PASS) |
| Unexpected error on an open intent still retries the same identity                                             | "still reports an unexpected failure…" (PASS → PASS; invariant)                               |
| Replay is a stale snapshot; fresh read is current; distinct second intent/confirmation/period on real services | `k07-repeat-purchase.integration.spec.ts` (new; PASS 2/2, twice)                              |
| Fresh intent read is owner-only                                                                                | same spec, "denies another provider…" (PASS)                                                  |
| Finance links hard-coded unavailable                                                                           | `financial-report.service.spec.ts` "K07 finance action links…" 4 cases (FAIL 4/4 → PASS 4/4)  |

The pre-fix results come from running the new tests with the two
implementation files temporarily restored to `develop`.

## Commands and results (local; this host)

| Command (package-scoped)                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                 | exit 0                                                                                                                                                                                                                                                                                                                                                                                                   |
| contracts build; database `prisma generate` + build                                              | exit 0                                                                                                                                                                                                                                                                                                                                                                                                   |
| `vitest run src/app/features/subscriptions src/app/features/financial-operations` (web)          | 12 files, 114 passed, 0 failed, 0 skipped                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/web test` (full)                                          | 2,746 tests: 2,745 passed, 1 failed, 0 skipped. The failure is `BookingActions.test.tsx` "Starting…" (untouched file); it passed 3/3 when rerun alone, so it is a load-timing flake, not fixed here                                                                                                                                                                                                      |
| `pnpm --filter @homeservicemarketplace/web typecheck` / `api typecheck`                          | exit 0 / exit 0                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm --filter @homeservicemarketplace/web lint`                                                 | 0 errors, 34 warnings (the same 34 pre-existing warnings)                                                                                                                                                                                                                                                                                                                                                |
| api `eslint src/modules/money/reporting`; prettier check on changed files                        | exit 0; clean                                                                                                                                                                                                                                                                                                                                                                                            |
| `VITE_API_URL=http://127.0.0.1:4010 pnpm --filter @homeservicemarketplace/web build`             | exit 0. An isolated loopback target, not a reachable-API claim                                                                                                                                                                                                                                                                                                                                           |
| api `jest src/modules/money/reporting`                                                           | 4 suites, 100 passed                                                                                                                                                                                                                                                                                                                                                                                     |
| api `jest src/modules/money`                                                                     | 51 suites, 801 passed, 0 failed, 0 skipped                                                                                                                                                                                                                                                                                                                                                               |
| `node --test .github/scripts/*.test.mjs`                                                         | 500 passed, 0 failed, 0 skipped                                                                                                                                                                                                                                                                                                                                                                          |
| `node .github/scripts/g3-record.mjs --check` / `--ready R34`                                     | exit 0 / exit 1 (intended: G3 BLOCKED)                                                                                                                                                                                                                                                                                                                                                                   |
| K07 spec on PostgreSQL 16 + Redis 7 + real ClamAV (`RUN_DB_INTEGRATION=1 RUN_R30_INTEGRATION=1`) | 2 passed, 0 failed, 0 skipped, on two consecutive runs                                                                                                                                                                                                                                                                                                                                                   |
| G3 runtime spec, same services                                                                   | **Not passing locally.** Final clean run: 4 passed, 2 failed (both refund-lifecycle cases at the activation-notification count after the bounded outbox drain). Earlier runs failed on host connectivity and a 120 s setup-hook timeout. The hosted R30 job on develop `92770ea6` passed these same 6 cases, and this diff does not touch that path. Hosted R30 on the K07 head is the required evidence |

Local services ran in task-owned disposable containers on private loopback
ports: `postgres:16-alpine` with a non-superuser owner, `redis:7-alpine` and
`clamav/clamav:stable`. They were removed afterwards. To make the transient
P1001 errors less likely, the local `DATABASE_URL` carried `connect_timeout=30`.
This is not a repository change. No Jest, hook or global timeout was changed.

Hosted CI on develop `92770ea6` is already red on two jobs that K07 does not
touch: "Dependency, secret, and container scans" and "R18 functional
completion acceptance". The R30 real-services job is green there.

## Not run

Real-browser checks of the purchase panel were not run: widths 320–1440, AR/EN,
keyboard, 200% zoom and a real mobile browser. This change adds one status line
and one outline button. It reuses the existing `controlClass`, which gives
`min-h-11`, wrapping and no colour transition. It reuses the existing role,
status and alert semantics and is bilingual. The existing R31 browser/axe job
must run on the K07 head. Until it passes, there is no visual acceptance.
External Stripe or selected-provider sandbox runs: NOT_RUN (no credentials,
no provider selection).

## Rollback / forward repair

There is no migration or data change. Revert the K07 commit to restore the
previous behaviour. Identities already stored in `sessionStorage` keep the same
format and key name, so a rollback leaves them valid. Rotated identities are
ordinary unused keys. Reverting the link change only hides navigation and
grants nothing.
