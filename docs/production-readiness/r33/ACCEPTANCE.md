# R33 — Acceptance and executed evidence

**Implementation:** IMPLEMENTED. **Lane source evidence:** SOURCE_VERIFIED for the final local source and real-route evidence below. **Combined-wave state:** INTEGRATION_PENDING. **Vendor sandbox, hosted and release acceptance:** NOT_ASSERTED. Keep the PR Draft while the required integrated-wave evidence is missing.

This is a financial read-model/UI lane. Real local PostgreSQL, Redis, SMTP and browser evidence is not evidence that a payment provider collected live funds, a refund settled, reconciliation completed, or a hosted release was accepted. R30/R31/R32/R34 and the settlement source remain explicit unavailable integrations. The coordinator must separately test the combined candidate. Merge and deployment require the owner's separate authorization.

## Immutable source and publication identity

| Identity                                                                          | Value                                                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sprint / assigned branch                                                          | `R33` / `feat/r33-financial-operations-ui`                                                              |
| Session / worktree                                                                | `r33-5ac99b68f223` / `/workspace/scratch/5ac99b68f223/hsm-r33`                                          |
| Frozen G2 execution base                                                          | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                                                              |
| Frozen source tree                                                                | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                                                              |
| Verified owner publication / intended PR parent                                   | `986b4707776711e80564f0642133ede90ba16f3c`                                                              |
| Owner publication tree                                                            | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                                                              |
| G2 owner merge                                                                    | PR #183, `baraabd`, `2026-10-23T04:11:34Z`; all 30 postmerge checks independently re-read as successful |
| Exact implementation bytes / environment / local artifact digests                 | [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)                                                            |
| Actual final PR head/tree, local normal-hook checkpoint and final CI/artifact IDs | Current PR body after publication; never a self-referential hash embedded in its own commit             |

The worktree started clean on the assigned branch at the frozen source. Its only accepted overlay is the already owner-merged G2 documentation/evidence publication: 13 files, no runtime source difference. That does not refreeze G2 or import a peer branch. The Git Data publication must reproduce the tested normal-hook local tree exactly, parented by the independently verified owner-published `develop` commit. Both the local validation commit and remote publication identities are reported explicitly; no rebase, force-push, merge to `develop` or deployment is performed.

[OWNERSHIP.md](OWNERSHIP.md) and [CR-001](shared-change-requests/CR-001-integration.md) record 32 exact owned paths, eight shared integration paths and 14 coordinator paths. All writes must remain inside that 54-file union. The manifest distinguishes changes against the execution base from changes already present in the owner publication.

## Executed local checks

Rows describe distinct runs; overlapping focused and broader test counts must not be added together. Every completed command listed as PASS exited 0. Browser failures and initial corrected failures remain recorded below.

| Check                                                        | Actual result                                                                                                                                                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install and runtime pins                              | PASS; Node 24.21.0 / pnpm 10.32.1; lockfile unchanged                                                                                                                                                          |
| Prisma generation, database build, fresh migrations and seed | PASS; Prisma 6.12.0; 72 existing migrations applied to the R33-only database; no schema/migration/seed edits                                                                                                   |
| Contracts typecheck and build                                | PASS                                                                                                                                                                                                           |
| API lint, typecheck and production build                     | PASS, including final bounded SQL and endpoint-local export CORS headers                                                                                                                                       |
| Web lint, app/e2e TypeScript and production build            | PASS; final clean production build uses explicit NODE_ENV=production and the allocated API origin; served entry/chunk bytes were verified before browser acceptance                                            |
| New reporting units                                          | PASS: 4 suites, 96 tests, zero failures/skips                                                                                                                                                                  |
| Existing money authority plus reporting and AppModule units  | PASS: 14 suites, 341 tests, zero failures/skips                                                                                                                                                                |
| Dedicated real PostgreSQL reporting integration              | PASS: 1 suite, 15 tests, zero failures/skips                                                                                                                                                                   |
| New financial UI units                                       | PASS: 57 final-source feature tests plus three existing inventory assertions; 60/60 in the final focused run                                                                                                   |
| Existing route table and wallet regressions                  | PASS: 10 tests, zero failures/skips                                                                                                                                                                            |
| Full web unit suite                                          | PASS at the pre-final-copy checkpoint: 2,581/2,581, zero failures/skips. The last localized status-map change is covered by the final 60/60 affected run; exact published-head full CI is reported separately. |
| Offline report verifier negative tests                       | PASS: 47 tests, zero failures/skips                                                                                                                                                                            |
| Full governance regressions and validators                   | PASS: 480 tests, zero failures/skips; registry, baseline, governance files and canonical R33 readiness all exit 0                                                                                              |
| Full / production dependency audits                          | PASS: zero findings at every severity; 1,319 full-tree and 553 production dependencies                                                                                                                         |
| Dedicated real browser evidence                              | PASS: 3/3 first-attempt scenarios, zero failures/skips/flaky cases; 32 screenshots, four axe checks with zero violations, seven actual wire documents verified                                                 |
| Source-tree secret scan                                      | Required on the exact normal-hook commit before publication; actual identity/count recorded in the PR body                                                                                                     |
| Final PR CI and official CodeQL                              | PENDING publication; current final-head conclusions and artifact IDs belong in the PR body                                                                                                                     |

