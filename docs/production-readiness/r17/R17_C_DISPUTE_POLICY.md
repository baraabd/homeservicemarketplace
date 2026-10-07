# R17-C — Dispute policy sources

Sprint R17, unit C. Base `develop@a8dc1a2c545805e409b0464d54faa9abb5f6d63a`.

This file records where each dispute rule comes from. It does not create
policy. Classes:

- **CONFIRMED**: an approved source states the rule, or a rule the platform
  already enforces and documents as the product's behavior (accepted sprint
  evidence).
- **APPLIED_ENGINEERING_RULE**: a data-integrity or security rule that follows
  from existing authority, needs no product choice, and was applied by R17-C.
- **DECISION_NEEDED**: a product, privacy or operations owner must decide.
  Nothing guesses a default for it.

Sources: `docs/sprint-12/ADR-12A-sensitive-journeys.md` (status **PROPOSED**,
owners not yet assigned), `docs/sprint-12/workspace/IMPLEMENTATION.md`,
`r15/MONEY_AUTHORITY_MATRIX.md`, `r16/PAYOUT_POLICY.md`,
`R17_B_NOTIFICATION_POLICY.md`, and the source code as cited.

ADR-12A is itself _proposed_, not approved. Where this file says CONFIRMED for
a Sprint 12 rule, it means "implemented, accepted by its sprint's evidence, and
running default-closed behind a policy setting". It does not mean
Product/Security/Privacy sign-off, which ADR-12A says is still required before
release.

## Rules

