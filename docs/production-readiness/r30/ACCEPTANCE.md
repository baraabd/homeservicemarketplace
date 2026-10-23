# R30 — candidate acceptance evidence

## Current disposition

**IMPLEMENTED / SOURCE_VERIFIED.** The final local R30 source passes its real
sandbox service and browser checks. Final-head remote CI/CodeQL, hook identity,
tracked-tree secret scan and publication are recorded in the English draft PR.
This is source and sandbox evidence with explicit R31/R32 contract components;
actual integrated R31/R32, hosted and live-policy acceptance remain pending.
No unrun, skipped or earlier-source check is relabelled as a final-head pass.

## Source authority

| Identity                                         | Value                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Frozen G2 runtime source                         | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                             |
| Frozen G2 runtime tree                           | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                             |
| Owner-merged publication / actual checkout start | `986b4707776711e80564f0642133ede90ba16f3c`                             |
| Publication tree                                 | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                             |
| Branch / session                                 | `feat/r30-manual-payment-review` / `hsm-r30-590834e66da5`              |
| Final commit / source tree                       | Recorded externally in the draft PR after normal hooks and publication |

G2 publication was independently verified before implementation. Its green
checks establish that prerequisite source only. Current R30 checks below do
not relabel historical preparation results; the earlier manifest is preserved
under `historicalPreparation` in `SOURCE_MANIFEST.json`.

## Completed checks and scope

| Check                                       | Executed result                                                     | Scope                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Frozen install and guarded generation       | PASS, exit 0                                                        | Exact Node 24.21.0 / pnpm 10.32.1 / Prisma 6.12.0; lockfile unchanged                                                              |
| Full web hermetic suite                     | 2,579 passed, 0 failed, 0 skipped                                   | Initial implemented runtime; later corrections have scoped reruns                                                                  |
| Full API default suite                      | 4,928 passed, 0 failed, 1,794 service-gated skips                   | 272 passing suites / 95 gated suites; skipped cases are not passes                                                                 |
| Governance suite                            | 480 passed, 0 failed, 0 skipped; exit 0                             | Final current-record/negative-fixture suite; canonical G2/readiness/registry/baseline commands also pass                           |
| Full dependency audit                       | PASS, exit 0; 0 vulnerabilities at all severities                   | Pinned full dependency graph                                                                                                       |
| Production dependency audit                 | PASS, exit 0; 0 vulnerabilities at all severities                   | Pinned production graph                                                                                                            |
| Final real-service suite                    | 16 passed, 0 failed, 0 skipped; exit 0                              | Real HTTP/auth, PostgreSQL, Redis, private storage and ClamAV; includes concurrent worker failure injection over actual PostgreSQL |
| Final shared/API/private HTTP boundaries    | 15 suites, 219 passed, 0 failed, 0 skipped; exit 0                  | Includes 9 R30 unit suites / 57 tests; subset, not additive                                                                        |
| Final frontend feature suite                | 6 files, 54 passed, 0 failed, 0 skipped                             | Includes actual settlement `201 {id}` contract followed by authoritative detail GET                                                |
| Frontend lint / TypeScript / E2E TypeScript | PASS                                                                | Scoped feature/browser lint; web tsc-b and E2E typecheck                                                                           |
| Complete R30 real browser                   | 2 scenarios passed; 0 unexpected/skipped/flaky; harness 1/1; exit 0 | Actual HTTP, bytes, scan, replacement, inspection, settlement, approval, session cleanup and durable database assertions           |
| Final publication CI and official CodeQL    | PENDING CORRECTED FINAL HEAD                                        | The first published head had one official security finding; final results belong to the exact successor head in PR184              |

Current root/agent JSON report digests and final scoped outcomes are maintained
in the manifest. Full default API service gates remain enabled only in their
own required jobs. The dedicated R30 job requires every R30 case to execute,
with zero skips, retries or flaky results.

## Final browser and regression evidence

The final Playwright run started `2026-10-23T05:44:29.243Z` and completed both
scenarios in 27.296 seconds with no retries. The parent Jest harness also
passed, independently verifying exactly one R24 confirmation, one settlement
claim, two immutable receipt versions and one approved decision in PostgreSQL.

Both provider and reviewer surfaces passed 12 responsive/Axe combinations:
English and Arabic RTL at 320, 390, 430, 768, 1024 and 1440 pixels. All 24 scoped
Axe checks reported zero violations. Both languages also passed explicit CSS
200% content enlargement and stacked review-column assertions. These checks
are not a general accessibility certification or browser-toolbar zoom claim.

The visual inspection used the same final UI source in the immediately prior
05:37:16Z run; subsequent hook formatting affected only two backend files.
Directly inspected captures: `review-en-200pct-content.png`,
`review-ar-200pct-content.png`, `review-ar-320.png`, `review-ar-1440.png`,
`provider-ar-320.png`, `provider-en-1440.png`, and `review-current-pdf.png`.
Use the matrix captures for clean layout documentation: the long PDF capture
contains fixed admin chrome at the scroll position. Actual PDF rendering,
keyboard dialog focus/escape/confirmation, outsider denial and session byte
revocation were exercised by the completed browser scenario.

