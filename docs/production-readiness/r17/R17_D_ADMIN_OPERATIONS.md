# R17-D — Admin operations authority, security and analytics honesty

Branch `feat/r17-d-admin-operations`. Base
`develop@aaf30aa0ee53c3a33e08c28226d8c6209df2204c` (tree
`51dc780ac443dd5e30bd0c0848fe82a2b35e398d`). Policy sources:
`R17_D_ADMIN_POLICY.md`. Per-control matrix: `R17_D_AUTHORITY_MATRIX.md`.

## Baseline gate: R17-C post-merge acceptance

PR #145 merged as `aaf30aa`. Its parents are `a8dc1a2` (base) and
`a0a1446` (the reviewed head), and its tree is identical to that head. Push
runs for `aaf30aa`:

| Workflow                            | Run id      | Result                            |
| ----------------------------------- | ----------- | --------------------------------- |
| CI                                  | 37563016555 | 17/17 jobs success, incl. CI gate |
| CodeQL                              | 37563016360 | success                           |
| Production governance               | 37563016305 | success                           |
| Web development startup             | 37563016285 | success (Windows, Ubuntu)         |
| Authentication lifecycle acceptance | 37563016304 | success                           |
| Staging release boundary            | 37563016302 | success                           |

R17-C executed in the dispute journey job (23 passed, 0 failed, 0 pending).
Integration & E2E: 5472 passed, 34 skipped. State:
`R17_C_POSTMERGE_ACCEPTED`. No production code was written before this gate
passed; inventory and the failing-before spec were written while CI ran.

Duplicate-work check: no R17-D branch, PR or worktree existed.

## Results

| ID  | Finding                                                                                                                                                  | Result                                                                                                                                                                                                                                       | Evidence                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Keyed `PUT/DELETE /v1/admin/settings/:key` accepted any key and any JSON, including internal policies (`disputes.*`, `platform_supported_markets`)       | **REPRODUCED_DEFECT → FIXED**: one registry for both surfaces; unknown keys, wrong types, out-of-range values and invalid policy JSON are refused before any write                                                                           | H (baseline: 200/204)                                                                                                    |
| D-2 | CodeQL #1 `js/polynomial-redos` at `admin-settings.service.ts:333`: the e-mail regex ran on unbounded input                                              | **REPRODUCED_DEFECT → FIXED**: bounded linear check, no backtracking pattern on the server or the client                                                                                                                                     | U (500 KB hostile input < 250 ms); H. Baseline: a 120 KB hostile value took ~8 s; a 120 KB valid-shaped value was stored |
| D-3 | CodeQL #5 `js/remote-property-injection` at `admin-settings.service.ts:95`                                                                               | **REPRODUCED_DEFECT → FIXED**: the bulk path was guarded (allowlist before the write), but the keyed PUT wrote a row named `__proto__`. Both paths now use a `Map` registry; the write-to-object sink is gone                                | H (`__proto__`, `constructor`, `prototype`, `toString`, `hasOwnProperty`: 400, no row, no pollution); U                  |
| D-4 | Status changes were role-only; the free-text reason went into audit; concurrent changes audited a stale previous status                                  | **REPRODUCED_DEFECT → FIXED**: fresh `user:write:any`; row lock; `reasonLength` only. Session revocation was already correct (EVIDENCE_ADDED). Last-admin rule **POLICY_BLOCKED** (decision 1); reason model **POLICY_BLOCKED** (decision 2) | H, E, U, B                                                                                                               |
| D-5 | `platform_fee_bps`, `default_currency`, `support_email`, `feature_show_hourly_rate` are read by no product code                                          | **REPRODUCED_DEFECT → FIXED** (truthful): marked `inEffect: false`, shown read-only with a note, writes refused; stored values and history kept. Wiring them is **POLICY_BLOCKED** (decision 4, R16)                                         | H, U, B                                                                                                                  |
| D-6 | Analytics summed currencies under one label, dated completions by `updatedAt`, computed an unapproved fee, and left workspace closures out of "resolved" | **REPRODUCED_DEFECT → FIXED**: per-currency booked value, event-dated completions and cancellations, fee and net `null` (`NOT_APPROVED`), undated completions counted separately, all resolved statuses                                      | H (deterministic XTS/XXX fixture across a UTC day boundary), U, B                                                        |
| D-7 | Users, settings, analytics, notifications and audit lacked real API and browser acceptance                                                               | **EVIDENCE_ADDED**: 13 real-HTTP cases and a 7-step real-browser journey; audit UI paging was BROKEN (stopped at 50) → FIXED                                                                                                                 | H, B                                                                                                                     |

