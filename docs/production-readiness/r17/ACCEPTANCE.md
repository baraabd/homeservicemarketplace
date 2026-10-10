# R17 — Acceptance tracker

R17 is accepted only when every unit is merged and the combined applicable
R17 acceptance passes on the final integrated develop SHA
(`EXECUTION_PLAN.md`). A set of green unit branches is not that proof.

| Unit            | State                                                                     | Branch / PR                             | Evidence report              |
| --------------- | ------------------------------------------------------------------------- | --------------------------------------- | ---------------------------- |
| R17-A           | `R17_A_MERGED` (#142 → `e1f7f51`)                                         | `feat/r17-a-messaging-authority`        | `R17_A_MESSAGING.md`         |
| R17-B           | `R17_B_MERGED` (#143 → `7642513`)                                         | `feat/r17-b-notification-authority`     | `R17_B_NOTIFICATIONS.md`     |
| R17-C           | `R17_C_POSTMERGE_ACCEPTED` (#145 → `aaf30aa`)                             | `feat/r17-c-dispute-authority`          | `R17_C_DISPUTES.md`          |
| R17-D           | `R17_D_POSTMERGE_ACCEPTED` (#146 → `2710d25`)                             | `feat/r17-d-admin-operations`           | `R17_D_ADMIN_OPERATIONS.md`  |
| R17-E           | `R17_E_POSTMERGE_ACCEPTED` (#147 → `489541a`, follow-up #148 → `cc2dff1`) | `feat/r17-e-provider-surface-authority` | `R17_E_PROVIDER_SURFACES.md` |
| R17-E follow-up | `R17_E_FOLLOW_UP_POSTMERGE_ACCEPTED` (#148 → `cc2dff1`)                   | `fix/r17-e-postmerge-closure`           | `R17_E_POSTMERGE_CLOSURE.md` |

Platform prerequisite PLATFORM-TX-1: merged (#144 → `a8dc1a2`), post-merge
push runs green (`R17_C_DISPUTES.md`, baseline gate).

R17-C: PR #145, head `a0a144636a927de380ec4052d55736b99f606c68`, merged as
`aaf30aa0ee53c3a33e08c28226d8c6209df2204c` (tree identical to the head).
Post-merge push runs on `aaf30aa`: CI 37563016555 (17/17 jobs; R17-C 23/23
executed), CodeQL 37563016360, Production governance 37563016305, Web
development startup 37563016285, Authentication lifecycle 37563016304,
Staging release boundary 37563016302 — all success.

R17-D: PR #146, head `9126a3221c`, merged as
`2710d259f5d798a4d7c47eed656743362f6975c6`. Post-merge push runs on `2710d25`
(verified 2026-10-09 for R17-E's baseline gate): CI 37717935824 (17/17 jobs),
CodeQL 37717935459, Production governance 37717935503, Web development
startup 37717935521, Authentication lifecycle 37717935461, Staging release
boundary 37717935502 — all success. The R17-D review observations that still
reproduce are recorded as carry-over in `R17_E_PROVIDER_SURFACES.md`.

R17-E: PR #147, head `6a371991c593cd2093b1feae8cf6c25cfec24397`, merged as
`489541ad6bf4c001091ecdf8be07f6871ac7af45` (merge commit, tree identical to the
head). Post-merge push runs on `489541a`: CI 37986992524 (17/17 jobs; R17-E
31/31, R17-C 23/23, R17-D 14/14 executed; Integration & E2E 5550 passed, 36
skipped), CodeQL 37986992340, Production governance 37986992342, Web
development startup 37986992295, Authentication lifecycle 37986992315,
Staging release boundary 37986992353 — all success. Accepted with two open
follow-ups (bookings pagination, E-13), both reproduced on `489541a` and
repaired in #148, which is not merged. The R17-E state becomes
`R17_E_POSTMERGE_ACCEPTED` only after #148 merges and its post-merge gate
passes.

R17-E follow-up: PR #148, head `a633c82d122b090f36d7b3831b39f3cd4d599b17`,
merged as `cc2dff103112c524e1d13f73ee92d1608db61410` (tree identical to the
head). Post-merge push runs on `cc2dff1`: CI 38051847277 (17/17 jobs; R17-E
44/44 — 31 R17-E plus 13 closure — R17-C 23/23, R17-D 14/14 executed;
Integration & E2E 5573 passed, 37 skipped, every skipped suite executed in
its own job of the run; R17-A 4/4 and R17-B 5/5 in the Phase 5 real-route
job), CodeQL 38051846991, Production governance 38051847026, Web development
startup 38051846999, Authentication lifecycle 38051846988, Staging release
boundary 38051847059 — all success. R17-E is `R17_E_POSTMERGE_ACCEPTED`.

Open policy decisions (do not block merges; keep release blockers open):

- R17-C: legacy admin permission, evidence access vs assignment, dispute
  windows, database-enforced history, intake-notice opt-out
  (`R17_C_DISPUTE_POLICY.md`).
- R17-D: last active admin, suspension reason model, structured-policy
  permission, inert settings, money unit, audit read permission
  (`R17_D_ADMIN_POLICY.md`).
- R17-E: custom-text requests, pending bids after a capability loss, booking
  obligations after lapsed access or suspension, recognition (badges, "Top
  Pro"), money unit, deactivated categories, and (post-merge) whether a
  request whose category changed is re-announced (`R17_E_PROVIDER_POLICY.md`).

Overall: `R17_INTEGRATED_ACCEPTED` on `develop@cc2dff1` (recorded in R18
Phase 0, `docs/production-readiness/r18/ACCEPTANCE.md`). Every unit is merged
and its acceptance executed on that one source in hosted CI run 38051847277:
R17-A, R17-B, R17-C, R17-D, R17-E with its closure, and PLATFORM-TX-1
(`platform-transaction-commit.integration.spec.ts` in Integration & E2E).
This is hosted evidence; the combined suite was not re-run on this
low-memory Windows host. It certifies engineering acceptance, not the open
policy decisions above, and not E-18 (My Bids), which is repaired separately
in #149. R16 remains `R16_POLICY_BLOCKED` and
`R16_FUNDING_AUTHORITY_BLOCKED`; nothing in R17 closes it.