### Exact commands

Run from the assigned worktree with task-local `/tmp/hsm-r33-tools/bin` prepended to PATH. Private task environment files were sourced without printing them; they are not repository files or artifacts.

```bash
pnpm install --frozen-lockfile --store-dir /tmp/hsm-r33-pnpm-store --reporter=append-only
pnpm --filter @homeservicemarketplace/database generate
pnpm --filter @homeservicemarketplace/database migrate:deploy
pnpm --filter @homeservicemarketplace/database build
pnpm --filter @homeservicemarketplace/database seed
pnpm --filter @homeservicemarketplace/contracts build
pnpm --filter @homeservicemarketplace/contracts typecheck
pnpm --filter @homeservicemarketplace/api lint
pnpm --filter @homeservicemarketplace/api exec tsc --noEmit
pnpm --filter @homeservicemarketplace/api build
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web exec tsc -p tsconfig.app.json --noEmit
pnpm --filter @homeservicemarketplace/web typecheck:e2e
NODE_ENV=production VITE_API_URL=http://127.0.0.1:4333 VITE_PROVIDER_ONBOARDING_V2=true pnpm --filter @homeservicemarketplace/web build
```

```bash
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath src/modules/money/reporting/financial-report.service.spec.ts src/modules/money/reporting/financial-export.service.spec.ts src/modules/money/reporting/financial-report.controller.spec.ts src/modules/money/reporting/financial-reporting.module.spec.ts --json --outputFile=/tmp/hsm-r33-reporting-unit-results.json
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --testPathPatterns 'src/modules/money/|src/app.module.spec.ts' --json --outputFile=/tmp/hsm-r33-money-units-final.json
RUN_DB_INTEGRATION=1 NODE_ENV=test pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/integration/r33-financial-reporting.integration.spec.ts --json --outputFile=/tmp/hsm-r33-reporting-db-results.json
pnpm --filter @homeservicemarketplace/web exec vitest run src/app/features/financial-operations src/app/features/provider-onboarding-v2/testid-inventory.test.ts --reporter=default --reporter=json --outputFile.json=/tmp/hsm-r33-ui-focused-final.json
pnpm --filter @homeservicemarketplace/web exec vitest run src/app/components/provider/WalletScreen.test.tsx src/app/routes.lazy.test.tsx --reporter=json --outputFile=/tmp/hsm-r33-entry-tests.json
pnpm --filter @homeservicemarketplace/web exec vitest run --maxWorkers=2 --reporter=json --outputFile=/tmp/hsm-r33-web-units-final.json
node --test scripts/production/financial-reports/verify-report.test.cjs
node --test .github/scripts/*.test.mjs
node .github/scripts/sprint-registry.mjs
node .github/scripts/release-baseline.mjs
node .github/scripts/production-governance.mjs
node .github/scripts/g2-record.mjs --ready R33
pnpm security:audit --output /tmp/hsm-r33-audit-full.json
pnpm security:audit:prod --output /tmp/hsm-r33-audit-production.json
```

Scoped ESLint with `--max-warnings=0`, Prettier checks and `git diff --check` cover the new source, dedicated API/browser tests, verifier and leased integration files. API's normal lint only includes `src/`, so the dedicated integration spec is also checked explicitly. Normal Husky/lint-staged hooks are retained for commits.

## Real database proof

The 15-case suite creates and migrates its own random database through the accepted isolation helper. It uses actual source rows, a real ledger service/posted balanced entries, payment attempts and dispatches, refund requests/refunds, subscription periods and current permission resolution. It never resets a shared database or rewrites a real ledger.

Assertions cover all five available record kinds and unavailable settlements; exact amounts above JavaScript's safe-integer limit; separate currencies; successful transport versus confirmed posting; unpaid subscription null amounts; current role/grant changes; provider owner scope and cursor reuse denial; consistent keyset paging during newer inserts; transaction visibility during in-flight confirmation; CSV injection/large-number preservation/redaction; aggregate overflow; and reconciliation run-status/exception distinctions.