Also found and fixed while proving D-7, all on the affected admin screens:

- **Dashboard labels.** "Active providers" counted all providers, and "Revenue" was booking value. Both relabelled.
- **Failed loads.** A failed analytics load showed "…" or 0 on most cards; every card now shows "—".
- **Dashboard animation.** The chart ignored reduced motion.
- **Settings contrast.** Default hints were `slate-400` text, which fails contrast (48 axe nodes).
- **Arabic layout at 320 px.** Unbreakable setting keys and the shell's hidden skip link caused horizontal overflow. The skip link's `p-3` overrode `sr-only`, and its RTL static position sat 1 px past the edge.
- **Error messages.** Save failures echoed axios text. They now show fixed copy: refused, permission lost, or session ended.

## Root causes

- **D-1.** `UpsertSettingRequest` is a TypeScript interface, so
  `ValidationPipe` had no class to validate. The keyed service wrote
  `body.value` under `:key` directly. A second, unvalidated mutation path
  existed beside the allowlisted bulk path.
- **D-2.** `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` backtracks quadratically on
  `!@!.!.!.…@`, and nothing bounded the input (the JSON body limit is 1 MB).
- **D-4.** `PATCH status`, `suspend` and `restore` carried `@Roles('admin')`
  only, while the reads of the same user needed `user:read:any`. The status
  was read without a lock.
- **D-6.** The analytics service reused provider-earnings aggregates written
  for one provider in one currency, with `updatedAt` as the clock and the
  `PROVIDER_PLATFORM_FEE_BPS` environment value as a fee.

## Design

- **Settings.** `setting-registry.ts` is the one server-side specification:
  a `Map` built from `ADMIN_SETTINGS_SCHEMA` (typed scalars, with an
  `inEffect` flag) plus three structured policies, each validated by the
  parser of the code that reads it. Both surfaces use it, and the bulk
  surface accepts scalar keys only. Writers of one key are serialised with a
  transaction advisory lock taken in sorted key order. Inert settings are
  kept, not deleted, so history stays readable.
- **Users.** The permission is existing seed authority, held by the `admin`
  role, so no account loses access. `PermissionsGuard` now resolves
  `user:write:any` fresh, so a revoked grant takes effect on the next
  request.
- **Analytics.** `admin-analytics.queries.ts` is a separate read model; the
  financials and provider-earnings queries (R15/R16) are untouched. The
  contract change is breaking for analytics clients: three money fields
  became nullable and `series`, `revenueByCurrency` and
  `bookedValueByCurrency` were added. The only consumers are the admin
  dashboard (updated) and Postman.
- **Audit UI.** `useInfiniteQuery` over the existing cursor; no API change.

No schema change, no migration, no feature flag.

## Real-service evidence (local throwaway PostgreSQL 16 + Redis 7)

| Spec                                               | Level | Cases               | Baseline                                | After                            |
| -------------------------------------------------- | ----- | ------------------- | --------------------------------------- | -------------------------------- |
| `r17-admin-operations.integration.spec.ts`         | H     | 13                  | **9 failed**, 4 passed (commit f9de37a) | 13/13, three consecutive runs    |
| `r17-admin-operations-browser.integration.spec.ts` | B     | 1 (7 checked steps) | —                                       | 1/1 on the final code (see note) |

The four baseline passes were already correct:

- COMMIT rollback of a settings write;
- audit paging past 50 rows over the API;
- the admin inbox and unread count;
- authorization across all admin surfaces (anonymous 401, non-admin 403,
  revoked session 401).

The browser journey uses real Vite and a real password/OTP login, with no
interception:

1. **Settings:** an inert setting is read-only; a valid field is checked on
   the client, saved, survives a hard reload, and matches the database.
2. **Dashboard:** XTS 1,234 and XXX 567 appear separately, never 1,801; no
   fee is claimed.
