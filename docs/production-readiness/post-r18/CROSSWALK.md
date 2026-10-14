# Post-R18 numbering crosswalk

Historical labels are kept where they were written. Files, ADRs, commits
and accepted evidence are not renamed. This table maps them to the current
sequence.

| Current ID | Historical alias           | Source of the mapping                                |
| ---------- | -------------------------- | ---------------------------------------------------- |
| R19        | P36, P42 (foundation part) | R19 lane prompt ("Legacy coverage")                  |
| R20–R38    | pending                    | `SPRINT_PLAN.json` not provided; no alias is assumed |

No `P36`–`P50` identifier appears anywhere in the repository's `docs/` at
`059c018` (searched 2026-10-13). The aliases above therefore come only from
the lane prompts.

## Names that look alike but are different

| Label                                                                                      | What it is                                                                                            | Not to be confused with                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| "money Sprint 13" (`docs/money/SPRINT_13_BACKLOG.md`, `sprint-13-acceptance.md`, ADR 0014) | the earlier money and subscription plan, under the old sprint numbering                               | **R13**, durable help and support (`docs/production-readiness/r13/`) |
| R15                                                                                        | ledger foundation (the accounting authority R19 extends)                                              | —                                                                    |
| R16                                                                                        | payouts and withdrawals: **policy-blocked** until its own conditions are met (`r16/PAYOUT_POLICY.md`) | the provider subscription refunds of this sequence                   |
| R18                                                                                        | merged release certification; decision NO-GO                                                          | hosted production approval (not given)                               |
