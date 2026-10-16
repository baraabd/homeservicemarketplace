> Historical preparation record. PR #171 has since been owner-merged and verified. Current identity and lane readiness are in [PUBLICATION_VERIFICATION.md](PUBLICATION_VERIFICATION.md), SOURCE_MANIFEST.json and wave-02.plan.json. The preparation narrative below remains historical.

# G1 acceptance publication and R26 handoff

Mode A. **Integrated source accepted; owner publication pending.** This is
the separate G1-06 record after owner-merged corrective PR #169. It is not R26
implementation, a merged publication, a hosted release or live activation.

## Exact source and authority

- Frozen runtime source: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
- Frozen complete tree: `109b514fe9833a9aac3e8caecd7f9b14d4f61b3b`.
- PR #169 merged by the owner at `2026-10-16T21:20:48Z`.
- Its tested head `a93bdf6e5f6d403f6395f4c140fe52ff4ed319c4` has the identical complete tree.
- All nine original R19–R23 implementation/corrective merge commits are ancestors;
  CR-R20-01 in #168 and all remaining source/CI repairs in #169 are present.
- Publication branch: `coord/g1-acceptance-publication`.
- Final publication head/tree and local hook commit are recorded externally in
  its PR body. They are different from the frozen runtime source and cannot be
  embedded as the record's own commit hash.
- Authority is the owner's continuing G1 coordination/review-PR delegation.
  Merge, auto-merge, deployment, account grants and spending remain excluded.

The exact 16-file publication lease is in `ACCEPTANCE_OWNERSHIP.md`. Runtime
source, schema, dependencies, CI definitions and application behavior are unchanged.

## Verified merged-source execution

| Boundary                                         | Actual execution on the frozen merged commit                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Full API / real PostgreSQL, Redis and Mailpit    | 331 suites, 6086 passed, zero failed; 13 suites / 81 cases gated to dedicated jobs                                                       |
| R19 money ports, compensation and inbox consumer | 19/19 passed, zero skipped; direct SQL amount/account/direction/reference negatives, rollback/replay and compile fixtures                |
| R20 real S3                                      | 40/40 passed, zero skipped; signed write-once avatar and unchanged bytes, authorization, IAM/root/versioning/retention boundaries        |
| R21 durable mail                                 | 13/13 passed, zero skipped; registration OTP, password reset and email verification reached real SMTP                                    |
| R22 replay/reliability                           | 8/8 replay and 21/21 reliability passed, zero skipped; migrated enum, missing-audit refusal, permissions and duplicates                  |
| R22 compiled Linux worker                        | 3/3 passed, zero skipped in its dedicated report; SIGKILL recovery, two processes and SIGTERM handback                                   |
| Retention                                        | 29/29 passed, zero skipped with real PostgreSQL/S3/ClamAV                                                                                |
| Dispute worker and route bundle                  | 31/31 passed, zero skipped, including all three compiled worker tests, protected metrics and SIGTERM                                     |
| R23 added producers                              | 4/4 transport boundary, 3/3 bootstrap and 2/2 scheduled diagnostics tests passed; retention/dispute jobs exercised actual worker metrics |

The 81 general-API skips are retained, not reported as passed by skipping.
Dedicated jobs execute 40 storage, 29 retention, 3 R22 process, 3 dispute
process and 6 real-browser cases. Real-route/visual browser jobs, migration
drift/upgrade gates, image boot and dependency/secret/container scans all pass.
The existing main browser matrix reports its own flag-gated skips separately.
No new manual screenshot review or hosted runtime is claimed by this document-only task.

| Post-merge workflow                                                                                                | Run / attempt           | Result  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------- |
| [Authentication lifecycle acceptance](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728537)  | 38968728537 / attempt 1 | success |
| [Staging release boundary](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728535)             | 38968728535 / attempt 1 | success |
| [CodeQL](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728491)                               | 38968728491 / attempt 1 | success |
| [Production governance](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728501)                | 38968728501 / attempt 1 | success |
| [Web development startup](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728472)              | 38968728472 / attempt 1 | success |
| [Real application startup performance](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728434) | 38968728434 / attempt 1 | success |
| [CI](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679)                                   | 38968728679 / attempt 1 | success |

These are push executions on the exact frozen commit. Pagination totals and
latest attempts were checked, along with job/artifact provenance and final
source identity. `ACCEPTANCE_EVIDENCE.json` records the inspected metadata.

The separate GitHub Advanced Security CodeQL result on PR head `a93bdf6e5f6d403f6395f4c140fe52ff4ed319c4`
is successful with zero annotations (check `117188663161`). The merged commit
has its own successful CodeQL analysis; that PR-only security result is not
misrepresented as a new merged-head result or an empty repository alert inventory.

