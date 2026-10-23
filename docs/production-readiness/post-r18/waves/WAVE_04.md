# Wave 4: R34–R38

All five recovered packages are **PLANNED** behind **G3**. G2 can release Wave 3
only. Wave 4 has no candidate or frozen execution source, no accepted G3
evidence, no assigned active writer and no startable lane.

`wave-04.plan.json` is the exact conditional file plan. Its titles, branches,
dependencies and two-phase R38 boundary come from the original full prompts,
whose provenance is retained in
[`PROMPT_PROVENANCE.md`](../gates/g2/PROMPT_PROVENANCE.md). A planning record does
not execute any of these sprints.

## Recovered assignments

| Lane | Sprint and complete prompt                                                                                    | Assigned branch                      | Earlier-wave dependencies                        | Exact files / conditional infrastructure lease |
| ---- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| 1    | [R34 — Cross-rail reconciliation, settlement exceptions and financial acceptance](../gates/g2/prompts/R34.md) | `feat/r34-reconciliation-settlement` | R29, R30, R31, R32, R33                          | 24 / 0                                         |
| 2    | [R35 — Three-application and subscription lifecycle acceptance](../gates/g2/prompts/R35.md)                   | `test/r35-cross-role-certification`  | R24, R25, R29, R30, R31, R32, R33                | 18 / 0                                         |
| 3    | [R36 — Backup restore, disaster recovery and compatible rollback](../gates/g2/prompts/R36.md)                 | `test/r36-backup-restore-recovery`   | R20, R22, R28, R29, R30, R31, R32, R33           | 16 / 3                                         |
| 4    | [R37 — Hosted security, load and operational failure acceptance](../gates/g2/prompts/R37.md)                  | `test/r37-hosted-load-security`      | R23, R25, R26, R27, R28, R29, R30, R31, R32, R33 | 16 / 3                                         |
| 5    | [R38 — Release-candidate packaging and final launch certification](../gates/g2/prompts/R38.md)                | `release/r38-release-certification`  | R24, R25, R26, R27, R28, R29, R30, R31, R32, R33 | 14 / 3                                         |

All dependencies are earlier-wave source dependencies. R38's final evidence
join with R34–R37 is recorded separately. Adding those four as source-build
dependencies would violate the five-session model and permit unmerged-peer
coupling.

## G3 start barrier

The [G3 source manifest](../gates/g3/SOURCE_MANIFEST.json) remains blocked, with
null candidate/frozen source identities and `NOT_RUN` evidence. The coordinator
must integrate the actual Wave 3 implementations, verify real registered
providers/controllers/handlers and execute every
[G3 requirement](../gates/g3/REQUIREMENTS.md) on a single final source. The
accepted G2 prerequisite and its separate merged publication must also be
verified.

Even technically accepted G3 evidence is insufficient to start Wave 4 until the
owner-reviewed G3 publication is merged and verified separately. The record
adapter deliberately distinguishes consistency (`--check`) from start
readiness (`--ready R34` through `R38`). Neither command performs approval,
publication, resource provisioning or deployment.

Conditional file authoring leases for R36/R37/R38 are limited to their three
listed files each. Their gate/publication and session-assignment conditions,
prompt sources, scope, expiry and handoff are recorded explicitly in the JSON
manifest and [`OWNERSHIP_R29_R38.md`](OWNERSHIP_R29_R38.md). All shared staging
launchers, Compose/edge files, CI, schemas, routes and global configuration
remain coordinator-owned.

## Real execution and external authority

R34 exercises both accepted collection families, settlement/refund ambiguity,
independent statements and real operator exception flow. R35 owns acceptance
tests only and reruns the actual cross-role/financial journeys, required
AR/EN/RTL/accessibility/viewports and supported browser engines. R36 performs a
real authorized isolated restore with measured RPO/RTO and zero unintended
outbound effects. R37 needs exact hosted-target, test-window, rate/connection
budget and named operator approval before any network test. R28 checked
configuration alone supplies no hosted target authority.

The per-lane runtime templates are plans, not allocated resources. Before a
released lane runs, inspect its actual source and resolve independent database,
Redis/storage/mail, queue, container/volume, host/port and browser identities.
Missing hosting, keys, credentials, policy or target authorization remains a
named blocker; a local harness or runbook does not close real-service acceptance.

## R38 and the serialized final G4 join

R38 Phase A can prepare the evidence collector, validator, package and rollback
plan after G3. Its status can reach `PHASE_A_READY` independently of future
peer evidence. The `r38Finalization` entry remains blocked in this start plan.

For Phase B the coordinator joins completed R34, R35, R36 and R37 evidence,
freezes the integrated final candidate, and reruns all applicable CI, full
product and money journeys, reconciliation, hosted security/load/recovery and
alert checks. Source, tree, image/config/schema identities and owner scope must
match. Failed, cancelled, missing, stale, synthetic or mismatched evidence cannot
be copied into a successful final verdict.

G4 scope approval, `RELEASE_ACCEPTED`, and a later authorized actual `DEPLOYED`
state remain distinct. Live funds require the separate live-money gate and
target-specific owner rollout authorization. R16 payout and unresolved R18
decisions remain visible. This preparation merges and deploys nothing.