Query performance is tested with one versus 50 parent records, actual captured SQL, and LATERAL `LIMIT 1` for latest attempts and subscription periods. Constant statement count alone is insufficient. The final implementation bounds child rows inside SQL and then hydrates only authorized selected IDs in the same repeatable-read transaction.

## Real browser and visual evidence

The dedicated spec contains exactly three scenarios. It uses the built SPA, mounted AppModule, real authenticated cookie/OTP flow, PostgreSQL permission changes, Redis and the task Mailpit. Synthetic fixture rows invoke existing balance/state/relation triggers. No financial response is mocked; no real vendor money or identity decision is asserted.

The scenarios cover Admin report/detail/keyset/export and unavailable integrations; Provider own versus foreign history and unpaid versus confirmed subscription periods; and current permission revocation followed by a new login. Browser offline pausing is explicitly distinguished from an actual failed read, preserves only labelled last-successful values and resumes authoritative reads on reconnection.

The visual matrix targets both surfaces in AR/EN, widths 320/390/430/768/1024/1440, dark mode and 200% CSS layout zoom, with actual direction/overflow/control geometry checks. Keyboard Enter/Tab/Escape and focus return, plus axe checks, are executed by the spec. The final run produced 32 screenshots: twelve light layouts, one dark desktop, one 200% CSS layout-zoom view and two mobile detail views per surface. Screenshot names/digests and the actual inspected subset are recorded in SOURCE_MANIFEST.json. Root and the independent reviewer inspect final-run captures; preliminary failed-run images are not acceptance evidence. At 200% CSS layout zoom, the table retains a bounded horizontal scroll region; the final inspected captures also show the action buttons. This is CSS layout zoom evidence, not a claim about a browser toolbar zoom setting. Traces and videos are disabled.

The successful local run uses the external task-only normal-trust Playwright config. Its final JSON reports exactly three first-attempt passes and zero failures, skipped or flaky cases. Root independently executed the existing count guard and verified all seven actual response documents. The generated count summary has `sourceSha: null` because this run exercised the uncommitted worktree; the manifest binds its exact source bytes instead. Final CI binds the published PR head through `SOURCE_SHA`.

```bash
PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/hsm-r33-browser-final.json pnpm --filter @homeservicemarketplace/web exec playwright test e2e/r33-financial-operations/financial-operations.real-api.spec.ts --config=/tmp/hsm-r33-browser-trust/playwright.local.config.ts --project=chromium-desktop --workers=1 --retries=0 --reporter=line,json --output=/tmp/hsm-r33-browser-final-artifacts
node scripts/ci/assert-playwright-run.cjs /tmp/hsm-r33-browser-final.json 3 R33-financial-operations /tmp/hsm-r33-browser-final-summary.json
```

Every one of the seven `*.wire.json` documents below that final output directory was passed individually to `node scripts/production/financial-reports/verify-report.cjs`; the sanitized results and source bindings are hashed in the manifest.

CI runs the three scenarios explicitly after the existing Admin suite using the same built API/SPA. Its unchanged 10/IP/minute login budget expires naturally between suites. Exactly three first-attempt passes, no skipped/flaky/interrupted cases and exactly seven saved actual response documents are required; every response passes the offline wire verifier. R33 uploads only synthetic PNGs and sanitized counts, excluding response bodies, credentials, raw logs, traces and environment files.

## Actual failures and corrections

1. Initial restricted-environment generation/CLI/socket operations were refused by the execution sandbox. They were rerun under scoped automatic approval without changing application assertions or runtime pins. The first Chromium download returned a corrupt/truncated archive; an existing exact Chromium 1234 binary set was copied into a separate R33 cache, version and executable hashes checked, and a real launch succeeded.
2. The first database run passed 13/14 cases. A fixture `resolvedAt` preceded database-default `detectedAt` by 1 ms; setting its explicit earlier detection time fixed the fixture while preserving the domain constraint.
3. A new real-SQL assertion exposed Prisma's in-memory per-parent `take: 1` behavior. It correctly failed. Replacing the two child fan-outs with parameterized bounded LATERAL lookups produced the final 15/15 real-PostgreSQL pass.
4. Early UI/format checks found Arabic numbering dependent on the host CLDR default and lint-invalid control-character regular expressions. Explicit Arabic numbering and Unicode control/format categories corrected them. The provider page was corrected to its actual records/detail routes. Independent review also prompted matching confirmation identity/amount/currency checks and cancellation of exports on actor change/unmount, with retained regression tests.
5. The first whole-web run passed 2,579/2,580 assertions; the existing inventory guard could not resolve two concatenated dynamic test IDs. The new JSX now uses the repository's template-literal convention with identical emitted IDs. The guard was preserved. Its focused and whole-web reruns passed.
6. The first browser attempt was blocked by sandbox localhost access before fixture setup. The approved attempt then failed before login because local Chromium did not trust the environment proxy's certificate for the inherited external font stylesheet. These attempts are retained as failed environment evidence, with no financial-screen acceptance or screenshots claimed.

