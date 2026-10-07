# R17 — Acceptance tracker

R17 is accepted only when every unit is merged and the combined applicable
R17 acceptance passes on the final integrated develop SHA
(`EXECUTION_PLAN.md`). A set of green unit branches is not that proof.

| Unit  | State                                         | Branch / PR                         | Evidence report             |
| ----- | --------------------------------------------- | ----------------------------------- | --------------------------- |
| R17-A | `R17_A_MERGED` (#142 → `e1f7f51`)             | `feat/r17-a-messaging-authority`    | `R17_A_MESSAGING.md`        |
| R17-B | `R17_B_MERGED` (#143 → `7642513`)             | `feat/r17-b-notification-authority` | `R17_B_NOTIFICATIONS.md`    |
| R17-C | `R17_C_POSTMERGE_ACCEPTED` (#145 → `aaf30aa`) | `feat/r17-c-dispute-authority`      | `R17_C_DISPUTES.md`         |
| R17-D | `R17_D_IN_REVIEW` (Draft PR)                  | `feat/r17-d-admin-operations`       | `R17_D_ADMIN_OPERATIONS.md` |
| R17-E | not started                                   | —                                   | —                           |

Platform prerequisite PLATFORM-TX-1: merged (#144 → `a8dc1a2`), post-merge
push runs green (`R17_C_DISPUTES.md`, baseline gate).

R17-C: PR #145, head `a0a144636a927de380ec4052d55736b99f606c68`, merged as
`aaf30aa0ee53c3a33e08c28226d8c6209df2204c` (tree identical to the head).
Post-merge push runs on `aaf30aa`: CI 37563016555 (17/17 jobs; R17-C 23/23
executed), CodeQL 37563016360, Production governance 37563016305, Web
development startup 37563016285, Authentication lifecycle 37563016304,
Staging release boundary 37563016302 — all success.

Open policy decisions (do not block merges; keep release blockers open):

- R17-C: legacy admin permission, evidence access vs assignment, dispute
  windows, database-enforced history, intake-notice opt-out
  (`R17_C_DISPUTE_POLICY.md`).
- R17-D: last active admin, suspension reason model, structured-policy
  permission, inert settings, money unit, audit read permission
  (`R17_D_ADMIN_POLICY.md`).

Overall: not accepted. R16 remains `R16_POLICY_BLOCKED` and
`R16_FUNDING_AUTHORITY_BLOCKED`; nothing in R17 closes it.
