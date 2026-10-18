# G1 merged-source acceptance evidence

Inspected UTC: 2026-10-16T21:41:51.823662+00:00. Source `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`, tree `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
The owner merged corrective PR #169. Its head `a93bdf6e5f6d403f6395f4c140fe52ff4ed319c4` has the same
complete tree; `git diff` between them is empty. Runtime results below are
fresh runs on the merged commit unless explicitly labelled otherwise.

## Downloaded actual reports

[CI run 38968728679](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679) produced these reports. ZIP SHA-256
values were independently computed and compared with GitHub artifact digests.
Reports were parsed and every failed/skipped count inspected, not inferred from
an aggregate green job. Complete structured results are in `ACCEPTANCE_EVIDENCE.json`.

| Report                            | Passed | Failed | Skipped | Artifact ID |
| --------------------------------- | ------ | ------ | ------- | ----------- |
| r22-process-report.json           | 3      | 0      | 0       | 12075759523 |
| g1-api-report.json                | 6086   | 0      | 81      | 12075759523 |
| r20-storage-report.json           | 40     | 0      | 0       | 12076590416 |
| retention-ci-report.json          | 29     | 0      | 0       | 12076347055 |
| api/dispute-workspace-ci.json     | 31     | 0      | 0       | 12076113603 |
| api/r17e-provider-browser-ci.json | 1      | 0      | 0       | 12077075202 |
| api/r17e-provider-ci.json         | 30     | 0      | 0       | 12077075202 |
| api/r17e-closure-browser-ci.json  | 1      | 0      | 0       | 12077075202 |
| api/r17e-closure-ci.json          | 12     | 0      | 0       | 12077075202 |
| api/r17d-admin-browser-ci.json    | 1      | 0      | 0       | 12075764331 |
| api/r17d-admin-ci.json            | 13     | 0      | 0       | 12075764331 |
| api/r17c-disputes-browser-ci.json | 1      | 0      | 0       | 12076485876 |
| api/r17c-disputes-ci.json         | 22     | 0      | 0       | 12076485876 |
| api/e18-my-bids-browser-ci.json   | 1      | 0      | 0       | 12076462462 |
| api/e18-my-bids-ci.json           | 6      | 0      | 0       | 12076462462 |

The general API invocation passed 6086 tests and skipped 81 service/process/
browser cases. **All 81 exact skipped test names occur as passing assertions in
dedicated reports from this same merged-source run.** No skip is counted as a
pass in the general invocation. The report union, rather than summing suites
that overlap, establishes this accounting.

Focused evidence: R19 19/19; R20 40/40; R21 durable mail 13/13 with all three
SMTP cases, plus feedback 13/13; R22 replay 8/8, reliability 21/21 and real
compiled-process cases 3/3. R23 transport boundaries 4/4, export bootstrap 3/3,
diagnostics scheduler 2/2; protected worker metric assertions are exercised by
the real retention/dispute-worker suites. All named required cases execute.

## Provenance

| Artifact ID | Name                             | Independently verified ZIP SHA-256                                        |
| ----------- | -------------------------------- | ------------------------------------------------------------------------- |
| 12075759523 | g1-worker-process-evidence       | `sha256:805e378de5eface4a1c11e4d043f12788c9a491f7489a88b8d78b985ce8ddaec` |
| 12076590416 | g1-storage-evidence              | `sha256:2d35a325867f50c57aae6b260ba1afedbc19aeafa9f657a42763001ec245983b` |
| 12076347055 | retention-real-services-evidence | `sha256:b2c30a82ece06dc6fcc19acf889047cb8ecf90ec4e55ea2919ad1154a283cc5a` |
| 12076113603 | dispute-workspace-real-evidence  | `sha256:c12b260586286d645bcaa32cbe59ebe70c4da91ed4142d7e777b98138e0356a7` |
| 12077075202 | r17e-provider-real-evidence      | `sha256:6306e005671c560b59f260b03058a2d4f28c65792d37026d73bfb9a446232bea` |
| 12075764331 | r17d-admin-real-evidence         | `sha256:9b9d0a9025bf0e782e15a6d6c98e57e3bd8707473a62cff5fa4072f996e1d12d` |
| 12076485876 | r17c-dispute-real-evidence       | `sha256:449d7f3d58ba8e4ad5b240c0dc37d9a373783181262910e2ffa998f7d24dbfe5` |
| 12076462462 | e18-my-bids-real-evidence        | `sha256:3eaf504d86716ae48d29edcf414dd07772f6fb9f8e0aa4a6c01e24f894bfecb6` |

The source has 28 latest successful checks, including CI
gate, R18 acceptance, CodeQL analysis and production governance. Their IDs and
URLs are recorded in the JSON. Source checks do not pre-validate this later
publication commit; its own local and final-PR checks are recorded in its PR.

## Separately qualified evidence

- R23 alert run [38964502500](https://github.com/baraabd/homeservicemarketplace/actions/runs/38964502500), artifact
  `12074741275`, digest `62791a4b047bb6ef36d20080ed00e594375082e4ecf87edb4a981d28f128a34a`,
  ran on the byte-identical **pre-merge** tree: 16 rules / 0 quality problems,
  27 dashboard queries / 0 failures; firing and resolved notifications delivered.
  The workflow is PR/path-filtered and did not run on the merge commit.
- The pre-merge identical-tree GitHub Advanced Security check `117188663161`
  succeeded with 0 annotations and **no new alerts in changed code**. This is
  not an empty repository-wide security inventory. Merged-source CodeQL analysis
  independently succeeded; remaining release inventory belongs to R26.
- Browser/real-route jobs are automated evidence. No new manual screenshot
  review or UI redesign is claimed. Existing general Playwright flag-gated skips
  remain distinct from the 81 API cases accounted for above.

## Local publication verification and limits

Node 24.21.0 / pnpm 10.32.1 were installed in a task-local tool directory.
`pnpm install --frozen-lockfile` exited 0 with normal prepare and Husky setup.
The existing configuration continued to block two dependency install scripts;
no dependency approval, version, lockfile or machine-wide runtime changed.
Baseline governance: 158 passed / 0 failed / 0 skipped. Existing R27 pure
utilities: 17 passed / 0 failed / 0 skipped. Final publication lint, formatting,
governance counts and PR head are bound in the review PR, avoiding a self-hash.

This record certifies integrated technical and disposable-service boundaries.
It measures no hosted performance/capacity and accepts no live payment, payout,
production verification setting, sender, hosting account or commercial policy.
Owner review/merge of this separate record remains a publication hold; no lane
starts until that immutable record and its frozen source are verified.