The R23 alert and native-recovery workflows run on PR/dispatch rather than push.
Their successful identical-tree PR runs are supplemental, not claimed reruns:
[alerts](https://github.com/baraabd/homeservicemarketplace/actions/runs/38964502500),
[recovery](https://github.com/baraabd/homeservicemarketplace/actions/runs/38964502569).
The six mandatory G1 source categories have direct post-merge evidence above;
none relies on a skipped required case or these supplemental executions.

## Independently verified report archives

Each ZIP was downloaded, checked against GitHub's SHA-256, and its actual
Jest case statuses read. The JSON record includes report counts and required
case names, without raw logs, environment values or sensitive documents.

| Artifact                                                                                                                             | Verified SHA-256                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [g1-worker-process-evidence](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679/artifacts/12075759523)       | `sha256:805e378de5eface4a1c11e4d043f12788c9a491f7489a88b8d78b985ce8ddaec` |
| [g1-storage-evidence](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679/artifacts/12076590416)              | `sha256:2d35a325867f50c57aae6b260ba1afedbc19aeafa9f657a42763001ec245983b` |
| [retention-real-services-evidence](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679/artifacts/12076347055) | `sha256:b2c30a82ece06dc6fcc19acf889047cb8ecf90ec4e55ea2919ad1154a283cc5a` |
| [dispute-workspace-real-evidence](https://github.com/baraabd/homeservicemarketplace/actions/runs/38968728679/artifacts/12076113603)  | `sha256:c12b260586286d645bcaa32cbe59ebe70c4da91ed4142d7e777b98138e0356a7` |

Declared fixture configuration and a non-secret fingerprint are recorded in
the JSON. This identifies the workflow's declared disposable inputs; it is
not a production environment attestation. No user database, Redis namespace,
storage root, cookie jar or copied environment was used.

## Technical closure mapping

- G1-01 / R19.3–7 and CR-002: callable V1 interfaces/consumer fixtures, additive
  compensation guard and idempotent transactional R17 inbox handler. No invented
  R31 entitlement engine, identity approval, work access or provider payout.
- G1-02 / R20 CR-01/03/04: mediated-read size/MIME correction plus write-once
  avatar precondition and full real-service execution. Frontend-first rollout
  and API-first rollback remain required.
- G1-03 / R21 CR-03: all three formerly gated SMTP scenarios executed. Hosted
  sender identity, SPF/DKIM/DMARC and real delivery remain external release work.
- G1-04 / R22 CR-01–04: migrated audit enum, replay permission definition without
  role grants, validated timing and Linux independent-process evidence.
- G1-05 / R23 CR-02–04: bounded default-off export, scheduled protected
  diagnostics and actual outbox/SMTP/S3/scanner/worker instrumentation.
- G1-06: this ready review record supplies the source decision and frozen SHA;
  owner publication and subsequent start authorization remain outstanding.

## Publication and R26 start procedure

1. The owner reviews the code/evidence scope and this separate acceptance PR,
   then merges it through the normal process. This task performs no merge.
2. The coordinator resolves its actual merged commit, confirms it is reachable
   from `develop`, checks the frozen source/tree and active writer inventory,
   and records the publication identity. No guessed/self-referential SHA.
3. In a serialized coordinator change, set publication to MERGED with that
   verified acceptance-record SHA and reconcile the Wave 2 manifest/registry.
   Only assigned, reviewed lanes become READY_TO_START; no automatic mass start.
4. R26 uses `feat/r26-application-security` and frozen runtime source `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
   Its exact approved files/resources are in `wave-02.plan.json`. Extend the
   allowlist explicitly before any additional shared/IAM/edge/dependency edit.

All lanes remain held now. R26's current repository-wide finding inventory,
effective authorization/CSP tests and any shared patches are future R26 work,
not acceptance evidence manufactured by this G1 record.

## Publication-only validation and limits

Task-local Node 24.21.0 / pnpm 10.32.1; frozen installation passed without a
lockfile change. Governance fixtures now explicitly cover blocked records and
accepted-but-unpublished records while preserving every prior negative check.
Exact local commands/counts, normal-hook result, secret scans and final PR
CI/CodeQL conclusions are recorded in the review PR after execution.
No application build or service run is claimed locally for these document/test
changes; the actual merged-source executions above are GitHub's disposable jobs.

Hosted storage/IAM/KMS/CDN, sender deliverability, production alert routing,
branch protection, repository-wide finding dispositions, commercial and money
policy decisions remain separate release work. R18 NO-GO is not waived.
Rollback/revocation is in `ROLLBACK.md`; runtime source repairs remain governed
by `REMEDIATION_ROLLBACK.md`. Live money stays off.
