# R36 — Current blockers and residual risks

Inspected source: `c9de08d07b12871db8801fb9662b14de83a2c391`.
These findings replace stale implementation-absence claims, not the retained
historical evidence. No runtime mitigation or recovery rehearsal is claimed.

| ID             | Finding and consequence                                                                                                                                                              | Owner and closure                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R36-G3         | #198 source is merged, but G3 remains BLOCKED with no accepted frozen source or verified acceptance publication.                                                                     | G3 coordinator: current-source integrated evidence, approved policy, authentic sandbox runs, owner-reviewed publication and exact R36 assignment.                |
| R36-TARGET     | R28 has proposed topology, no authorized independent restore destination or accepted image set.                                                                                      | Infrastructure/release owner: physical resource identities, provenance and isolated restore approval.                                                            |
| R36-OBJECTIVES | RPO 300 s, RTO 14,400 s and seven-day retention are proposals only.                                                                                                                  | Data owner: explicit schedule, encrypted retention, deletion/hold/key-retirement rules and objectives; then measure actual loss/time.                            |
| R36-KEYS       | Object decrypt references are unassigned; queued mail may depend on a historical dedicated key or JWT parent-secret version.                                                         | Secret/KMS and mail owners: protected version references and missing/wrong-key drills without plaintext disclosure.                                              |
| R36-VERSIONS   | R20 v1 restore verdict checks latest live objects and does not reject unexpected objects.                                                                                            | R36 verifier after G3: complete required version/deletion mapping, deep checksums, namespace identity and extra-object rejection.                                |
| R36-REPLAY     | Restored pending money work may represent an already executed external operation.                                                                                                    | Money operator: preserve original keys and independently reconcile outcomes; unknown outcome stops automation and cutover.                                       |
| R36-MAIL       | Separate mail dispatcher and synchronous/immediate delivery remain possible with Outbox disabled; stable Message-ID is not exactly-once delivery.                                    | Mail/network owners: disable both schedulers, deny real egress, use controlled sink counters and resolve ambiguous external acceptance before real-user routing. |
| R36-SCHEMA     | G3 adds policy/reconciliation records and replaces a transition trigger; restored row counts alone miss authority loss or incompatibility.                                           | Database/release owners: verify triggers/constraints, immutable history and actual prior-image operations on the forward schema.                                 |
| R36-ROLLBACK   | R18 and R28 suggest the old launcher; its apply always runs the migrator.                                                                                                            | Coordinator: apply CR-001's two runbook corrections; review a separate migration-free application rollback path.                                                 |
| R36-RETENTION  | Historical ADR 0012 requires restricted storage without object versioning; R20 plans versioning with all-version erasure. Old backups can resurrect deleted bytes or revoked access. | Privacy/data/storage owners: approve current retention/hold/deletion policy and reconcile post-snapshot erasures/revocations before access.                      |
| R36-EVIDENCE   | Existing validator fixtures, prior CI and source inclusion do not establish a real R36 restore or zero external effects.                                                             | Coordinator: exact-source current artifacts and useful-service measurements, with unrun/failed/blocked checks explicitly retained.                               |

R16 payout/funding and unresolved R18 decisions remain unchanged. No market,
currency, price, fee/tax, escrow, payout, identity/work-access or permission
decision is made. Subscription revenue is not provider withdrawable earnings.

Distinct names alone do not prove isolation: check effective physical resource
IDs, volumes/container names, bucket namespaces, routes, cookie domains and
DB roles before boot. No production rollback, database reset, shared Redis
flush, volume deletion, account grant or public private-media exposure is
part of this documentation preflight.
