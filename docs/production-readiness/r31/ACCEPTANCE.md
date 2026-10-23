# R31 acceptance evidence

## State and provenance

R31 implementation and local validation are complete at this pre-publication
checkpoint. This record reports executed commands. The PR metadata and
source-bound CI artifacts report the later committed-tree and final-head
results; they must be inspected for the current SHA. G3 collection evidence
remains a separate gate.

| Identity                               | Value                                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprint / branch                        | R31 / `feat/r31-subscription-entitlements`                                                                                                        |
| Session                                | `r31-20261023-d799cbee`                                                                                                                           |
| Actual branch-start / G2 frozen source | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                                                                                                        |
| Frozen source tree                     | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                                                                                                        |
| Verified G2 publication                | PR #183, merge `986b4707776711e80564f0642133ede90ba16f3c`                                                                                         |
| Contract / schema                      | `hsm.money.v1`; existing 72 migrations, no schema change                                                                                          |
| Runtime pins                           | Node 24.21.0, pnpm 10.32.1, Prisma 6.12.0                                                                                                         |
| Final SHA / tree                       | Authoritative full hashes belong to PR metadata and final-head provenance artifacts; this source document cannot embed its own future commit hash |

The owner-merged G2 checks were independently inspected before lane release.
They authorize the baseline only. The R31 checks below evaluate changed source.

## Executed local checks

Commands use the pinned task-local Node/pnpm on `PATH`. Package commands run
from the repository root unless a different working directory is stated.

