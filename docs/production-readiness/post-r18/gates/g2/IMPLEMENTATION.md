# G2 — Integrated Wave 2 remediation

## Scope and authority

The owner delegated complete G2 coordination and repairs for one review pull request on 2026-10-17. The assigned branch is `chore/g2-wave2-acceptance`. Actual start: `4e87bf03663fb3c72ffee983fdb70c2863e1ce8a`, tree `eaca9cdeab15e719570f7997c4fc3bbeb64e562e`. The checkout is isolated and Mode A applies. Exact leases were recorded in `OWNERSHIP.md` before edits. This work prepares review; it performs no merge, deployment or live activation.

G1 remains the accepted immutable runtime source `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` with owner-merged publication #171. Historical G1 source, evidence and Wave 2 start records are retained. Actual implementation progress is reconciled in nested registry execution records; the historical READY_TO_START field does not masquerade as current acceptance.

## Confirmed missing behavior

The four implementation PRs were owner-merged, but the actual combined `develop` run 39062646647 failed R25 browser acceptance and its R18/CI aggregates. The R25 preview's green tree predates integration of R24; it cannot certify the combined tree. Its sanitized artifact proves 13 real API cases passed and the browser command failed. A clean local reproduction first exposed UTC/session-timezone OTP rejection. A second unchanged-source run with UTC database parity reached multi-tab recovery and observed two toasts for one booking transition. These are precise local findings, not invented unpublished remote diagnostics.

The initial combined source had no R28 checked plan. During this task the owner published Draft #179; the initial twelve-file R28 import from 60b64cd8216294d7476a7a22607ee56feb18dec4 (including the descriptor-bound reader correction after the original e91c checkpoint) is the single selected delivery in this coordinator candidate. Its configuration-only alternative retains the explicit hosted blocker. R27 retained concrete private-cache, representative completed-booking/index and budget-decision requests. The current refund API lacked a separate transaction-bound confirmed-result participant needed by future R32 policy integration. No canonical G2/Wave 3 records existed, and R32's supplied package was still reserved.

## Implemented source slices

| Slice                              | Result and boundary                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G2 validation                      | Separate additive G2/Wave 3 validator; six evidence categories, exact source/tree, canonical files, single writers, held missing packages, earlier-wave dependencies, and no start without owner-merged publication. G1 semantics are preserved.                                    |
| Money contract                     | Additive confirmed-refund participant with required caller transaction and unavailable default; MoneyModule registration/export, fail-closed test and compile-time consumers of actual R24 ports. No R32 orchestration executes here.                                               |
| R28 plans                          | Strict offline topology/edge/input validation reusing the existing staging release contract; redacted fingerprint and precise hosted/input holds. No resource selection, apply command, secret read or hosted claim.                                                                |
| R27 private HTTP                   | Early private/no-store default covers ordinary private results and parser/guard errors while explicit public immutable media behavior retains precedence. Real candidate-only browser tests exercise cross-tab logout and live authority revocation.                                |
| R27 representative financial reads | Guarded completion plus completed/deleted/tied-date amplification, full financial page truth and actual generic/bound Prisma plans support one additive Booking index. Budgets remain unchanged until owner decision. See acceptance evidence for executed results and limitations. |
| Governance CI                      | Production governance and the existing Linux/Windows staging controls execute R28; staging artifacts retain the configuration report and source SHA. API-only prepared stop grace is 30s for the 20s default worker grace; hosted settings remain unverified.                       |
| Coordinator records                | Reconcile actual PRs/merge identities; freeze no untested source; retain R32 full prompt, exact conditional future ownership, requirements, risks, rollback and publication hold.                                                                                                   |

## Toolchain and evidence isolation

The repository pins Node 24.21.0 and pnpm 10.32.1. The frozen install ran its original runtime/prepare hooks. Task-local executable downloads were checked against the official Node checksum and the packageManager pnpm integrity value. The initial incomplete executable and sandbox subprocess/cache failures were recorded and resolved; no hook or test was bypassed. Separate worktrees use independent generated clients, dependencies, builds and caches.

Local PostgreSQL 16, authenticated Redis 7 and Mailpit 1.31.6 use this task's own loopback service identity. Occupied ports were refused before creation. Credentials, OTPs, raw browser output and storage stay private. Only fixed summaries, source identities, counts and approved screenshots are publication evidence. R27's full Docker-identity-checked harness must execute on its actual verified stack; a separate direct database experiment is not substituted for it.

## Integration boundary

Prior-wave dependencies remain the owner-merged source. Same-wave R28 is integrated from the twelve exact peer #179 blobs under coordinator ownership; its remote branch/PR is unchanged. Parallel #178 remains a historical blocked closeout with an incompatible alternative record schema, so useful observations are reconciled here without installing two competing canonical validators. No R29/R30/R31 implementation is consumed. The G2 catalog freezes existing callable ports and documents their transaction, uncertainty and composition rules. G2 does not implement the deferred R32 refund outbox dispatcher, query-first recovery, eligibility policy or confirmed-result orchestration. Those begin only after the owner-approved G2 publication supplies a full frozen SHA and a new clean R32 worktree.

Final source/tree, command results, runtime summaries and remote check identities are in `SOURCE_MANIFEST.json` and `ACCEPTANCE_EVIDENCE.json`. Their states control the gate; this narrative is not independent proof of acceptance.

## Published-source follow-up

The exact peer runtime remains unchanged after official CodeQL passed on PR #180. One coordinator-owned R28 test fixture is made portable after Windows could not complete its rename over an opened file. The fixture continues to prove actual descriptor/path mismatch, rejection before reads and exact descriptor closure. Three compile-time idempotency examples are individually reviewed under the existing historical secret-baseline policy and replaced with generated identifiers; security rules, scan scope and blocking exits remain intact. Exact source/result identities remain in acceptance evidence.