Before the first publication, normal commit hooks formatted method-chain layout in two backend files. The
213 scoped API/shared cases, 16 real-service cases and both complete browser
scenarios were repeated successfully after hooks. Source digests now describe
those committed bytes. After the first remote CodeQL finding, the three-file
refund authorization correction passed 219 scoped API/shared cases across
15 suites and all 16 real-service cases, including fresh revoked-dispatcher
checks. The six new refund cases are included in the 219 total. API build,
TypeScript and corrected-file lint are verified again; final normal-hook
source equality and official CodeQL belong to the successor publication.
All 38 root-shared TypeScript/JavaScript paths pass scoped ESLint. Final
frontend feature tests pass 54 cases; web and E2E TypeScript and scoped lint
pass. The final production web build uses CI's non-live API URL. Dependency
audits report zero vulnerabilities across all severities. The full default
suite counts above predate the final scoped corrections; final-head CI supplies
the complete regression result for publication.

## Real services and explicit components

The task-owned services are PostgreSQL 16.15, authenticated Redis 7.4.7, private
restricted local disk and ClamAV 1.5.3 using official daily 28161/main 63/
bytecode 339 signatures. Configuration fingerprint:
`0ada271fa8805e7cd384d7f691a2935b7c0a83e54842811ea2e39e0999c7147c`.
The database role remains non-superuser; its scoped CREATEDB permits only the
repository's disposable database helper within this cluster. It is not a
production-role recommendation. Each integration fixture deploys current
migrations into its own fresh database.

Receipts, amounts, merchant instructions and settlements are synthetic SANDBOX
fixtures. Real boundaries include OTP sessions/cookies, CSRF, fresh RBAC,
HTTP/binary payloads, PostgreSQL constraints/rollback, Redis Lua, actual stored
bytes/hashes and ClamAV clean/EICAR results. Only R31 activation and R32 refund
eligibility are labelled transaction contract components. No production R32
confirmation participant or real external money transfer is claimed.

Pinned Playwright 1.62.1 uses Chromium 151.0.7922.34 revision 1234. After a failed
fresh CDN download, matching local binary distributions were copied; all 591
file hashes, engine version and launch were verified. This provenance is
`LOCAL_MATCHING_DISTRIBUTION_COPY`, not fresh authenticated download evidence.
CI installs its own pinned browser. Session manifests are private 0600 files,
removed by the harness; no profiles/cookies/traces are public evidence.

## Observed failures and corrections

- The first published R30 head `38307f0e3262a04319b2c79f39dae031cdbe0bb8`
  completed the CodeQL analysis workflow, but its separate official security
  check `120376196775` correctly failed with one high-severity
  `js/user-controlled-bypass` finding. Dispatcher reauthorization in refund
  review depended on the request's event-type branch. The successor moves that
  check onto the common transaction path using the persisted dispatcher, or
  the authorized current actor for first dispatch. Regression checks cover
  revoked dispatcher authority for all three event types, retained UNKNOWN
  state, no new evidence on rejection, restored authority and idempotent replay.
  No query, gate or severity threshold is suppressed. The successor's official
  CodeQL result must independently pass before technical publication acceptance.
- Initial service fixture lacked CREATEDB; only the disposable test-cluster
  role was corrected. No application or shared database grant changed.
- An EICAR string in a PDF comment did not trigger real ClamAV. The fixture was
  corrected to an actual embedded EICAR file; the real quarantine assertion
  stayed required. No mock scan was substituted.
- A manual event incorrectly supplied an external operation ID. R24 correctly
  rejected it; R30 now uses the frozen null-ID contract and immutable settlement
  provenance without weakening R24 validation.
- Repeated fixtures shared Redis throttle buckets and produced real429s.
  Per-fixture namespacing now preserves the actual Lua/quota/TTL behavior.
  A dedicated real 30/hour case still requires429 and Retry-After.
- Browser startup inherited JEST_WORKER_ID, which the parent harness now removes
  from the Playwright subprocess environment. An earlier later run was
  interrupted during a host execution stall; partial screenshots were never
  treated as completed acceptance.
- The browser retained its private non-disclosure assertion and exposed403 for
  a foreign existing receipt versus404 for an absent receipt. Private reads now
  return uniform 404 for missing authority, including after fresh revocation;
  decision permission assertions remain403. Real service/unit reruns passed.
- Independent review found the settlement endpoint returns201{id}, while the
  frontend expected a full detail. The helper now follows successful creation
  with an authoritative detail GET, and its test uses the actual response.
- Independent review identified concurrent worker failure updates based on a
  stale retry count. The final correction fences the operational snapshot and
  adds passing unit and real-PostgreSQL concurrency regressions.
- A merge-integrity negative fixture stopped changing its target after module
  import formatting changed. It now mutates the named provider/export section
  and explicitly proves the mutation; all production validators and rejection
  assertions remain intact.
- A production web build without VITE_API_URL correctly failed its existing
  guard. Verification uses CI's explicit `https://api.example.com` build value;
  this is a non-live compile input, not a deployed endpoint.

- The confirmed-payment browser locator was ambiguous between the status h2
  and history h3. It now requires the exact level-2 status heading; all monetary
  and durable-state assertions remain unchanged.
- Direct screenshot review found cramped review columns at CSS 200% enlargement.
  Intrinsic columns now reflow into one readable column, with an explicit browser
  assertion. Reduced-motion users also no longer receive button color
  transitions that temporarily dropped contrast. All original Axe rules remain.

## Release boundary

Only the coordinator can accept integrated Wave3/G3 evidence. This task does
not merge, deploy, grant finance access, configure a real merchant or activate
live money. Actual R31/R32 participation, late/reassigned review recovery,
financial erasure/holds, hosted IAM/KMS/backup deletion and owner live-policy
approval remain in `RISKS.md`. Follow `ROLLBACK.md` for containment without
rewriting immutable history or manufacturing payment/refund success.
