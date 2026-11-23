# K09 blocked-input handoff

Each input below is missing at `92770ea65ee1154f94f4251d5febfa39822f9b9a`. None
was invented, assumed or replaced with a default. Inputs are listed in the order
they unblock work. Items 1–3 unblock all authoring. The rest unblock execution.

## A. Start authority (blocks all R36/R37 implementation)

| #   | Input                                                                                                                                                     | Owner                                   | Supplies                                                                                                                                 | Verified by                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | G3 `ACCEPTED` decision with exact-source evidence: the seven mandatory items, including the R29 real Stripe sandbox and the R32 refund-ambiguity recovery | G3 coordinator; owner for refund policy | `gates/g3/SOURCE_MANIFEST.json`: `decision`, `candidateSourceSha/TreeSha`, `frozenBaseSha/TreeSha`, `acceptedSprints`, evidence statuses | `node .github/scripts/g3-record.mjs --check`                                               |
| 2   | Separate owner-reviewed, merged and **verified** G3 publication                                                                                           | Owner                                   | Publication record with `verifiedMerge: true`                                                                                            | Independent publication verification (G1/G2 pattern)                                       |
| 3   | Exact R36 and R37 session assignments on the Wave 4 plan, with `baseSha` set to the frozen G3 source (or a formally approved successor)                   | Wave 4 coordinator                      | `waves/wave-04.plan.json`: `baseSha`, `startableLanes`, per-lane `frozenBaseSha`, `owner.lane`, effective leases                         | `node .github/scripts/g3-record.mjs --ready R36` and `--ready R37` exit 0, unchanged guard |

Until 1–3 exist, the R36/R37 lane files stay unauthored. A K08 candidate,
current develop or the audit SHA `92770ea` is not a substitute base.

## B. R36 recovery execution inputs

| #   | Input                                                                                                                                                                                        | Owner                         | Consumed by                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| 4   | Written authorization for restore resources and tests: approval reference, operator, window and timezone                                                                                     | Infrastructure/spending owner | `restore.cjs` refuses to run without it                 |
| 5   | Source identities (production DB, Redis, buckets) **and** separately provisioned restore identities: DB + user, Redis, buckets, network ID (`isolation.restore.*`, `isolation.production.*`) | Infrastructure owner          | `validate-recovery-set.cjs` overlap check before writes |
| 6   | Retention, legal-hold and deletion/erasure policy, including how post-snapshot deletions and revocations are re-applied                                                                      | Data/privacy owner and legal  | `verify-restored-state.cjs` resurrection checks         |
| 7   | Approved RPO and RTO objectives. Topology values of 300 s / 14,400 s / 7 days are proposals only                                                                                             | Data owner                    | RPO/RTO comparison in R36 ACCEPTANCE                    |
| 8   | Protected key-version references for the object storage keys and the mail envelope key (`MAIL_INTENT_ENCRYPTION_KEY`, or the `JWT_ACCESS_SECRET` version it was derived from; see F-06)      | Secret owner                  | Decryptability proof; wrong/revoked-key negatives       |
| 9   | Immutable prior accepted API/web/migrator image digests with registry provenance                                                                                                             | Release/registry owner        | `rehearse-rollback.cjs`                                 |
| 10  | Decision on the launcher mode that skips migration for application-only rollback (R36 CR-001, F-07)                                                                                          | Coordinator (`staging.cjs`)   | `rehearse-rollback.cjs`                                 |
| 11  | Isolated SMTP, payment and refund sinks with an egress-deny control on the restore network (F-05a/c)                                                                                         | Infrastructure + mail owner   | `restore.cjs` pre-boot assertion                        |

## C. R37 hosted acceptance inputs

| #   | Input                                                                                                                                                                                | Owner                           | Consumed by                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------- |
| 12  | Accepted hosted target (K03 → R28 strict validator exit 0): account, region, host/resource IDs, HTTPS origins, ports, edge/TLS evidence                                              | Infrastructure owner            | `authorize-target.cjs`                 |
| 13  | Signed test authorization record: operator, approver, reference, start/end time with timezone, allowed RPS, connections, total requests/bytes, duration, and an immediate-stop owner | Owner + operator                | `authorize-target.cjs`, `run-load.cjs` |
| 14  | Approved capacity and abort budgets: CPU/memory, error/latency, pool, lag and queue stop thresholds. R27 proposals are not approvals; existing R27 ceilings must not be lowered      | Owner + performance owner       | `run-load.cjs`                         |
| 15  | Per-fault authorization (one API replica, Redis, mail, scanner, provider sandbox): maximum duration and recovery action. R28 currently declares a single API replica                 | Infrastructure owner            | `run-failures.cjs`                     |
| 16  | Real approved alert destination, named responder, approved synthetic incident and permitted alert volume                                                                             | On-call owner                   | `verify-evidence.cjs`                  |
| 17  | Supported real-browser matrix (Chromium only today) and isolated synthetic seeker/provider/admin accounts on the target                                                              | Product owner + R35 coordinator | Hosted browser probes                  |

## D. Integrated acceptance (K10 / R38, after both lanes)

| #   | Input                                                                                                                                                                                                                                               | Owner       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 18  | Reviewed R34–R37 changes joined by the authorized coordinator. The resulting source, tree, images and configuration are frozen, and all required hosted acceptance is rerun on that join. Results from a single lane base are not proof of the join | Coordinator |

## Safest next action

The owner and G3 coordinator close items 1–3. After that, the assigned R36
and R37 sessions start from the frozen base and run their `--ready` guards
unchanged. Only then do they author the twenty allowlisted script/test files,
together with the six conditional infrastructure files. Items 4–17 may be
gathered in parallel, but no hosted command runs until the matching
authorization record exists.
