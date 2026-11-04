# K09 — R36/R37 recovery, hosted resilience, security, load and incidents

**K09 status: BLOCKED — blocked-input handoff only.**
R36 runtime implementation: **NOT_STARTED**. R37 runtime implementation: **NOT_STARTED**.
Hosted execution: **NOT_RUN**. Nothing in this directory is PASS, SOURCE_VERIFIED,
SANDBOX_ACCEPTED, HOSTED_ACCEPTED or RELEASE_ACCEPTED evidence.

K09 is a launch work-breakdown item. It does not replace or bypass R36, R37, G3
or G4. It does not rebase, write to, or take ownership of
`test/r36-backup-restore-recovery` or `test/r37-hosted-load-security`. This
branch (`release/ksa-k09-recovery-resilience`) is a documentation branch. It is
not an official lane and not a coordinator integration candidate.

## Delivery mode

Mode A (Integration and Bug-Fix), inspection and documentation only. K09 makes
no UI, API, schema, migration, contract, dependency, workflow or infrastructure
change. Mode B does not apply because K09 has no scoped UX work.

## Source identity

| Item                                 | Value                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Inspected `origin/develop`           | `92770ea65ee1154f94f4251d5febfa39822f9b9a`                                 |
| Inspected tree                       | `854a9146c05bf21ef62af060358f581ec4c19306`                                 |
| Matches the K09 audit reference      | Yes (same commit and tree), checked 2026-11-03                             |
| Authorized frozen G3 base/tree       | **Absent** (`frozenBaseSha: null`, `frozenTreeSha: null`)                  |
| Approved successor base              | **None recorded**                                                          |
| Migration head                       | `20261024120000_g3_financial_integration`                                  |
| Prisma / Stripe SDK                  | `6.12.0` / `23.0.1`                                                        |
| Toolchain used for check-only guards | Node `v24.21.0`; the guards need no install                                |
| K09 final commit/tree                | Recorded in the PR or handoff message, so no hash refers to its own commit |

The previous R36/R37 preflights inspected `c9de08d07b12871db8801fb9662b14de83a2c391`.
The only non-documentation change since then is #203 (`03117e7a`, `92770ea6`).
#203 changes the verification-case workflow service, its tests and the provider
verification UI. It changes no schema, storage, mail, outbox, worker, money,
infrastructure or performance path. However, it changes a provider journey that
the R36 RTO journeys and the R37 media-isolation probes must later exercise.

## Gate result (start barrier)

Run unchanged from a detached `origin/develop` worktree:

| Command                                          | Exit | Result                                                                                             |
| ------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------- |
| `node .github/scripts/g3-record.mjs --check`     | 0    | `PASS G3 record consistency…`; `Recorded G3: BLOCKED; Wave 4: BLOCKED; R38 final G4 join: BLOCKED` |
| `node .github/scripts/g3-record.mjs --ready R36` | 1    | `FAIL R36 is not authorized to start`                                                              |
| `node .github/scripts/g3-record.mjs --ready R37` | 1    | `FAIL R37 is not authorized to start`                                                              |
| `node --test .github/scripts/g3-record.test.mjs` | 0    | tests 35, pass 35, fail 0, cancelled 0, skipped 0, todo 0                                          |

Record facts behind the refusal:

- `gates/g3/SOURCE_MANIFEST.json`: `decision: BLOCKED`, null candidate and frozen
  source/tree, `acceptedSprints: []`, and all seven mandatory evidence items `NOT_RUN`.
- `waves/wave-04.plan.json`: `status: BLOCKED`, `baseSha: null`,
  `startableLanes: []`. R36 and R37 are each `BLOCKED` by
  `G3_ACCEPTANCE_AND_VERIFIED_PUBLICATION` and `EXACT_SESSION_ASSIGNMENT`.
- Each lane holds one `CONDITIONAL_EXACT_INFRASTRUCTURE_FILES` lease. Its start
  prerequisite (`G3 ACCEPTED`, publication `MERGED_AND_VERIFIED`, session
  assigned) is unmet, so the lease is **not effective**.
- `ACTIVE_STATUS.md`: R34–R38 are `PLANNED` behind G3.
- The remote lane branches `test/r36-…` (`6478bbed`) and `test/r37-…` (`b2fe1bf3`)
  are ancestors of develop (0 commits ahead). They hold only merged blocked preflights.

K09 therefore performed only the permitted activities: inspection, design
verification against current source, check-only commands, and this handoff.
It authored none of the ten R36 or ten R37 lane script/test files, none of the
six lane-conditional infrastructure files, and no R36/R37 document. The R36
and R37 lane documents remain the exclusive writing area of their future
assigned sessions.

## Files in this directory

- [BLOCKED_INPUTS.md](BLOCKED_INPUTS.md): every missing input, its owner, the
  exact field or record it supplies, and which step consumes it.
- [ISSUE_TO_TEST_MATRIX.md](ISSUE_TO_TEST_MATRIX.md): each K09 requirement mapped
  to its current source anchor, the finding re-verified at `92770ea`, the owning
  lane file for the future test, and its status.
- [RELEASE_BLOCKERS.md](RELEASE_BLOCKERS.md): the K09 release-blocker register.
- [ROLLBACK.md](ROLLBACK.md): rollback for this documentation change, plus the
  forward-repair boundaries for the future lanes.
- [evidence/preflight-2026-11-03.json](evidence/preflight-2026-11-03.json):
  exact commands, exit codes, counts and fingerprints.

## Upstream K sprint state, as observed and not accepted

- **K03 (hosted infrastructure):** local branch `release/ksa-k03-hosted-staging`
  at `e4458df3`, 2 commits ahead of develop, unpushed, with uncommitted changes
  in another session's worktree. It is **not** accepted hosted infrastructure.
  Its local commit `e0232252` ("require the mail dispatcher independently of the
  outbox worker for deployment") addresses finding F-05b in
  [ISSUE_TO_TEST_MATRIX.md](ISSUE_TO_TEST_MATRIX.md). K09 does not import or
  depend on that unmerged change.
- **K07/K08:** local branches at `92770ea6`, 0 commits ahead. No joined
  reconciliation/cross-role candidate exists to schedule integrated acceptance against.
- **K10:** docs-only dossier on Draft PR #205 (`release/ksa-k10-launch`). It
  records K09 as unaccepted, which is consistent with this record. The K09 and
  K10 paths are disjoint.

## Base CI state

Check runs on `92770ea6`: 29 success, 4 failure. The failures are `CI gate`,
`R18 functional completion acceptance`, `Dependency, secret, and container scans`
and `Dev browser startup (windows-latest)`. K09 changes no code, so it neither
causes nor fixes these failures. A K09 PR will inherit them, and any lane started
later must not treat this base as green.

## Security, privacy and money

No hosted resource, account, registry, DNS, mail relay, payment provider,
scanner or alert destination was contacted or provisioned, and nothing was
disrupted. No synthetic or real user, identity document, receipt, token or
secret was created, read or recorded. The GitHub alert reads used the existing
authenticated `gh` session in read-only mode. Live money, refunds, payouts and
R16/R18 holds are unchanged.
