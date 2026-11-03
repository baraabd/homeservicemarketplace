# K06: administrator authority, restricted media, moderation, support and dispute readiness

**Status: PARTIAL.** Three defects in K06's scope are fixed and verified locally
against real PostgreSQL, Redis, the built API and the built SPA. The rest of
the admin estate was checked against the sprint's failure cases, and its
existing controls hold. Launch acceptance is **blocked** on inputs this lane
does not own: K02 policy, K03 hosted staging and K05's identity method. See
[BLOCKED_INPUTS.md](BLOCKED_INPUTS.md).

This record keeps five statuses separate:

| Status      | Value                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Implemented | Yes, for the changes listed below                                                                    |
| Tested      | Locally: real Postgres 16 / Redis 7 / Mailpit, built API, built SPA, Chromium. Hosted CI: see the PR |
| Accepted    | **No.** Staging acceptance by two synthetic administrators needs K03; policy acceptance needs K02    |
| Merged      | **No.** Draft PR only                                                                                |
| Deployed    | **No**                                                                                               |

## Base and branch

| Item              | Value                                                                                                                                                                                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base              | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306` (identical to the audit reference)                                                                                                     |
| Branch            | `release/ksa-k06-admin-operations` (coordinator-style K branch; it does not replace any R34–R38 lane)                                                                                                                                               |
| Code SHA verified | `49d7ba2e3974592ffe1d9b669bd61785009b70c4`, tree `f1e284732e23f4c230a5c4b29e85b867d39b04f5`. Runtime and gated evidence ran at `6be58f44`; the only later code commit adds one web test file. The docs commit that follows changes only this folder |
| Migration head    | `20261103090000_k06_support_ticket_experience` (75 migrations)                                                                                                                                                                                      |
| Toolchain         | Node 24.21.0, pnpm 10.32.1, frozen lockfile, Prisma 6.12.0                                                                                                                                                                                          |
| K01/K02/K03       | Not accepted. K01, K02 and K04 are uncommitted worktrees on `92770ea6`; K03 is 2 commits ahead, unpushed (`e4458df3`); there is no K02 branch on origin. K06 therefore started from develop and did only K02/K03-independent work                   |

## Delivery modes

- **Mode A**: admin authority defects (stale `admin` claim; self-decision on legacy provider actions), test isolation and
  boundary tests for restricted evidence and dispute pilot scope.
- **Mode C**: support notifications and routed support.
- **Local UI fixes, not Mode B**: on the support surfaces those features
  touch (provider status screen, `/home/support`, `/provider/support`,
  dispute "not enabled" notice). No other surface was redesigned.

## What changed

| Commit     | Change                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bbaf5d23` | Formatting only, for two files that predate the formatter (verified byte-identical after whitespace normalisation), plus one pre-existing type-only import lint error                                                                                                  |
| `ffd72bd3` | **Security fix.** Admin routes that trusted the token's `admin` claim now require **live** admin membership (`CurrentAdminGuard`, fresh `admin:access:grant`, in-transaction check for settings writes)                                                                |
| `d50b263f` | Support: requester notifications for reply, close and reopen; `SupportTicket.experience`; `/home/support` and `/provider/support`; "Contact support" on denied provider states and on the dispute "not enabled" notice; localized timestamps; readable desktop measure |
| `7a28ac1a` | Real-DB tests for two K06 claims that had none: an audit outage reveals no evidence bytes, and an enabled dispute policy is still a bounded pilot                                                                                                                      |
| `c715e81b` | Support header controls stay at 44×44 at 320 px. The journey now asserts 44×44 at every width                                                                                                                                                                          |
| `efc54092` | **Security fix.** Legacy `/admin/providers/:id` approve, reject, suspend and reactivate refuse the profile's own user (403 `SELF_REVIEW`)                                                                                                                              |
| `6be58f44` | Scope `CurrentAdminGuard` on that controller to its five mutating routes (reads already use fresh `user:read:any`); repair the e2e spec's DI                                                                                                                           |
| `49d7ba2e` | Test: the dispute not-enabled notice links to the participant's support route (EN/AR)                                                                                                                                                                                  |

### Defect 1: a removed administrator could still act (critical)

`RolesGuard` reads `admin` from the access token. Granting admin revokes the
applicant's sessions, but **no API path removes the role**, so a removal made
out of band (operator or database) left the old token valid for up to
`JWT_ACCESS_TTL_SECONDS` (600 s by default). Reproduced over the real
`AppModule` with a real password/OTP session. With its membership deleted, the
token:

- **approved an admin access request (HTTP 200), minting a new administrator**;
- wrote platform settings, including the dispute-intake pilot policy.

The same claim-only authority covered catalog, service-area policy and the
legacy dispute desk. All are now refused on the next request. Fresh-permission
surfaces (users, provider review, evidence, support, portfolio, reviews,
dispute workspace, money) were already correct and are unchanged.

### Defect 2: an administrator could decide their own provider profile (critical)

The review workspace refuses `SELF_REVIEW`, but the legacy provider actions
never compared the actor with the profile owner. Their approve is live while
`VERIFICATION_ENFORCED` and `WORK_ACCESS_ENFORCED` are off, which are the env
defaults. Reproduced over the real `AppModule`: an administrator holding a
`PENDING_REVIEW` provider profile **approved it themselves (HTTP 200)**. Reject,
suspend and reactivate had the same gap. All four now refuse inside the
decision's own transaction.

### Defect 3: support could not reach people and people could not reach support

R13 left notifications out of scope, so a requester learned of a reply or
closure only by revisiting the screen. Every provider denied state, and the
dispute "not enabled" notice, said "contact support" but offered no way to do
so. Support existed only as view state inside the customer Profile tab, with
no URL.

## Launch scope statement (disputes)

**Public dispute intake is not ready and is not certified here.** The
implemented intake is a bounded pilot: `disputes.self_service.intake` must be a
valid, enabled policy with a 1–500 user allowlist, and everyone else gets
`NOT_ENABLED`. No policy is seeded, so intake is closed by default. K02 has
approved neither public intake nor its eligibility windows, so no rollout
model was added. A denied participant now gets a working route to support.

## Files in this record

- [ISSUE_TEST_MATRIX.md](ISSUE_TEST_MATRIX.md): every sprint requirement mapped to its control, test and result, plus the permission matrix and audit assertions
- [BLOCKED_INPUTS.md](BLOCKED_INPUTS.md): concrete handoff for K02, K03 and K05 inputs
- [OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md): how administrators operate these surfaces safely
- [ROLLBACK.md](ROLLBACK.md): rollback and forward repair
- [evidence/COMMANDS.md](evidence/COMMANDS.md): exact commands, exit codes and counts
- [evidence/VISUAL_REVIEW.md](evidence/VISUAL_REVIEW.md): inspected screenshots and findings
