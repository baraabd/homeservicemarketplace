# R36 — Recovery preflight after the G3 integration merge

Status: **INTEGRATION_PENDING / POLICY_BLOCKED / EXTERNAL_BLOCKED**.
R36 recovery implementation is **NOT_STARTED**. This follow-up corrects stale
source findings and makes the recovery handoff reviewable. It does not close
P50-recovery or claim an executed backup, restore or image rollback.

## Source, branch and scope

- Delivery mode A; documentation preflight only.
- Branch: `test/r36-backup-restore-recovery`.
- Observed owner-merged develop source: `c9de08d07b12871db8801fb9662b14de83a2c391`.
- Observed source tree: `67136183b8a81de9773c2c6a3831441c320729c0`.
- Approved frozen G3 execution base: **absent**.
- Final documentation commit/tree: the PR's exact Final SHA and Source tree
  fields, avoiding a self-referential SHA inside this commit.
- Exact fresh documentation assignment: [OWNERSHIP.md](OWNERSHIP.md).
- New command results and source/configuration fingerprints:
  [evidence/preflight-2026-10-25.json](evidence/preflight-2026-10-25.json).

PR #190 was merged on 2026-10-24. Its historical evidence remains unchanged.
PR #198 was merged by the owner on 2026-10-25 at the inspected source above.
Neither observed merge was performed by this follow-up. The old R36 head was
fast-forwarded to that existing develop commit; no unmerged peer was imported.

## Current gate result

`g3-record.mjs --check` exits 0 because the **BLOCKED** record is consistent;
`g3-record.mjs --ready R36` exits 1 with `R36 is not authorized to start`.
The canonical G3 manifest has null candidate/frozen source and tree values,
no accepted sprints and publication `NOT_PREPARED`, `verifiedMerge: false`.
Wave 4 has `baseSha: null`, no startable lanes and no active R36 assignment.
The conditional ten script/test files and three infrastructure files therefore
remain unauthored. The owner's prompt explicitly requires that start barrier.

The seven canonical G3 evidence categories are still recorded `NOT_RUN`.
G3's acceptance document separately records executed component/assembled
checks, but its fourteen external Stripe scenarios remain `NOT_RUN`. Those
historical results are not new executions here and are not an accepted G3
publication. The coordinator must reconcile current exact-source evidence,
approved policy inputs and authentic sandbox runs before releasing Wave 4.

## Corrected implementation findings

1. **R29 is present.** The earlier R36 statement that Stripe/webhook source
   was absent is superseded. `apps/api/src/modules/money/money.module.ts`
   now registers the Stripe runtime, collection/refund routers,
   `ApprovedRefundPolicySource` and `ApprovedRefundParticipant`.
   `apps/api/src/app.module.ts` mounts the signed webhook and inbox scheduler.
   Purchase-session source and the web purchase component are also present.
   Existing composition must be verified, not recreated by R36.
2. **Approved policy is still an external input.** A real policy version and
   explicit whole-subscription consequence must be supplied by its owner.
   The presence of the policy implementation or synthetic test records is not
   approval. Live rails stay off and R16/R18 decisions remain unchanged.
3. **Hosted topology is a checked proposal.** R28's strict target validator
   exits 2 with `CONFIGURATION_ONLY`, `HOSTED_ENVIRONMENT_BLOCKED` and nine
   blocker categories. Source/restore physical resources, image provenance,
   protected key references and authorizations are unassigned in that plan.
   RPO 300 seconds, RTO 14,400 seconds and seven-day database retention are
   proposed values, neither approved objectives nor measured results.
4. **R20 inventory can be reused but is not complete recovery proof.**
   `storage-inventory.ts` inventories versions/delete markers and optionally
   hashes them deeply. Its `verifyRestore` compares latest live objects only;
   unexpected objects are reported but do not make `ok` false. R36 must wrap
   those existing contracts with required historical-version/deletion checks,
   explicit source-to-target version mapping and an unexplained-extra-object
   stop condition. Do not silently redefine the existing v1 verdict.
5. **Mail has independent and immediate send paths.**
   `MAIL_DISPATCHER_ENABLED` is separate from `OUTBOX_WORKER_ENABLED`.
   Even with both background workers disabled, `DurableMailService.send()`
   and immediate post-commit dispatch can reach the transport. Restored boot
   needs independently enforced egress denial and isolated SMTP credentials
   and sink. Stable Message-ID does not prove zero duplicate delivery after
   relay acceptance followed by a lost database acknowledgement.
