# Post-R18 active status index

## Current G2 closeout — 2026-10-17

**G2 BLOCKED; Wave 3 is not authorized to start.** See
[`gates/g2/SOURCE_MANIFEST.json`](gates/g2/SOURCE_MANIFEST.json),
[`waves/wave-02.closeout.json`](waves/wave-02.closeout.json) and
[`gates/g2/BLOCKERS.md`](gates/g2/BLOCKERS.md). R24 #176, R25 #175, R26 #174
and R27 #173 are merged; R28 source/evidence was not found. The integrated
R25 browser command and its dependent CI gates failed on the inspected SHA.
The exact R29 reservation in `waves/wave-03.plan.json` is conditional only.

## Historical G1 start authorization

The table below mirrors the canonical registry and describes its retained G1
start state, not current execution completion. The synchronized lifecycle
transition remains an explicit G2 CR-001; no acceptance is inferred from this table.

Authority: `SPRINT_REGISTRY.json`. Reconciled by G1 on 2026-10-16.
G1 technical source is **ACCEPTED** at `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`.
PR #171 is owner-merged at `0568739096ceeaf0cfc79034626886e258fe4328` and its publication identity is verified. Wave 2 is READY_TO_START under its exact ownership manifest.
Historical R18 release NO-GO remains separate. Unnumbered PR #156 is merged.

| ID  | Title                                                                              | Wave | Status                   | Branch                             | PR   |
| --- | ---------------------------------------------------------------------------------- | ---- | ------------------------ | ---------------------------------- | ---- |
| R19 | Extend and certify the existing money authority; freeze shared financial contracts | 1    | SANDBOX_ACCEPTED         | feat/r19-money-authority-contracts | #159 |
| R20 | Production storage, private media authorization and persistence                    | 1    | SANDBOX_ACCEPTED         | feat/r20-storage-production        | #161 |
| R21 | Production email delivery and durable feedback                                     | 1    | SANDBOX_ACCEPTED         | feat/r21-email-production          | #160 |
| R22 | Outbox and worker execution reliability                                            | 1    | SANDBOX_ACCEPTED         | feat/r22-worker-outbox-reliability | #158 |
| R23 | Observability, privacy-safe diagnostics and incident detection                     | 1    | SANDBOX_ACCEPTED         | feat/r23-observability-incidents   | #163 |
| R24 | Money application API and module wiring; freeze adapter integration boundaries     | 2    | READY_TO_START           | feat/r24-money-api-integration     | —    |
| R25 | Realtime multi-instance activation and reconnect recovery                          | 2    | READY_TO_START           | feat/r25-realtime-multi-instance   | —    |
| R26 | Application security and effective authorization hardening                         | 2    | READY_TO_START           | feat/r26-application-security      | #174 |
| R27 | Measured startup, bundle and database performance                                  | 2    | READY_TO_START           | feat/r27-performance-capacity      | #162 |
| R28 | Authorized hosted topology, infrastructure and release inputs                      | 2    | READY_TO_START           | feat/r28-hosted-platform           | —    |
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

Wave 1 `SANDBOX_ACCEPTED` covers the certified integrated technical boundaries and disposable real services. Hosted, policy and release decisions remain separate.
Wave 2 `READY_TO_START` releases the verified G1 prerequisite; it does not claim implementation or acceptance. R27 provisional PR #162 was merged before G1; it is not accepted Wave 2 delivery.
R29–R38 remain reserved in this bounded G1 task. See `gates/g1/DECISION.md` and `waves/WAVE_02.md`.

R26 PR #174 was subsequently merged. Its historical G1 ownership remains in the
manifest; current Wave 2 closeout is recorded above, separately from that start grant.