7. The first browser run with normal task-local certificate trust passed one scenario and failed two select locators. The actual accessible roles were correct; selectors now use exact named combobox roles and retain the original behavior assertions. This run is preserved as 1 passed / 2 failed / 0 skipped / 0 flaky.
8. Focused review and live-route checks led to endpoint-local export-header exposure and an explicit offline/paused query notice. The first complete visual run produced 32 screenshots and seven wire documents but finished 2 passed / 1 failed because permission revocation raced an in-flight reconnect read. The spec now waits for all recovery reads to settle before revoking the grant. No timeout or permission rule was relaxed.
9. Human inspection found the published subscription status `PENDING_PAYMENT` falling back to an untranslated token. A type-enforced map now covers all published payment, attempt, subscription, refund and dispatch statuses; a focused test and live EN/AR assertions cover the correction. A subsequent run passed two cases but the provider assertion caught a stale built entry still loading the earlier financial chunk. That failed run is retained separately. Root stopped only the recorded R33 preview, preserved its generated output, performed a clean production build and verified disk-versus-HTTP SHA-256 equality along the current HTML/entry/bootstrap/financial-chunk graph before running acceptance again.
10. One rebuild invocation omitted the required public `VITE_API_URL` and correctly failed the unchanged production configuration guard. The explicit-origin clean build exited 0; no fallback or guard modification was made. The final build also explicitly selects production mode rather than inheriting the API fixture's development NODE_ENV.