| #   | Topic                       | Rule in force                                                                                                                                                                                                           | Class                                                               | Source                                                                                       |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| P1  | Who may open (participant)  | The booking's seeker or provider, from the session; never a client-sent actor                                                                                                                                           | CONFIRMED                                                           | ADR-12A threat model; `dispute-intake.service.ts`                                            |
| P2  | Who may open (admin ticket) | The legacy admin route may record a ticket for a booking participant. The opener must be that booking's seeker or provider (R17-C)                                                                                      | APPLIED_ENGINEERING_RULE                                            | C-3; a non-participant opener received notices about someone else's booking                  |
| P3  | Whether admins open at all  | Whether admins may open tickets on a participant's behalf, and with which permission                                                                                                                                    | DECISION_NEEDED                                                     | ADR-12A "legacy authority … release blockers"                                                |
| P4  | Eligible booking states     | From the `disputes.self_service.intake` setting (`allowedBookingStates`); fails closed when unset                                                                                                                       | CONFIRMED (mechanism)                                               | `dispute-intake.policy.ts`; values not seeded anywhere                                       |
| P5  | Intake window               | `terminalWindowHours` in the same setting, measured from the real terminal booking event                                                                                                                                | DECISION_NEEDED (value)                                             | C-6; R16 P6 lists dispute windows as unresolved                                              |
| P6  | One active dispute          | At most one OPEN/IN_REVIEW dispute per booking, across intake and admin tickets (partial unique index)                                                                                                                  | CONFIRMED                                                           | migration `20260917150000_dispute_one_active_per_booking`                                    |
| P7  | Counterparty response       | Statements, information requests and replies inside the workspace, per the frozen policy windows                                                                                                                        | CONFIRMED (mechanism)                                               | Sprint 12C; window values are policy inputs (C-6)                                            |
| P8  | Reviewer assignment         | Fresh `dispute:*` grants from the database per action; participants cannot review their own case; the original decider cannot decide the appeal                                                                         | CONFIRMED                                                           | Sprint 12C; `workspace.repository.ts`                                                        |
| P9  | Legacy admin powers         | `@Roles('admin')` only (no permission)                                                                                                                                                                                  | DECISION_NEEDED                                                     | C-3; ADR-12A; no migration grants `dispute:*` to the admin role                              |
| P10 | Evidence visibility         | Original evidence: its author and reviewers holding `dispute:evidence:view`. Counterparty: only an explicitly shared, scanned, redacted derivative. Whether reviewer access must also require assignment is not decided | CONFIRMED / DECISION_NEEDED                                         | Sprint 12C; C-5                                                                              |
| P11 | Decision intents            | Service remedies and decision records. No money moves; `RESOLVED_REFUND` / `RESOLVED_PARTIAL` are labels for a decision intent                                                                                          | CONFIRMED                                                           | R15 money matrix; R16 blocked; `workspace-resolution.service.ts`                             |
| P12 | Appeal window               | `appealWindowHours` in `disputes.workflow.v1` (frozen per case); one independent appeal                                                                                                                                 | CONFIRMED (mechanism), DECISION_NEEDED (value)                      | Sprint 12C; C-6                                                                              |
| P13 | Reopen                      | No reopen command exists. The legacy PATCH refuses moves out of a terminal state                                                                                                                                        | CONFIRMED (absence)                                                 | `admin-disputes.service.ts`; workspace command list                                          |
| P14 | Closure                     | Assigned reviewer with `dispute:close`, after the appeal window, no open appeal, both fulfilments confirmed                                                                                                             | CONFIRMED                                                           | `workspace-resolution.service.ts close()`                                                    |
| P15 | Participant explanation     | Neutral notices with no narrative; "a recorded outcome does not confirm that money was refunded"                                                                                                                        | CONFIRMED                                                           | `features/disputes/copy.ts`; R17-C applied the same rule to legacy notices and admin labels  |
| P16 | Internal notes              | Legacy `description` is admin-only; participant DTOs never select admin events or before/after JSON                                                                                                                     | CONFIRMED                                                           | ADR-12A; `dispute-intake.repository.ts publicEvents`                                         |
| P17 | Notification preference     | Workspace notices honour `DisputeNotificationPreference`; whether the intake notice also honours it                                                                                                                     | CONFIRMED / DECISION_NEEDED                                         | R17-B decision 6 (B-13)                                                                      |
| P18 | Retention / history         | Private text and evidence erasure per frozen policy; decision facts survive erasure; no DB-level immutability of history rows                                                                                           | CONFIRMED (mechanism), DECISION_NEEDED (DB immutability vs erasure) | ADR-12B; C-4                                                                                 |
| P19 | Audit content               | Audit metadata carries identifiers and enum values, not free text                                                                                                                                                       | APPLIED_ENGINEERING_RULE                                            | `audit.service.ts` allowlist intent; the legacy resolve wrote the free-text resolution (C-4) |
| P20 | Concurrent decisions        | One terminal decision per dispute; the loser gets a 409 and writes nothing                                                                                                                                              | APPLIED_ENGINEERING_RULE                                            | C-1                                                                                          |

## Consolidated owner decision request

R17-C does not need these decisions to ship its fixes. Each one keeps a
release blocker open until it is decided.

1. **Legacy admin authority (P3, P9).** Should legacy admin tickets need a
   fresh permission (for example `dispute:decide`) instead of the `admin` role
   alone? If yes, which roles receive it? Requiring it today would lock out
   every admin, because no migration grants `dispute:*` to the admin role.
   Also: may admins open tickets on a participant's behalf at all?
2. **Evidence access and assignment (C-5, P10).** Must a reviewer be assigned
   to the case to read its original evidence, or is `dispute:evidence:view`
   alone the intended scope?
3. **Windows (C-6, P5, P12).** The intake window, eligible booking states,
   appeal window, request and proposal windows, and resolution target.
   Settings stay unseeded and fail closed until then.
4. **History immutability (C-4, P18).** Enforce append-only workspace events
   and decision records in the database? Erasure currently rewrites cipher
   columns on decision records, so the retention design must be reconciled
   first.
5. **Intake notice opt-out (B-13, P17).** Does the dispute opt-out also cover
   the counterparty's intake notice?

## Not changed by R17-C

No refund, payout, capture, ledger or payment-provider path exists, and none
was added. Historical `RESOLVED_REFUND` / `RESOLVED_PARTIAL` rows are kept as
they are. Only their wording changed.