| Command                                                                                             | Observed result                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                    | PASS; six workspace packages, 1166 locked packages; no manifest/lockfile rewrite                                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/database generate`                                           | PASS; Prisma 6.12.0 client                                                                                                                                                                                                      |
| `pnpm --filter @homeservicemarketplace/database prisma:validate`                                    | PASS                                                                                                                                                                                                                            |
| `pnpm --filter @homeservicemarketplace/database migrate:deploy`                                     | PASS; all 72 migrations applied to the task's disposable database                                                                                                                                                               |
| `pnpm --filter @homeservicemarketplace/database build`                                              | PASS                                                                                                                                                                                                                            |
| `pnpm --filter @homeservicemarketplace/contracts build`                                             | PASS including additive subscription read DTOs                                                                                                                                                                                  |
| `node .github/scripts/g2-record.mjs --ready R31`                                                    | PASS after verified publication and exact assignment                                                                                                                                                                            |
| `node --test .github/scripts/*.test.mjs`                                                            | PASS; 480 tests, zero failures/skips/cancellations                                                                                                                                                                              |
| `node --test .github/scripts/merge-integrity.test.mjs`                                              | PASS; 17 tests, all existing negative composition cases retained                                                                                                                                                                |
| `pnpm security:audit`                                                                               | PASS; info/low/moderate/high/critical all zero                                                                                                                                                                                  |
| `pnpm security:audit:prod`                                                                          | PASS; info/low/moderate/high/critical all zero                                                                                                                                                                                  |
| `node --test scripts/security/dependency-audit.test.cjs scripts/security/secret-scan-tree.test.cjs` | PASS; 46 tests, zero failures/skips                                                                                                                                                                                             |
| Web scoped Vitest for `src/app/features/subscriptions/`                                             | PASS; 3 files, 33 tests                                                                                                                                                                                                         |
| Web scoped ESLint for the eight R31 feature/browser files                                           | PASS; zero warnings/errors                                                                                                                                                                                                      |
| `pnpm run lint` in `apps/web`                                                                       | PASS; zero errors, 34 warnings outside R31 feature/browser files                                                                                                                                                                |
| `pnpm run typecheck` in `apps/web`                                                                  | PASS                                                                                                                                                                                                                            |
| `pnpm run typecheck:e2e` in `apps/web`                                                              | PASS                                                                                                                                                                                                                            |
| `pnpm run test:ci` in `apps/web`                                                                    | PASS; 208 files, 2558 tests, zero failures/skips                                                                                                                                                                                |
| API R31 unit suites (`jest --runInBand` for subscriptions and entitlements)                         | PASS; 8 suites, 63 tests; includes explicit failed-attempt projection                                                                                                                                                           |
| API R19/R24/R31 PostgreSQL/Redis integration suites (`jest --runInBand --runTestsByPath`)           | PASS; 3 suites, 92 tests; zero failures/skips; R31 accounts for 17                                                                                                                                                              |
| `pnpm --filter @homeservicemarketplace/api exec tsc --noEmit`                                       | PASS on final backend source                                                                                                                                                                                                    |
| `pnpm --filter @homeservicemarketplace/api build`                                                   | PASS; database/contracts dependencies and Nest build                                                                                                                                                                            |
| `pnpm --filter @homeservicemarketplace/api lint`                                                    | PASS; zero errors/warnings                                                                                                                                                                                                      |
| Full API Jest unit gate with `--maxWorkers=2 --json`                                                | PASS; 275 passed suites / 4950 passed tests, zero failures; 94 suites / 1796 service-gated tests pending in unit mode, separately enabled in CI; precedes the final two new projection unit cases, which pass in the scoped run |
| Real browser/production bundle and inspected screenshot matrix                                      | PASS; diagnostic run04: 4/4 journeys, 20/20 images, 8/8 commands; visual review below                                                                                                                                           |
| Final committed tracked-tree secret scan                                                            | Publication gate: exact staged candidate and adopted committed tree; final source-bound result is recorded in the PR                                                                                                            |
| Required PR CI and official CodeQL result                                                           | Publication gate: exact final PR head, all required workflow jobs and official security result; live run/artifact IDs are recorded in the PR                                                                                    |

## Exact feature and real-regression commands

```sh
pnpm --filter @homeservicemarketplace/api exec jest --runInBand src/modules/money/subscriptions src/modules/money/entitlements
pnpm --filter @homeservicemarketplace/api exec jest --runInBand --runTestsByPath test/integration/r19-subscription-money.integration.spec.ts test/integration/r24-money-api.integration.spec.ts test/integration/r31-subscription-entitlements.integration.spec.ts
pnpm --filter @homeservicemarketplace/api test --maxWorkers=2 --json --outputFile=<private-evidence>/api-unit.json
pnpm --filter @homeservicemarketplace/web test:ci
```

Real integration commands load only the private task-owned runtime configuration
with `RUN_DB_INTEGRATION=1 RUN_REDIS_INTEGRATION=1 NODE_ENV=test APP_ENV=test`.
The full API unit command intentionally omits service opt-ins. Its 1796 pending
service tests are not counted as passing. The dedicated real run executes
R19's 19, R24's 56 and R31's 17 cases: **92 passed**. R31 additionally has
63 passing unit cases, for **80 feature cases** across those two modes.

| Required boundary             | Executed real evidence                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atomic confirmation           | Concurrent identical commands and distinct events create one confirmation/posting/period; a real R31 invalid-snapshot failure rolls back confirmation, ledger, period, coupon, audit and receipts |
| Quota and coupon races        | Six distinct operations compete for two usage slots; four identical keys create one row; global and per-provider coupon caps hold under concurrent confirmations                                  |
| Ownership and immutable terms | Cross-payer/plan bindings and foreign cursors are denied; permission revocation is honored; bought versions cannot be repriced/rebound after a newer catalog version                              |
| Period boundaries             | No paid capability before confirmed start or at the exact end; stale expiry preserves a confirmed renewal; cumulative usage is not reset                                                          |
| Named policy effects          | Cancellation/refund-effect rollback and receipt replay are tested under explicit test policies; stale decisions do not modify renewed periods; confirmed refunded history can still expire        |
| Durable notifications         | Caller rollback leaves no reminder; concurrent delivery produces one notification and one notification-created event                                                                              |
| Failed collection             | Failed/cancelled collection creates no paid period or coupon redemption; a later failed attempt preserves a previously confirmed active subscription                                              |

Grace extension, live prices, real collection adapters and production policy
are not inferred from those test policies or fixtures.

## Real-service environment and evidence boundary

Local PostgreSQL 16.15 and Redis 7.0.15 run on dedicated loopback ports 5531 and 6431. The task owns the unprivileged database server, disposable administrator
and databases; credentials are kept outside Git in private files. The browser
fixture uses its own independently created database and API/web ports 4331/4431,
with separate browser contexts and no shared user environment file. No real
account, production permission, hosted storage or live collection is used.

The fixture uses real AppModule, migrations, authentication and OTP verification,
R24 commands, R19 ledger/confirmation/period persistence, R31 participant and
usage, and actual browser HTTP calls. Collection/configuration components are
explicitly synthetic contract fixtures. They establish the component transaction
and UI behavior, not R29 Stripe or R30 protected manual collection acceptance.

The required CI job runs
`node scripts/production/subscriptions/verify-my-plan.cjs --output "$RUNNER_TEMP/r31-browser"`
with `RUN_DB_INTEGRATION=1 NODE_ENV=test APP_ENV=test` and explicit disposable
loopback service variables. The launcher requires clean committed source by
default and rejects source drift, skipped/flaky journeys and stale output.
Only `summary.json` and twenty sanitized screenshots are uploaded. Output lives
outside the checkout so generated evidence cannot alter the source fingerprint.

The nonsecret local configuration fingerprint is SHA256 of the following
UTF-8 JSON with sorted keys and no whitespace, excluding credentials and
private paths:

```json
{
  "APP_ENV": "test",
  "NODE_ENV": "test",
  "RUN_DB_INTEGRATION": "1",
  "RUN_REDIS_INTEGRATION": "1",
  "apiPort": 4331,
  "chromium": "151.0.7922.34",
  "collectionAndConfiguration": "SYNTHETIC_CONTRACT_COMPONENTS",
  "node": "24.21.0",
  "pnpm": "10.32.1",
  "postgres": "16.15",
  "postgresPort": 5531,
  "prisma": "6.12.0",
  "productionAcceptance": false,
  "railAcceptance": false,
  "redis": "7.0.15",
  "redisPort": 6431,
  "webPort": 4431
}
```

SHA256: `3f3460c5a208f98ca453ef65af7c815db84e8c3f0f2654c465ad93cfe12afdde`. CI records its own source and runtime identity;
this local fingerprint does not claim a hosted configuration.

## Browser and visual matrix

The dedicated suite requires four named real-API journeys: bilingual viewport/
keyboard/accessibility; refresh/reload/offline/reconnect and cross-owner denial;
pending/failed/expired/cancelled/action-required states and ungranted access;
fresh-context login preserving purchased terms and usage.

The core twelve screenshots are Arabic and English at 320, 390, 430, 768,
1024 and 1440 CSS pixels. Eight additional 390-pixel screenshots cover both
languages in dark mode and pending, failed, expired, cancelled, action-required
and permission-denied states. CSS 200% zoom is a separate reflow check, not
native browser zoom. Whole-page axe checks supplement keyboard and visual
review; they do not constitute a complete manual accessibility certification.
Screenshot generation alone is not visual acceptance; actual inspection
results are recorded after the run.

### Executed diagnostic run and visual inspection

Run identifier: `r31-browser-dev-04`, 2026-10-23T05:31:19.405Z to
2026-10-23T05:32:30.261Z. Exit 0; **8/8 commands, 4/4 journeys and 20/20
screenshots**, zero failures, skipped cases, flakes or retries. Source remained
unchanged during the run. Working-source SHA256:
`091eac862d37c4a9d9794ed1cda974065be21437bb8f11559db2f1dfdd27e0e2`.
This pre-commit run used explicit `--development` and is labeled
`DEVELOPMENT_ONLY`; it is not substituted for clean final-head acceptance.
Its two confirmations, two periods, two ledger postings and two usage events
were persisted by real services; provider work-access grants remained zero.
Owned processes, fixture database and private credential files were cleaned.

Actual visual inspection covered all twenty images: six English and six Arabic
widths, both 390-pixel dark themes and all six state images. The corrected Arabic
usage reads `2 / 5`, including at 320 pixels. The failed payment image explains
the failed latest attempt while retaining the underlying pending intent update.
The desktop grid and mobile stack have no overlapping cards or horizontal page
clipping; controls and text remain readable. The denied image contains no plan
or catalog data. Root additionally inspected Arabic 320/dark390, English1440
and the failed390 capture. Screenshot names and SHA256 values are in each
run's `summary.json` and the required CI artifact.

The final clean invocation omits `--development` and must report
`R31_BROWSER_ACCEPTED`, identical start/end commit and tree, `dirty:false`,
`changedPaths:0`, `sourceStable:true`, the exact 4/20 matrix and complete owned
cleanup. Those source-bound results and artifact identities belong in the PR,
so an evidence-only source commit cannot invalidate its own recorded hash.

## Failures and warnings encountered

- The first published head `2ce7dcece60151f30390ee1adcaadcb43a90e066`
  passed the CodeQL Actions analysis but its separate official security result
  failed on two `js/file-system-race` findings (CWE-367). They identified
  path-stat/read races in private credential reads and working-source hashing.
  Corrective descriptor-bound reads keep checks and bytes on the same opened
  file, reject unsafe file types and close handles on all paths. Security
  rules and the final-head official-result requirement remain unchanged.
  Earlier head acceptance artifacts remain historical; the current PR head
  must supply its own complete browser and CodeQL evidence.
  Isolated checks exercise the actual extracted functions: 12/12 credential
  cases and 9/9 source-fingerprint cases pass, with zero failures or skips.
  They cover path replacement, symlinks, directories, no-writer FIFOs, private
  permissions and handle closure on success and errors. Scoped ESLint,
  Prettier, launcher syntax and the full E2E TypeScript check also pass.
- The first complete staged-tree Gitleaks scan read 24,058,490 bytes and
  rejected a literal synthetic plan name in the browser fixture under its
  generic API-key heuristic. Inspection confirmed public test metadata, not
  a credential. The fixture uses the shorter descriptive name `r31-test-plan`;
  all scanner rules and thresholds remain intact. The exact candidate is
  rescanned before publication and the committed browser matrix reruns with
  that name. Run04's earlier screenshot label is therefore diagnostic only.
- The first dependency command selected the host Node rather than the exact
  downloaded executable and failed the repository's preinstall check. Executable
  permissions and the task-local `PATH` were corrected; the frozen install
  subsequently passed. No runtime pin or lockfile was changed.
- Default sandbox restrictions blocked subprocess/network-dependent checks.
  The same commands were run with permitted execution access; no test or hook
  was bypassed.
- Adding the real participant made Prettier wrap the MoneyModule imports. A
  negative test used an obsolete one-line fixture string and failed. Its exact
  shared lease was recorded, fixture mutation made whitespace-robust and
  all 17 composition tests passed; the production fence is unchanged.
- Web tests retain existing React warnings. The full local web run also reported
  a sandbox HMR-listen `EPERM` in `contracts-browser-resolution.test`; its two
  assertions and the initial 2555-test run passed. The final full run passed
  2558 tests after the three explicit payment-attempt cases were added. This is not a console-zero claim.
- Dependency install reported ignored build scripts for `@parcel/watcher` and
  `unrs-resolver`. The repository approval policy was not bypassed.
- The Playwright CDN returned an HTML outage response for the pinned Chromium
  archive. The exact same Chrome for Testing build is obtained from Google's
  official versioned archive and validated locally; no browser version or
  package pin is changed. The pinned Chromium 151.0.7922.34 launched and
  passed the real-route matrix; source-bound final results are recorded above.
- Concurrent local full-API and browser builds exhausted the task's 8 GB
  memory allocation. The owned API invocation was interrupted (exit 130) and
  was not credited as a pass. Serial rerun with two Jest workers passed;
  no assertion, timeout, security budget or concurrency race case was relaxed.
- The first real-service attempts exposed a stopped task-owned Redis process,
  a deliberately malformed plan fixture left visible to a later catalog test,
  and a refund fixture missing R19's canonical external reference. The runtime
  and fixtures were corrected. A real lifecycle defect was also corrected:
  refunded confirmed history still permits expiry at its original end while
  remaining ineligible for paid use or reminders. All 92 regressions passed.
- Actual browser checks found transient dark-mode contrast during shared
  component color transitions. Feature-local transitions were removed without
  changing shared tokens or waiving axe checks. Visual review then found a
  reversed Arabic used/limit ratio and ambiguous failed-attempt wording. Bidi
  isolation and the explicit persisted attempt projection correct those cases;
  scoped regressions and the final matrix verify the behavior.

## Acceptance decisions that remain separate

`IMPLEMENTED` and `SOURCE_VERIFIED` require the completed local/final-head gates.
`INTEGRATION_PENDING` remains until the G3 coordinator demonstrates actual R29
sandbox and R30 manual confirmation against the combined source. Unapproved
commerce/lifecycle policy remains `POLICY_BLOCKED`; credentials, hosted runtime
and release evidence remain externally owned. This PR stays Draft while those
required integration results are absent. No `HOSTED_ACCEPTED`,
`RELEASE_ACCEPTED`, merge, deployment or live-money claim is made.
