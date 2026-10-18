# Post-R18 active status index

Authority: `SPRINT_REGISTRY.json`. G2 reconciliation on 2026-10-17.
G1 remains accepted and owner-published at its immutable frozen source. G2 is **BLOCKED** on integrated candidate evidence and the measured R27 performance decision. No Wave 3 lane starts from this review record.

| ID  | Title                                                                              | Wave | Status                   | Branch                             | PR   |
| --- | ---------------------------------------------------------------------------------- | ---- | ------------------------ | ---------------------------------- | ---- |
| R19 | Extend and certify the existing money authority; freeze shared financial contracts | 1    | SANDBOX_ACCEPTED         | feat/r19-money-authority-contracts | #159 |
| R20 | Production storage, private media authorization and persistence                    | 1    | SANDBOX_ACCEPTED         | feat/r20-storage-production        | #161 |
| R21 | Production email delivery and durable feedback                                     | 1    | SANDBOX_ACCEPTED         | feat/r21-email-production          | #160 |
| R22 | Outbox and worker execution reliability                                            | 1    | SANDBOX_ACCEPTED         | feat/r22-worker-outbox-reliability | #158 |
| R23 | Observability, privacy-safe diagnostics and incident detection                     | 1    | SANDBOX_ACCEPTED         | feat/r23-observability-incidents   | #163 |
| R24 | Money application API and module wiring; freeze adapter integration boundaries     | 2    | READY_TO_START           | feat/r24-money-api-integration     | #176 |
| R25 | Realtime multi-instance activation and reconnect recovery                          | 2    | READY_TO_START           | feat/r25-realtime-multi-instance   | #175 |
| R26 | Application security and effective authorization hardening                         | 2    | READY_TO_START           | feat/r26-application-security      | #174 |
| R27 | Measured startup, bundle and database performance                                  | 2    | READY_TO_START           | feat/r27-performance-capacity      | #173 |
| R28 | Authorized hosted topology, infrastructure and release inputs                      | 2    | READY_TO_START           | feat/r28-hosted-platform           | #179 |
| R29 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R30 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R31 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R32 | Refund eligibility, reservations and ambiguous-outcome recovery                    | 3    | PLANNED                  | feat/r32-refund-recovery           | —    |
| R33 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R34 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R35 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R36 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R37 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R38 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |

## Current execution and acceptance

Wave 1 `SANDBOX_ACCEPTED` retains G1 scope. Wave 2 `READY_TO_START` is the historical G1 start contract, not its present implementation state; `execution` now records owner-merged R24 #176, R25 #175, R26 #174 and R27 #173. Their integrated G2 acceptance remains separate. R27 #162 is historical pre-G1 source, superseded for current delivery by #173.

R28 Draft #179 supplies the selected checked platform/edge delivery. Its twelve files were imported exactly at the initial G2 source; PR #180 adds one coordinator-owned portable test-fixture correction, while the runtime reader and eleven other peer files remain unchanged. Coordinator CI/shutdown integration has separate exact leases. Parallel G2 Draft #178 remains a historical blocked closeout record and is not merged or overwritten. The absent hosting/registry/DNS/secrets/spend approvals remain `HOSTED_ENVIRONMENT_BLOCKED`. Local configuration validation cannot establish hosting or release acceptance.

R32 is `PLANNED` from the exact supplied full prompt, with a null frozen base and held proposed ownership. R29/R30/R31/R33 and Wave 4 retain their unprovided-package reservations. Their shorthand scope notes are not invented authoritative titles or executable assignments.

See `gates/g2/SOURCE_MANIFEST.json`, `gates/g2/OWNERSHIP.md` and `waves/WAVE_03.md`. R16/R18 live-money, payout, verification and release holds remain unchanged. No merge or deployment is performed.
