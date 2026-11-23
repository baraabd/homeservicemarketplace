# G2 — Independent verification of owner-merged publication

Verified at **2026-10-23T04:46:36Z** through the GitHub connector and the isolated
R30 checkout. This records an existing owner action and preserves the exact
technical acceptance source. It does not create a new merge or technical
acceptance claim.

## Source and publication identities

| Identity                               | Verified value                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Accepted frozen runtime source         | `72b4aaeb0a71d806b7fca7363dd9ca59bbcee644`                         |
| Accepted runtime tree                  | `43e9c6a4e58cfb934b12789feeb38b588e1cb7c6`                         |
| Owner-merged publication PR            | [#183](https://github.com/baraabd/homeservicemarketplace/pull/183) |
| Final PR head                          | `d2c0a9ab8862ffff886346a21377839f996152ca`                         |
| Owner merge / inspected develop        | `986b4707776711e80564f0642133ede90ba16f3c`                         |
| Final-head and merged publication tree | `7ab683ea8c5304929a2fa51f1dc824c7cb46f7d5`                         |
| Observed merge actor and time          | `baraabd`; `2026-10-23T04:11:34Z`                                  |

GitHub reports PR #183 closed and merged. The accepted source is an ancestor
of the merge. Its comparison is ahead by two commits, behind by zero, with
13 changed paths, all coordinator evidence/status files. The final PR-head and
owner-merged trees are identical. `PUBLICATION_VERIFICATION.json` retains the
exact paths, metadata, check identities and URLs.

## Observed remote results

- Final PR head: **38 latest distinct check names succeeded**, zero current
  failures/pending checks. The 40 raw checks include two superseded governance
  runs: one success and one cancellation. The latest governance result succeeds.
- Owner-merged source: **30 of 30 checks succeeded** and **8 of 8 workflows
  succeeded**. [Postmerge CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/39899003702)
  and [postmerge governance](https://github.com/baraabd/homeservicemarketplace/actions/runs/39899003864)
  were observed complete.
- The separate official `github-advanced-security` CodeQL check succeeds on
  the final PR head with zero annotations. Postmerge has the successful CodeQL
  analysis workflow. A separate postmerge official check is not asserted.
- The eight postmerge workflows are the workflows triggered by this push.
  PR-only measurements retain their separately verified exact-head evidence;
  they are not counted as newly rerun postmerge measurements.
- The legacy combined-status endpoint has no statuses and reports `pending`
  with `total_count=0`. Actual check-run and workflow inventories establish the
  result above; the empty legacy response is not a failed workflow.

These observations validate publication of the existing G2 record. They do not
establish R30 receipt handling, payment confirmation, sandbox acceptance,
hosted acceptance or real settlement.

## Local identity verification

Each command below completed with exit **0** in the assigned R30 checkout:

```sh
git merge-base --is-ancestor 72b4aaeb0a71d806b7fca7363dd9ca59bbcee644 986b4707776711e80564f0642133ede90ba16f3c
git diff --exit-code d2c0a9ab8862ffff886346a21377839f996152ca 986b4707776711e80564f0642133ede90ba16f3c
git diff --name-only 72b4aaeb0a71d806b7fca7363dd9ca59bbcee644 986b4707776711e80564f0642133ede90ba16f3c
```

The diff lists exactly the same 13 evidence/status paths as GitHub. After exact
ownership/session reconciliation, the unchanged governance suite passed
**480/480 tests, zero failures/skips**. G2 consistency, R30 readiness, production
governance, release-baseline validation and `git diff --check` each exited 0.
R29, R31, R32 and R33 readiness each correctly exited 1; every peer registry and
manifest record remains unchanged. Scoped Prettier completed successfully.

The first test invocation encountered executor `spawnSync EPERM` in its child
process fixtures. Approved execution allowing those same isolated subprocesses
passed the unchanged suite. No tests, assertions or validation rules were
modified. These checks validate the reconciled records; the independently
observed GitHub metadata remains the merge proof.

## Effect and rollback

Only R30 is assigned to root session `hsm-r30-590834e66da5`; other Wave 3 lane
records retain their holds. The machine start contract stays `READY_TO_START`
while nested execution records describe actual progress. Source execution uses
the preserved accepted runtime base and the metadata-only owner publication.

To revoke this handoff, return R30 to its held planning state and remove its
session/leases through a normal reviewed change. Keep the factual existing
owner merge and immutable evidence in history. No database or financial-data
rollback is involved. All live-money, policy, hosting, account, spend, merge and
deployment restrictions remain unchanged.
