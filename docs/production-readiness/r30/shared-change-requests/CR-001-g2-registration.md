# CR-001 — conditional R30 package registration

## Current disposition — 2026-10-23

Conditional registration was superseded by accepted G2 publication and the current exact runtime ownership/session assignment. See `../RUNTIME_OWNERSHIP.json`, `../IMPLEMENTATION.md` and `../ACCEPTANCE.md`.

## Historical request (preserved)

The following source observation/request predates authorized runtime work. Its blocked/unapplied status is historical, not the current disposition above.

Status: **PREPARED_FOR_REVIEW**. The coordinator-authorized patch in this review
branch transcribes the supplied R30 package and reserves a finite proposed file
list. It is not a merged registration, G2 acceptance or authorization to start
R30 runtime implementation.

## Authority and source

The complete owner-supplied package is retained in `../PROMPT.md`. The temporary
preparation lease in `../OWNERSHIP.md` and
`../../post-r18/gates/g2/OWNERSHIP.md` permits this writer to update only the R30
record in four coordinator-owned files and to write this request. Root retains
review, validation and publication responsibility. The lease grants no shared
runtime ownership and no authority to merge, deploy or activate a payment rail.

| Identity               | Recorded value                                                 |
| ---------------------- | -------------------------------------------------------------- |
| Fresh preparation base | `96e92825f9b65cf124317f43b55ce42fc97f5b49`                     |
| Source tree            | `68f4e926eabeb37bb70382c62b75272cf67bd02c`                     |
| Sprint / slot          | R30 / Wave 3, lane 2                                           |
| Supplied title         | Manual subscription payment rails and protected receipt review |
| Assigned branch        | `feat/r30-manual-payment-review`                               |
| Dependencies           | R24, R20, R21, R22, R23                                        |
| Legacy coverage        | P40, P41-manual-adapter                                        |
| Start barrier          | G2; approved frozen commit and tree are absent                 |

The preparation base identifies the tree inspected for this proposal. It must
not be copied into R30's frozen execution base. The accepted G2 commit, its
tree, complete source evidence and verified owner publication must supply that
identity later.

## Minimal conditional patch

| Coordinator-owned path                                       | R30-only change                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/production-readiness/post-r18/SPRINT_REGISTRY.json`    | Replace R30's missing-package reservation with the supplied title, branch, dependencies and aliases; status `PLANNED`, `frozenBase: null`, an explicit blocked G2 start barrier and conditional named ownership. |
| `docs/production-readiness/post-r18/waves/wave-03.plan.json` | Transcribe the same R30 identity and exact future files; lane status `BLOCKED`, `frozenBaseSha: null`, empty shared leases and continued membership in `blockedLanes`.                                           |
| `docs/production-readiness/post-r18/ACTIVE_STATUS.md`        | Update only R30's table entry and its package-supplied qualification.                                                                                                                                            |
| `docs/production-readiness/post-r18/waves/WAVE_03.md`        | Update only R30's table entry and add its conditional handoff qualification.                                                                                                                                     |

The registry `ownedPaths.exact` and wave `exactFiles` must contain the identical
ordered union of `laneFiles`, `additionalDedicatedTestFiles` and `evidenceFiles`
from `../PROPOSED_OWNERSHIP.json`: **46 lane files + 9 dedicated test files + 15
R30 evidence files = 70 distinct exact files**. That finite proposal has no
directory-prefix ownership and does not include any
shared runtime path from the separate integration requests. Both records retain
empty `leases`; a request to change a shared file is not an approved runtime
lease.

The named future lane owner is the R30 owner-delegated session **after verified
G2 approval and publication**, coordinated by the G2 owner-delegated coordinator
for baraabd. Conditional ownership must be revalidated against the actual
accepted G2 tree and concurrent writers before any runtime start. Approval of
this documentation change alone does not grant that start.

## Preserved authorities and prerequisites

All peer sprint and wave-lane records remain unchanged. G1 acceptance, G2's
source/evidence/publication records, frozen identities, the empty
`startableLanes` list, R16/R18 holds, the measured R27 budget decision and hosted
environment blockers remain unchanged. This request does not repair or
reinterpret historical evidence and does not approve a performance threshold.

After G2 is accepted and its owner-merged publication is verified, the
coordinator must reconcile R30's frozen identity and ownership with the accepted
tree, obtain the exact serialized shared-file leases described by CR-002 through
CR-005, and assign the isolated services required by the prompt. Unapproved
merchant details, settlement authority, financial approval thresholds and
receipt retention policy keep the affected live behavior disabled. Runtime
acceptance still requires the complete R30 verification plan; a documentation
check cannot establish payment, storage, scanner, notification or browser
acceptance.

## Verification and consequences

The existing registry and Wave 3 validator support a supplied `PLANNED` package
with a blocked G2 barrier and null frozen base. Validation must confirm both
canonical records agree, all proposed paths are exact and disjoint from other
Wave 3 owners, all peer records are unchanged, and the G2 readiness command still
rejects R30. Existing governance tests and applicable final-PR checks remain
mandatory. Root records the actual commands, exits and counts in
`../ACCEPTANCE.md`; this request does not predeclare a passing result.

No source, dependency, package manifest, lockfile, schema, migration, service,
route, account grant or CI policy is changed by this registration. CR-002 through
CR-005 remain unapplied requests. Any test fixture exposed by adding a second
known Wave 3 package must be reported to the coordinator and changed only under
its own explicit lease, without weakening the start barrier or assertions.

## Rollback

Before publication, withdraw the R30-only changes in the four canonical records
and retain this request as withdrawn evidence if the coordinator chooses to keep
the preparation record. After owner merge, use a normal reviewed corrective
commit. Do not rewrite history, alter a peer record, roll back a database or
change G2 acceptance to undo this documentation-only proposal.
