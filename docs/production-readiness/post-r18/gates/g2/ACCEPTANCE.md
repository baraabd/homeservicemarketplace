# G2 execution and evidence

## Honest states

Coordination records and structural tests: IMPLEMENTED.
G2 source decision: BLOCKED. Wave 3: BLOCKED. Frozen execution SHA: null.
Sandbox/hosted/release acceptance: NOT ESTABLISHED. PR: Draft required.

Inspection SHA: `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`.
Inspection tree: `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`.
Publication parent after ownership: `0ace2969f2572f3a3f20857a435790927304ddfb`.
Final publication SHA/tree and CI identifiers are recorded in the PR body, not
inside the commit being identified. Earlier source checks never certify a new head.

## Commands actually executed here

The source export was edited in `/mnt/data/hsm-g2`, not the user's VS Code
worktree. No existing worktree, branch, stash, node_modules or service was touched.
Available local runtime: Node 22.16.0. Repository pins remain Node 24.21.0 and
pnpm 10.32.1. All results below are supplemental structural checks on Node 22,
not a frozen-install or application-acceptance claim.

| Command / verification | Actual outcome |
| --- | --- |
| `git ls-remote https://github.com/baraabd/homeservicemarketplace.git` | Exit 128; GitHub DNS resolution unavailable; no clone or push via local Git |
| SHA-256 of downloaded governance source ZIP | Matched GitHub artifact 12111383568: `812b5d0f419f2f82d78998c7f60e1c5f490220f549c9f5078877d383f9b169b6` |
| Python source verification: Git blob hashing and recursive tree reconstruction | 2573/2573 blobs matched; reconstructed full tree matched `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`; exit 0 |
| SHA-256 of downloaded R25 safe ZIP | Matched artifact 12111448781: `1ce6534f4377fad0e3c6a8177b05ff09389a30693bc402be634b1843f84798a6` |
| Baseline `node --test .github/scripts/*.test.mjs` | 161 passed, 0 failed/skipped; exit 0 |
| Final `node --test .github/scripts/*.test.mjs` | 218 passed, 0 failed/skipped; exit 0; includes 57 new G2 cases |
| `node --test infra/production/check-runtime.test.cjs infra/production/staging.test.cjs` | 95 passed, 0 failed/skipped; exit 0; these are script tests, not a running topology |
| `node .github/scripts/production-governance.mjs` | Exit 0; repository files only, not actual branch-protection proof |
| `node .github/scripts/release-baseline.mjs` | Exit 0; baseline consistency only |
| `node .github/scripts/sprint-registry.mjs` | Exit 0; original registry and historical G1 plan remain consistent |
| `node .github/scripts/g2-record.mjs --check` | Exit 0; BLOCKED records are internally consistent, not accepted |
| `node .github/scripts/g2-record.mjs --ready R29` | Expected exit 1: R29 is not authorized to start |

Positive acceptance-transition objects in unit tests are explicitly in-memory
contract doubles. They are never written into the real manifest. Test counts
are not added to historical remote application counts as unique coverage.

## Remote evidence inspected, not newly executed here

Current-source main CI run 39062646647 failed. R25 job 117484531044 passed its
29 verifier tests and 13 API integration cases, but its real browser command
exited 1. Dependent R18 check 117487828278 and CI gate 117487842451 also failed.
The downloaded safe artifact binds to the exact inspection source/tree. Browser
case counts/assertion details were not published; they remain unknown.

Production governance source run 39062646591 succeeded and supplied the archive.
Merged PR #176/#175/#174/#173 source evidence is distinct from this combined run.
A complete current-source CodeQL/all-check/all-alert inventory was not certified.
No historical green PR is substituted for the failed combined candidate.

## Not run / unavailable

Pinned local frozen install, package lint/typecheck/unit/build, local hooks,
local PostgreSQL/Redis/storage/browser execution, SDK/vendor sandbox flow,
new pinned formatter/secret/dependency/container scans, and hosted tests were not
run. Direct Git and official pinned-tool downloads were unavailable in this
environment. No pin or lockfile was changed. New-PR CI/CodeQL evidence remains
required and must be read on the final publication SHA before any review status
change. No application UI was changed; no new screenshot or AR/EN/RTL result is
claimed. Existing security gates are unchanged.

Public local-environment fingerprint (no secrets): `5f15d020177480470e6ae304e1b79b5977f95d8cabf2fa168a0a6ecb54b72e9a`.
Its inputs are Node/runtime pins, Linux, verified-source-export mode, failed Git
DNS transport, no local service execution and live-money disabled; no raw .env,
hostname, credential or session trace is captured.
