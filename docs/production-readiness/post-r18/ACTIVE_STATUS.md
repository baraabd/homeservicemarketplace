# Post-R18 active status index

Authority: `SPRINT_REGISTRY.json`. Reconciled by G1 on 2026-10-16.
G1 source is **ACCEPTED**, pending owner review/merge of its separate publication.
Wave 2 frozen base: `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`; no lane is startable yet.
Historical R18 release NO-GO remains separate. Unnumbered PR #156 is merged.

| ID  | Title                                                                              | Wave | Status                   | Branch                             | PR   |
| --- | ---------------------------------------------------------------------------------- | ---- | ------------------------ | ---------------------------------- | ---- |
| R19 | Extend and certify the existing money authority; freeze shared financial contracts | 1    | SANDBOX_ACCEPTED         | feat/r19-money-authority-contracts | #159 |
| R20 | Production storage, private media authorization and persistence                    | 1    | SANDBOX_ACCEPTED         | feat/r20-storage-production        | #161 |
| R21 | Production email delivery and durable feedback                                     | 1    | SANDBOX_ACCEPTED         | feat/r21-email-production          | #160 |
| R22 | Outbox and worker execution reliability                                            | 1    | SANDBOX_ACCEPTED         | feat/r22-worker-outbox-reliability | #158 |
| R23 | Observability, privacy-safe diagnostics and incident detection                     | 1    | SANDBOX_ACCEPTED         | feat/r23-observability-incidents   | #163 |
| R24 | Money application API and module wiring; freeze adapter integration boundaries     | 2    | PLANNED                  | feat/r24-money-api-integration     | —    |
| R25 | Realtime multi-instance activation and reconnect recovery                          | 2    | PLANNED                  | feat/r25-realtime-multi-instance   | —    |
| R26 | Application security and effective authorization hardening                         | 2    | PLANNED                  | feat/r26-application-security      | —    |
| R27 | Measured startup, bundle and database performance                                  | 2    | PLANNED                  | feat/r27-performance-capacity      | #162 |
| R28 | Authorized hosted topology, infrastructure and release inputs                      | 2    | PLANNED                  | feat/r28-hosted-platform           | —    |
| R29 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R30 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R31 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R32 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R33 | (pending package)                                                                  | 3    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R34 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R35 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R36 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R37 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |
| R38 | (pending package)                                                                  | 4    | RESERVED_PENDING_PACKAGE | —                                  | —    |

Wave 1 `SANDBOX_ACCEPTED` covers the exact merged source and disposable-service evidence; it is not hosted or release acceptance.
Wave 2 `PLANNED` describes reviewed preparation with an assigned source, held until owner-merged G1 publication is verified. R27 provisional PR #162 was merged before G1; it is not accepted Wave 2 delivery.
R29–R38 remain reserved in this bounded G1 task. See `gates/g1/DECISION.md` and `waves/WAVE_02.md`.
