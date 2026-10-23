# R36 — Blockers and residual risks

| ID             | Finding and consequence                                                                                                | Owner / closure                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| R36-G3         | G3 has no accepted, published frozen source; R29 real Stripe and combined financial acceptance are missing             | G3 coordinator and R29/R32 owners; accepted exact-source integration and verified owner-merged publication                                          |
| R36-TARGET     | R28 contains proposed topology, no authorized independent restore destination or accepted image set                    | Infrastructure/release owner; exact resource identities and separate restore authorization                                                          |
| R36-OBJECTIVES | RPO 300 s, RTO 14,400 s and retention seven days are proposals only                                                    | Data owner; approve explicit objectives and schedule, then measure achieved results                                                                 |
| R36-KEYS       | No approved decrypt/recovery credential or key-version references are supplied                                         | Secret/KMS operator; protected references and lost-key drill; never commit secrets                                                                  |
| R36-VERSIONS   | R20 `verifyRestore` compares latest live objects and does not reject unexpected objects in `ok`                        | R36 owned verifier after G3; require the complete recovery-set versions/delete state and explicit rejection policy                                  |
| R36-REPLAY     | Restored pending deliveries can refer to effects already executed outside the restored DB point                        | Money/mail operators; keep egress and ingress isolated, query known external identities before any replay; unknown money outcome stops automation   |
| R36-ROLLBACK   | R18 recommends the old launcher but the current launcher always runs the migrator                                      | Coordinator; apply the proposed runbook correction and review a separate migration-free application rollback path                                   |
| R36-RETENTION  | Historical ADR 0012 says restricted objects should not be versioned; R20 now plans versioning with all-version erasure | Privacy/data/storage owners; reconcile the current backup expiry, hold, deletion/tombstone and key-retirement policy before restoring private media |
| R36-CI         | Source inclusion and individual PR successes do not establish combined-source or hosted acceptance                     | Coordinator; retain full final-source check inventory, failures/skips and authenticated artifacts                                                   |

R16's payout/funding and R18's unresolved policy decisions remain unchanged.
No market, currency, price, fee/tax, escrow, payout, identity/work-access or
permission decision is made. Live money remains disabled. A successful restore
must not resurrect erased private evidence or undo a later access revocation.
The approved replay/cutover procedure must reconcile those post-backup facts.

Distinct names alone do not prove isolation: independently verify physical
resource IDs, effective volumes/container names, bucket prefixes, network
routes, cookie domains and DB roles before booting restored processes. No
production rollback, database reset, volume deletion or public media exposure
is authorized by this preflight.