No test skip, lowered assertion, raised global timeout, security-budget increase, dependency update or CI bypass is used to declare success. Existing repository warnings (including ts-jest's deprecated `isolatedModules` setting and unrelated duplicate keys in a legacy test fixture) remain separate from actual test outcomes.

## Non-secret runtime and limits

| Property              | Executed local value                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime               | Node 24.21.0, pnpm 10.32.1, Prisma 6.12.0                                                                                                     |
| PostgreSQL            | 16.14, UTC, loopback 5533; new R33 data directory and `hsm_r33_reporting` database/role; integration helper creates separate random databases |
| Redis                 | 7.4.7, separate loopback 6433 instance, R33-only data/config, no shared flush                                                                 |
| Mailpit               | 1.32.0, task database, loopback SMTP 10333 / HTTP 8033                                                                                        |
| API / built SPA       | `http://127.0.0.1:4333` / `http://127.0.0.1:4433`; independent browser contexts/cookie jars                                                   |
| Browser               | Playwright 1.62.1, Chromium 151.0.7922.34, revision 1234, task-only cache                                                                     |
| Storage               | Separate R33 public/restricted/staging directories; local driver                                                                              |
| Authorization / money | Verification and work-access enforcement remain enabled; no seed grants/live rail; synthetic fixture grants only                              |
| Runtime fingerprint   | Canonical non-secret configuration and SHA-256 recorded in SOURCE_MANIFEST.json                                                               |

Local Chromium's environment CA issue was resolved through normal NSS verification. The existing public environment CA was imported into a new task-only NSS database selected by `XDG_DATA_HOME` in an external temporary Playwright config. No certificate-ignore option, shared home/profile edit, global trust change or repository CI override was used. Chromium's [certificate management documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/cert_management.md) and [NSS directory selection source](https://chromium.googlesource.com/chromium/src/crypto/+/refs/heads/main/nss_util.cc) document this path and trust mechanism. The tool/config/CA hashes and served-build proof are recorded in the source manifest.

Source and artifact fingerprints exclude JWT/cipher secrets, credentials, raw DSNs, cookies, OTPs, receipts, private user documents and raw environment files. No hosted test, vendor rail test, production resource or live-money operation is performed.

## Coordinator handoff

Accept the actual combined Wave 3 tree separately. Bind R30 receipt review and R31 My Plan routes only after their accepted integration; bind R32 refund commands with exact-amount/target confirmation, current command grants and unknown-outcome recovery. R34 must supply genuine run provenance and exercise not-run/failed/completed states and exception actions. Settlement persistence and currency scale/payout policy remain explicit separate decisions.

The read-only rollback in [ROLLBACK.md](ROLLBACK.md) removes navigation/module mounts before feature code and preserves all money history. This evidence alone cannot mark G3/G4, hosted, policy or release acceptance.

## PR #185 integration repair — 2026-10-23

The owner requested repairs to open PRs after owner-merged R30 #184
(`aaa22a9a04025fc312cbcc2121687aca2e467cac`). Integrate that develop commit
into the R33 branch, retaining both financial-operations and manual-payment
contracts, Admin links, routes and CI jobs. Resolve the coordinator-document
conflicts by preserving canonical G2 publication evidence from develop and the
R33 independent historical verification in `G2_PUBLICATION_VERIFICATION.json`.
Retain both source assignments; move expired R30 shared leases into complete
historical records. Gates, frozen source identity and operational restrictions
are unchanged.

The earlier R27 run 39941883418 passed all measurements but counted 11 SQL
statements against the unchanged portfolio ceiling of 9. Its process-wide query
collector also observed background mail retry work. The fixed measurement
environment now disables the existing MAIL_DISPATCHER_ENABLED worker in both
profiles, alongside its other disabled background workers. Regression coverage
checks ambient and override settings cannot re-enable it. This changes neither
production defaults nor request authentication, query budgets, OTP semantics or
real mail-worker acceptance tests. The complete GitHub performance run must
confirm the corrected measurement on this new source.

Executed on Node 24.21.0 / pnpm 10.32.1: offline frozen install, Prisma
generation, API lint/typecheck/build, web typecheck/production build, 23
money/AppModule suites (396 tests passed), nine financial-operations and Admin
route suites (72 tests passed), plus governance/performance harness tests
(588 passed). No failed or skipped tests in those selected suites. Vite retains
its existing chunk-size warning.

Local PostgreSQL/browser reruns are blocked by the host's single-UID runtime.
Mandatory GitHub real-service, browser, security and performance checks remain
required on the newly published merge head. Historical source verification
does not accept assembled Wave 3, business policy or live operations.

## Ordered PR #187 / #185 conflict repair — 2026-10-23

The owner merged R31 #186 into develop at
`c3c080cf28f142ed46495ec7e5d549937da90096` and requested correction of the
remaining PRs and their mutual conflicts. This repair combines R33 head
`57a988177f1d3a17e12f4bc1851713d3585487eb` with corrected R32 #187 head
`03e99da086cca4f4d7652062c331aee2f000775d` using a normal merge commit.
Merge #187 into develop first, then #185, using normal merge commits; the
second PR retains the first PR's exact source as a parent.

AppModule retains FinancialReportingModule, RefundsModule and the subscription
and refund outbox consumers. The registration regression checks that financial
reporting is mounted exactly once alongside money and subscriptions. The R32
correction preserves exactly one R31 activation participant and one R32 refund
policy evaluator. No unavailable commercial policy or refund consequence is
silently enabled.

Coordinator records retain the immutable G2 evidence and both R32/R33
publication verifications. R31 leases are completed against its actual owner
merge. R32 shared leases become historical handoff records naming the exact
R32 head, not a claim that #187 has already merged; R33 owns the subsequent
serialized integration. Duplicate JSON keys and status rows from the earlier
merge resolution are removed. G3, policy and hosted/live-release holds remain
separate from this source conflict repair.

Executed locally on Node 24.21.0 / pnpm 10.32.1: frozen offline installation,
Prisma generation, API lint/typecheck/build, web typecheck/production build,
37 money/AppModule suites (616 tests), nine financial/subscription suites
(90 tests), three route/guard suites (14 tests), and governance regressions
(480 tests). Final selected suites passed with zero failures or skips. The
canonical registry and G2 consistency validators, unique JSON-key audit and
whitespace checks passed.

The first local API invocation lacked the new worktree's generated Prisma
client and failed before application checks. Generation and dependency builds
restored the normal environment; the full selected API checks then passed.
The first local web build omitted VITE_API_URL and correctly failed its
unchanged production guard. Rebuilding with an explicit test API origin passed
with the existing chunk-size warning. Neither failure was suppressed.

Latest-head GitHub real-service, dedicated browser, security, performance and
CodeQL evidence must finish on the published merge head; results are recorded
in the current PR body. This single-UID local host cannot run unprivileged
PostgreSQL. Historical local evidence and previous-head green checks do not
certify this combined source. No merge to develop or deployment is performed.
