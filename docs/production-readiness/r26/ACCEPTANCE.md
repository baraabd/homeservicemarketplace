# R26 acceptance ledger

Status: INTEGRATION_PENDING / EXTERNAL_BLOCKED. Draft review only. No merge, deployment, hosted acceptance or release acceptance is authorized by this ledger.

## Source identity

- G1 frozen runtime: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- G1 complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- Published coordination base: `0568739096ceeaf0cfc79034626886e258fe4328`.
- Final published source: the exact PR `Final SHA` and R26 artifact `sourceSha`, verified against its current head. CI evidence for a previous head does not accept a successor.
- Contracts/schema/lockfile: unchanged from G1. No migration.

## Local execution

Pinned Node 24.21.0 / pnpm 10.32.1, independent worktree dependencies and generated Prisma client. No local PostgreSQL, Redis or Docker daemon available. Database skips in hermetic tests are not integration passes.

| Command                                                                                                               | Observed result                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                      | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/database generate`                                                             | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                 | PASS                                                                                                                                |
| `VITE_API_URL=http://127.0.0.1:4326 VITE_PROVIDER_ONBOARDING_V2=true pnpm --filter @homeservicemarketplace/web build` | PASS; existing large-chunk advisory retained                                                                                        |
| `pnpm --filter @homeservicemarketplace/web typecheck:e2e`                                                             | PASS                                                                                                                                |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs`                                              | PASS, 18 tests                                                                                                                      |
| `pnpm security:audit`                                                                                                 | PASS, current full dependency tree: 0 info/low/moderate/high/critical; not a GitHub alert inventory                                 |
| `pnpm --filter @homeservicemarketplace/api test --runInBand` with ephemeral fixture env                               | PASS, 258 suites / 4,559 tests; 89 database/service suites / 1,638 cases skipped locally and explicitly not credited as integration |
| `pnpm --filter @homeservicemarketplace/web typecheck`                                                                 | PASS                                                                                                                                |
| `pnpm --filter @homeservicemarketplace/web test --run`                                                                | PASS, 204 files / 2,475 tests                                                                                                       |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs .github/scripts/wave-gate.test.mjs`           | PASS, 43 tests                                                                                                                      |
| `node .github/scripts/sprint-registry.mjs`                                                                            | PASS; validates records, not sprint acceptance                                                                                      |
| Affected eslint                                                                                                       | PASS                                                                                                                                |
| Final API build, complete app lint, formatting and tree secret scan                                                   | Required before publication; final result recorded in PR                                                                            |

The parser regression was first run before remediation and failed on unsafe/generic boundary behavior. After the typed HttpException implementation, a development-only assertion expecting no redundant safe `details` object failed; the assertion now verifies the exact authored safe object, while production still requires omission. The first full API suite invocation lacked required fixture environment and aborted at config validation; rerun uses a generated ephemeral JWT secret and unused loopback database URL, never a user's environment.

## Required final-head evidence

1. Existing full CI, dependency/secret scans, official CodeQL security-result check (not only the workflow job), governance, auth lifecycle, startup and staging boundaries.
2. `R26 application security acceptance`: real PostgreSQL/Redis authorization plus R18 last-admin race, compiled API bounds/CORS, enforced CSP violations and real cookie/private PDF/gallery previews in Chromium.
3. Artifact `r26-security-<head>`: sanitized `boundaries.json`, `browser.json` and synthetic PDF/gallery screenshots. Count unrun/skipped scenarios explicitly. Raw Playwright traces are disabled because they contain session and private-media data.
4. Repository-wide current CodeQL/dependency/secret alert IDs, severity, affected ref and remediation/disposition, reconciled with the deployed source. **Missing; EXTERNAL_BLOCKED**, owner/security administrator. Available connector endpoints do not expose those alert inventories. A clean new scan is not an empty alert list.
5. Hosted source/build/image identity, approved CDN/upload origins, HTTPS edge and secure-cookie browser acceptance. **Missing; EXTERNAL_BLOCKED**, deployment owner. No deployment was attempted.

## Environment fingerprint, without secrets

Disposable hosted CI runner; Postgres 16, Redis 7, Mailpit v1.31.1; database `r26_security_ci`; ports 4326/5326; explicit loopback CORS; HttpOnly session cookies and CSRF enabled; verification/work-access enabled; existing scanner test driver forbidden in hardened runtimes; actual malware acceptance remains the retained ClamAV/storage CI. No production credential, real account, live rail or business-policy approval is implied.