3. **Audit:** the new change is listed; paging goes 50 + 10 to "End of the
   log"; redacted values never appear.
4. **Users:** a suspension persists; with the user-write grant revoked,
   Activate gets a 403 and the dialog explains it; Activate succeeds after
   the grant is restored.
5. **Arabic RTL:** Settings and the dashboard at 320, 390, 768 and 1440 px
   show 0 px page overflow and 0 axe violations (WCAG 2.2 AA tags).
6. **Stale session:** with the session revoked elsewhere, Save gets a 401,
   the value is unchanged, and no "Saved" appears.

Screenshots inspected: `dashboard-ar-320`, `dashboard-en-1440`,
`settings-en-1440`.

Note: local browser runs are unreliable on this shared, memory-constrained
host. Other projects' test runs were active; free RAM was about 1.5 GB. Some
attempts failed at the OTP step on the client's 15 s timeout, before any
admin screen. Those attempts are environmental and are not counted as
passes. Hosted CI is the authoritative browser run.

## Local preflight (Windows 11, Node 24.21.0, pnpm 10.32.1)

| Check                                                                                                                                   | Result                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| install (frozen lockfile), Prisma generate / migrate deploy / build / seed on a fresh database                                          | pass                                                                                                                                                   |
| contracts build                                                                                                                         | pass                                                                                                                                                   |
| API `tsc --noEmit` (src + test), eslint, build                                                                                          | pass                                                                                                                                                   |
| API hermetic unit suite                                                                                                                 | 4069 passed, 1458 skipped (DB-gated), **1 failed**: `restricted-erasure.spec.ts` ENOTDIR, the known Windows-only baseline failure (green on Ubuntu CI) |
| affected gated integration (settings consumers, permissions, R11, R13, verification, work access, all R17, PLATFORM-TX-1, dispute HTTP) | 319 passed, 2 skipped (the two browser specs, gated to their CI step)                                                                                  |
| web `tsc -b`, `typecheck:e2e`, build (`VITE_API_URL` as in CI)                                                                          | pass                                                                                                                                                   |
| web eslint                                                                                                                              | 0 errors, 34 warnings; develop's tree also has 34                                                                                                      |
| web vitest                                                                                                                              | 191 files, 2393 passed                                                                                                                                 |
| governance (`.github/scripts/*.test.mjs`, production-governance, release-baseline)                                                      | 120 passed; pass; pass                                                                                                                                 |
| dependency-audit policy tests                                                                                                           | 39 passed                                                                                                                                              |
| `security:audit` / `security:audit:prod`                                                                                                | 0 findings at every severity                                                                                                                           |

Not run locally: the full gated integration suite (host memory), Docker cold
build, compose smoke, CodeQL and the secret scan. These are hosted CI only.

## CI wiring

A new step in the existing real-AppModule browser job (_Dispute journey_),
after R17-C's, behind its own gate `RUN_ADMIN_BROWSER`:

- the browser spec runs first, then the HTTP spec;
- the step fails closed unless exactly 14 cases pass, with 0 failed, pending
  or todo;
- artifact `r17d-admin-real-evidence` (`if-no-files-found: error`) holds the
  jest JSON, screenshots, and the overflow and axe JSON;
- no cookies, tokens or personal data are uploaded.

The HTTP spec also runs in _Integration & E2E_ automatically. The job took
3.4 minutes on develop, so its 30-minute timeout is unchanged.

## Rollback

Revert the R17-D commits. There is no migration. Effects of rollback:

- Settings rows written through the registry stay valid under the old code.
- Old audit rows keep any free-text reasons they already have; R17-D does not
  rewrite history.
- Analytics clients must accept the previous contract again (only the admin
  dashboard and Postman use it).

## Known limitations

- **Owner decisions still open** (`R17_D_ADMIN_POLICY.md`): last-admin rule,
  reason model, a structured-policy permission, inert settings, money unit,
  audit read permission.
- **Analytics query cost.** The completion query scans all completion events
  before the range end, using the existing `(type, createdAt)` index. No new
  index was added without query-plan evidence at representative volume.
- **Pre-existing presentation issues on the admin home**, left unchanged
  (not a redesign): long Arabic KPI labels in narrow cards, and the
  approvals panel above analytics.
