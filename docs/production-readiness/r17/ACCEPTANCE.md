# R17 — Acceptance tracker

R17 is accepted only when every unit is merged and the combined applicable
R17 acceptance passes on the final integrated develop SHA
(`EXECUTION_PLAN.md`). A set of green unit branches is not that proof.

| Unit  | State                             | Branch / PR                         | Evidence report          |
| ----- | --------------------------------- | ----------------------------------- | ------------------------ |
| R17-A | `R17_A_MERGED` (#142 → `e1f7f51`) | `feat/r17-a-messaging-authority`    | `R17_A_MESSAGING.md`     |
| R17-B | `R17_B_MERGED` (#143 → `7642513`) | `feat/r17-b-notification-authority` | `R17_B_NOTIFICATIONS.md` |
| R17-C | `R17_C_IN_REVIEW` (Draft PR)      | `feat/r17-c-dispute-authority`      | `R17_C_DISPUTES.md`      |
| R17-D | not started                       | —                                   | —                        |
| R17-E | not started                       | —                                   | —                        |

Platform prerequisite PLATFORM-TX-1: merged (#144 → `a8dc1a2`), post-merge
push runs green (`R17_C_DISPUTES.md`, baseline gate).

R17-C open policy decisions (do not block its merge; keep release blockers
open): legacy admin permission, evidence access vs assignment, dispute
windows, database-enforced history, intake-notice opt-out
(`R17_C_DISPUTE_POLICY.md`).

Overall: not accepted. R16 remains `R16_POLICY_BLOCKED` and
`R16_FUNDING_AUTHORITY_BLOCKED`; nothing in R17 closes it.