6. **Key recovery covers queued mail as well as objects.**
   `MailEnvelopeCipher` needs the original dedicated key, or the corresponding
   parent `JWT_ACCESS_SECRET` version when the production derivation fallback
   was used. The envelope format has no historical key identifier. Bind
   protected key-version references and prove decryptability; do not use a
   new ephemeral key or treat `undecryptable` work as recovered.
7. **Application rollback instructions are contradictory.**
   `staging.cjs` always invokes `api-migrate` during `--apply`. R18 says to
   rerun the previous release but not its migrator, and R28 repeats use of
   the existing launcher. CR-001 now provides exact corrections for both
   documents. No shared launcher or runbook was changed here.

## Consistent recovery-set inventory

Use one approved whole-database consistency boundary, with snapshot/WAL
lineage and complete schema/migration history. The following is an invariant
inventory, not a selective table-dump recipe:

| Authority                   | State and invariant to preserve                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger                      | Accounts, posted transactions/entries, linked reversals, exact minor-unit/currency balance, immutable triggers and audit history.                                                                                                                                                                                                   |
| Collection and subscription | Intent, attempt, confirmation, command/digest, binding, external inbox identity, immutable plan/version, period-to-confirmation uniqueness, coupon/entitlement usage.                                                                                                                                                               |
| Refund and manual rails     | Request/refund/dispatch, reservation and compensation links, original provider idempotency/operation identities, receipt/review/settlement/decision state.                                                                                                                                                                          |
| New G3 foundation           | `MoneyApprovedRefundPolicy`, `MoneyReconciliationWindow`, `MoneyReconciliationRun`, `MoneyReconciliationObservation`, `MoneyReconciliationCase`, `MoneyReconciliationDecision`, and existing exception links. Preserve policy immutability, cursors/fences, observation scope, decision revisions and original-resolution evidence. |
| Jobs and mail               | `OutboxEvent`, `OutboxHandlerRun` composite identities, leases, pending/terminal `EmailDelivery`, message keys, encrypted envelopes, suppression/feedback and per-handler outcomes.                                                                                                                                                 |
| Privacy and authority       | Users, roles/permissions, account status, session revocations, verification/work access, audit, media metadata, holds, deletion/tombstones and restricted evidence.                                                                                                                                                                 |

Bind required object versions and deletion state, content hashes, protected
key-version references, immutable API/migrator/web image digests, accepted
source SHA and a non-secret configuration fingerprint to that same set.
Historical encrypted copies must not resurrect erased evidence or revoked
access. Reconcile approved post-snapshot deletion/revocation facts before
opening any recovered service to users.

Current versions are Prisma `6.12.0`, Stripe SDK `23.0.1`,
`hsm.storage-inventory/v1`, `hsm.storage-restore-report/v1` and
`hsm.platform-inputs/v1`. The merged migration is
`20261024120000_g3_financial_integration`. It also replaces a reconciliation
transition trigger, so describing it as additive does not prove old-image
compatibility. Verify constraints/triggers and real legacy/provenance-backed
exception flows against the forward schema. This follow-up changes no
schema, migration, dependency or published contract.

## Execution boundary and handoff

Before restored processes boot, independently verify DB/user, Redis,
container/volume, queue, storage, network and browser-cookie isolation.
Disable both background dispatchers; preserve refund authorization off and
empty Stripe configuration; separately deny payment/refund/SMTP egress and
route webhook ingress away from the restored target. These are requirements,
not configuration changes made here. Only a separately approved isolated
replay phase may enable disposable adapters/sinks.

An older database cannot prove what an external provider accepted after its
snapshot. Preserve original operation keys and query/reconcile independent
outcomes. Unknown money outcome, incomplete provider evidence or ambiguous
mail acceptance stops replay/cutover; no autonomous retry or financial reset.

The [acceptance matrix](ACCEPTANCE.md) specifies measurable evidence for all
required scenarios. The [shared change request](shared-change-requests/CR-001-integration.md)
identifies exact coordinator paths and owner inputs. No hosted resource was
contacted, provisioned, restored or disrupted by this preflight.