## First published execution and correction

[PR #174](https://github.com/baraabd/homeservicemarketplace/pull/174), first head `b4163dc1362dd5d396eceb6a860cd6310639a203`, complete source tree `c4d7fb9ad4f52cc4c38a434911273801849bcb1e` exactly matched the locally hook-verified tree.

[R26 run 38981515893](https://github.com/baraabd/homeservicemarketplace/actions/runs/38981515893), job 117243218522: **9/9 real database tests passed**, including R18 last-active-admin race and all five R26 cases. Production SPA/API build and served-document/source binding passed. Browser: **1 passed, 1 failed, 0 skipped, 0 retries**. Private PDF/gallery rendering and independent-session identity/gallery/financial denials passed. CSP/script/connect/body/CORS assertions passed before the metrics assertion failed.

The failure exposed an acceptance configuration omission: the development API intentionally opens metrics when METRICS_TOKEN is absent. The successor sets a generated masked ephemeral token, asserts exact 404 for missing/wrong credentials and 200/no-store for the correct token. The guard and assertion are not relaxed. A local CSP insertion regression also ensures JavaScript replacement tokens in policy text cannot be interpreted as HTML replacement templates.

Artifact 12081093519 (`r26-security-b4163dc1362dd5d396eceb6a860cd6310639a203`), SHA-256 `224acdf41406bb2389bcf4942ce1a570404a8890b5b664a9e065087a7fcd0679`, was downloaded and inspected. `synthetic-pdf.png` shows the one-page blue rectangle rendered by the actual PDF canvas; `synthetic-gallery.png` shows the intentionally black fixture image in the private review dialog. These are synthetic test bytes, not identity documents. They establish the first-head preview result only; successor acceptance requires new final-head evidence.

The first secret scan flagged the fixed synthetic parser sentinel. The test now generates an ephemeral UUID, still asserting the response cannot echo it; the full-tree scan passes without adding an allowlist or disabling a rule.

## CodeQL result triage and second execution

Source `3b459fbef4ef462c14c1d2dff2106eb61fcd6db8`, tree `d18d177a66b09beb48d8b240407c39d923a6c34e`: [R26 run 38981943357](https://github.com/baraabd/homeservicemarketplace/actions/runs/38981943357), job 117244578167, **9 database tests and 2 browser scenarios passed**, zero browser skips/retries. Artifact 12081119255 has SHA-256 `80ae183779fdebdc8400f88fdafd158692dceed03c560dcde92674a3deb6f2ce` and binds the production bundle to that exact source. This technical pass does not override CodeQL.

CodeQL workflow 38981943362 completed its analysis, but official security-result check 117245724087 **failed with five new findings**. SARIF artifact 12081109533 (SHA-256 `63772b7c24c361c48a3a85c32b26a966f94bd8d4ce4f4d6e0c9dfbe55edca26e`) was downloaded and all five findings inspected. The complete source analysis contained these five results; it is not an inventory of historical/open alerts across all repository refs. GitHub alert numbers are unavailable through the connector, so rule IDs and exact locations identify these findings without inventing IDs.

| Finding identifier                                         | Severity / location at that head                | Disposition in successor                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/type-confusion-through-parameter-tampering`            | Critical 9.8; `request-body.spec.ts:13`         | Test HTTP echo read `.length` from a request body after Buffer validation. Explicit unknown narrowing and Buffer.byteLength make the byte-only contract unambiguous. No production guard removed.                                                |
| `js/incomplete-url-substring-sanitization` (three results) | High 7.8; `verify-boundaries.test.cjs:24,25,27` | These were array membership assertions on parsed CSP tokens, not substring origin authorization. Use explicit Set membership so exact token equality is evident to the analyzer and reader. Production exactOrigin validation remains unchanged. |
| `js/http-to-file-access`                                   | Medium 6.3; `verify-boundaries.cjs:61–78`       | The artifact persisted HTTP response status after asserting 200. Persist the fixed-schema 200 result only after the equality assertion; no remote-supplied value is written. The real health check still must pass.                              |

No finding was dismissed, query suppressed, scan excluded or severity relabeled. Successor official CodeQL security-result check must pass with zero annotations before technical acceptance; a successful analysis workflow alone is insufficient. Final current-head evidence is recorded in the PR metadata and its source-bound artifacts to avoid a self-referential commit identity.

## Concurrent owner publication reconciliation

The owner merged [PR #172](https://github.com/baraabd/homeservicemarketplace/pull/172), moving develop to `07c8e584c684111bfc80995c7efb0144cfb6161b` during this work. R26 head `8ac646bc876c8df3972d33eb0ff47519ac71aa90` had no workflow runs because its shared governance records conflicted with that new base. This is recorded as **not run**, not a test pass.

The branch integrates the merged records using a normal merge with both parents, preserving all-lane readiness and publication-verification records from #172 plus the existing R26 exact ownership and PR. All differences in #172 are governance documents; runtime/package/CI directories and lockfile are byte-identical to the prior base. R27 PR #173 was inspected for path overlap but not imported. Final PR metadata names the new current base and head; all current-head checks must rerun.

## Verified CodeQL resolution and startup-fixture correction

At integrated head `7ad12eb539fbd60fbb9772859f8550da4f188d65` (tree `402cbee0a22935c002d0034a28e59c6246fc1cba`), official GitHub Advanced Security check **117248731515 passed with zero annotations**. CodeQL run 38983039274 and SARIF artifact 12082171626 were inspected; the entire SARIF has **0 results**. Artifact SHA-256: `f27a55db200ea834b5794b40a1484fd6cf6bb77345d2e0c819c02c55c8496e32`. All five earlier findings are resolved in this analysis without suppression; historical/all-ref repository alert inventory remains separate.

R26 run **38983039259 passed** on that head. Artifact 12081398336, SHA-256 `943d22d80421be29eefae2baf54ace9a6939300b6faac408d5df39a668a33c38`, was downloaded, digest-checked and its source identity/results inspected: both browser scenarios passed, 0 skipped/flaky/retries. Synthetic PDF/gallery screenshots were inspected again. All nine real database cases passed.

The shared Web development startup run 38983039166 then exposed an incomplete isolated fixture (Linux job 117248071720): 5 tests failed because its copied Vite config could not resolve the new root CSP helper; 1 passed. This is an R26 integration regression, not an accepted green run. The exact startup fixture lease now copies `scripts/production/security-app/web-csp.cjs` into that disposable workspace. No test, assertion, strict filesystem control, process isolation, worker count or timeout changes. Local `pnpm --filter @homeservicemarketplace/web exec playwright test --config playwright.startup.config.ts --grep 'commands pin the source config'` passes (1 test); E2E typecheck and registry validation pass. Full Linux/Windows browser startup and all final-head CI still must rerun.

## Successor reproduction and source verification — 2026-10-17

Resumed branch: `feat/r26-application-security`, existing Draft PR #174.
Starting head: `ab089d14ec7141977db083e55b6165e493c2bb04`; complete tree:
`b782941413e1ce9ef03157a79dd7b972b3642a3e`. Frozen G1 runtime source remains
`40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; current integration base remains
`07c8e584c684111bfc80995c7efb0144cfb6161b`. Final commit/tree and final-head
workflow/artifact identities are recorded in the PR after publication, so this
source document never claims to contain its own commit identity.

The starting head had 28 successful checks and five failures. Official CodeQL
check 117250564920 had zero annotations and R26 job 117249872915 passed, but
those successes did not override these independently reproduced failures:

- Browser job 117251281997, run 38983608704: **830 passed, six failed,
  349 skipped**. Genuine PNG finalization and rotated-image re-upload failed
  in all three Chromium projects. All six traces showed the fixed fixture
  upload origin blocked by the enforced policy for the built API origin.
- Phase 5 job 117252187006, same run: R06 **one passed, one failed**. Its trace
  showed `localhost:4010` upload blocked by the exact `127.0.0.1:4010` policy.
  Later required journeys and aggregate acceptance therefore were incomplete.
- Governance job 117249871840, run 38983608660: the PR description's Final SHA
  still named `7ad12eb539fbd60fbb9772859f8550da4f188d65`. Synchronize metadata
  only after publishing the successor commit; retain the exact-head check.

Independent source review reproduced R26-CONFIG-02 before correcting it:
the extended CSP policy suite had **19 passing and 11 failing cases** against
the original implementation. Checking raw and canonical origins makes all
30 pass without granting additional sources. The corresponding CORS cases
preserve exact-origin semantics and safe errors.

### Local commands and results for the successor

Node **24.21.0** and pnpm **10.32.1** were installed into an isolated temporary
toolchain and selected for each command; no machine-wide version, package pin
or lockfile changed. Prisma remains **6.12.0**. Every executed command's exit
status was checked.

| Executed command                                                                                                                                                                                                                                                  | Result                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --store-dir /tmp/hsm-r26-store`                                                                                                                                                                                                   | PASS; 1,166 locked packages, exact toolchain preinstall and normal Husky preparation passed.                                  |
| `pnpm --filter @homeservicemarketplace/database generate`                                                                                                                                                                                                         | PASS; existing schema, guarded completion record and separate native-engine load verified.                                    |
| `node --test scripts/production/security-app/verify-boundaries.test.cjs`                                                                                                                                                                                          | PASS, 30 cases, zero failures/skips.                                                                                          |
| `pnpm --filter @homeservicemarketplace/api exec jest src/infrastructure/http/cors-policy.spec.ts src/infrastructure/http/request-body.spec.ts src/infrastructure/http/security-headers.spec.ts src/infrastructure/http/all-exceptions.filter.spec.ts --runInBand` | PASS, four suites and 100 cases, zero failures/skips.                                                                         |
| `node --test .github/scripts/*.test.mjs`                                                                                                                                                                                                                          | PASS, 160 cases, zero failures/skips, including exact ownership and unchanged fail-closed gates.                              |
| `node .github/scripts/sprint-registry.mjs`                                                                                                                                                                                                                        | PASS; record consistency, not sprint acceptance.                                                                              |
| `VITE_API_URL=https://api.example.com pnpm --filter @homeservicemarketplace/web build`                                                                                                                                                                            | PASS; production CSP precedes script/resource loading and retains exact API/WS origins. Existing large-chunk warning remains. |
| `pnpm --filter @homeservicemarketplace/web typecheck:e2e`                                                                                                                                                                                                         | PASS.                                                                                                                         |
| `pnpm --filter @homeservicemarketplace/api typecheck`                                                                                                                                                                                                             | PASS, including database/contracts dependency builds.                                                                         |
| `pnpm --filter @homeservicemarketplace/api build`                                                                                                                                                                                                                 | PASS, including the compiled Nest application and workspace dependency builds.                                                |
| `pnpm --filter @homeservicemarketplace/api exec eslint src/infrastructure/http/cors-policy.ts src/infrastructure/http/cors-policy.spec.ts`                                                                                                                        | PASS, zero errors/warnings.                                                                                                   |
| `pnpm --filter @homeservicemarketplace/web lint`                                                                                                                                                                                                                  | PASS, zero errors, 34 existing warnings.                                                                                      |
| `pnpm security:audit --output /tmp/hsm-r26-audit-full.json`                                                                                                                                                                                                       | PASS, zero findings at every severity; no ignored/muted advisories.                                                           |
| `git diff --check`                                                                                                                                                                                                                                                | PASS.                                                                                                                         |

Initial sandbox-only subprocess attempts for governance and Prisma failed;
governance's negative shell tests reported `EPERM`. The same commands passed
with the authorized subprocess permission. The failed generation left an
empty lock directory in this new checkout; after both attempts exited and a
process check found no active generator, only that empty directory was removed
and the normal guarded generation passed. No generation guard or source was
changed. The first lint permission review timed out before execution; its
permitted single retry passed. Install retained the repository's ignored
build-script policy for `@parcel/watcher` and `unrs-resolver`; existing ts-jest
configuration deprecation warnings remain.

Local `pnpm --filter @homeservicemarketplace/web exec playwright install
chromium` failed: the pinned official Chromium download returned HTTP 200
with a 195-byte `text/html` **Site Unavailable** page instead of the archive.
No alternate browser/version, disabled CSP, or successful browser result is
substituted. Local browser and real PostgreSQL/Redis/container acceptance are
not credited. The unchanged full CI, real Phase 5 journeys, R26 acceptance,
secret/container scans and official CodeQL result must validate the final
published head. The PR records their actual results and source-bound artifacts.

Current repository-wide alert inventories/dispositions, deployed-source
reconciliation, hosted HTTPS acceptance and R24/G2 money-interface integration
remain separately blocked as documented above; this continuation does not
waive them. Synthetic failed traces were inspected only in temporary scratch
storage and are not committed or republished.
