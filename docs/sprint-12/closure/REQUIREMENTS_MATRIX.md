# Sprint 12 — requirements matrix

Prepared 2026-09-20 against `develop` `8cad7282f12bfb428f3e85402f0dadc6d69ec72b`
on branch `sprint12/closure-20260920`, worktree `C:\Users\mohab\hsm-s12`.

Statuses are **PASS**, **FAIL**, **BLOCKED**, **NOT_RUN**, and they are applied
separately to implementation, verification, visual acceptance and activation. A
merged PR and a green badge are recorded as what they are — evidence about a
past source — and never as acceptance of a criterion.

---

## 0. Source gap that bounds this whole document

`docs/sprint-12/README.md:4` is the only place in the repository that mentions
the **"whole 47-point sprint"**. The 47 subcriteria themselves are not in this
checkout: there is no backlog file, issue export, acceptance list or ADR that
enumerates them.

```
$ git grep -n "47" origin/develop -- 'docs/**/*.md' | grep -iE "47[- ]?(point|criteri|item)"
origin/develop:docs/sprint-12/README.md:4:12A intake/tracking implementation, not the whole 47-point sprint.
```

**This is a source gap, not an empty set.** This matrix therefore tracks the
five HSM tickets and the 12A–12F slices that the repository _does_ define, and
does not invent a denominator. Any claim of the form "N of 47 complete" is
unsupported until the authoritative list is supplied.

**Owner action required:** provide the 47-point acceptance list (issue tracker
export or equivalent). Until then no completion percentage for Sprint 12 can be
computed, and none appears in these documents.

---

## 1. Ticket-level status

| ID           | Authoritative source                  | Expected                                                                                                                    | Current implementation                                                                                 | Gap                                                                                                                            | Status                                                          |
| ------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| HSM-KYC-001  | `README.md` §1                        | Versioned verification cases, restricted upload/read, scanner, decisions, expiry                                            | Present on `develop` since before this sprint                                                          | Full lifecycle revalidation never executed as an acceptance run                                                                | Impl PASS (pre-existing) · Verification NOT_RUN                 |
| HSM-KYC-002  | `README.md` §1, `ADR-12B`             | Finalized-evidence retention/erasure, independent worker, deletion verification, derivatives, retries, dead-letter, metrics | `workspace-private-lifecycle.service.ts`, `dispute-maintenance.worker.js`, `evidence-retention` CI job | Backup/restore suppression, account-wide erasure, orphan/temporary KYC object inventory explicitly out of the merged increment | Impl PARTIAL · Verification BLOCKED (needs real-service CI)     |
| HSM-DISP-001 | `README.md` §2–§3                     | Participant intake, eligibility, structured issue, durable reference, truthful server drafts                                | `dispute-intake.*`, `workspace-drafts.service.ts`, `/disputes` route                                   | Request-based (non-booking) disputes unconfirmed against backlog — see §3                                                      | Impl PASS for booking intake · Non-booking BLOCKED (source gap) |
| HSM-DISP-002 | `README.md` §6.3, `IMPLEMENTATION.md` | Central authority, granular permissions, assignment, sourced facts, immutable decisions, **tabbed Admin workspace**         | Domain merged in #92; **tabs delivered in this branch (`65eeff1`)**                                    | Real-browser + visual acceptance of the new tabs                                                                               | Impl PASS · Verification PARTIAL · Visual BLOCKED               |
| HSM-DISP-003 | `README.md` §6.4                      | Independent appeals, different reviewer, preserved original/superseding decisions                                           | `workspace-appeals.service.ts`; appeals now own an Admin tab                                           | End-to-end appeal journey not exercised in this session                                                                        | Impl PASS (per #92) · Verification NOT_RUN                      |

---

## 2. Slice-level status

| Slice | Expected                                          | Owning files                                                                                                                                                       | Test IDs                                                                                                               | Status this session                                                        |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 12A   | Intake + truthful encrypted drafts                | `apps/api/src/modules/disputes/dispute-intake.*`, `workspace-drafts.service.ts`, `usePrivateDraft.ts`                                                              | `use-private-draft.test.tsx`, `private-draft-queue.test.ts`, `dispute-intake.integration.spec.ts`                      | Impl PASS (merged) · Re-verification NOT_RUN                               |
| 12B   | KYC/private-data lifecycle, worker, erasure proof | `workspace-private-lifecycle.service.ts`, `workspace-maintenance.service.ts`, `dispute-maintenance.worker.ts`                                                      | `dispute-private-lifecycle.integration.spec.ts`, `dispute-worker-process.integration.spec.ts`, CI `evidence-retention` | Impl PARTIAL · Verification BLOCKED                                        |
| 12C   | Evidence, collaboration, notifications            | `workspace-evidence.service.ts`, `workspace-requests.service.ts`, `workspace-events.*`                                                                             | `dispute-workspace.integration.spec.ts`, `evidence-read-boundary.integration.spec.ts`                                  | Impl PASS (merged) · Re-verification NOT_RUN                               |
| 12D   | Central authority **+ tabbed Admin workspace**    | `workspace-commands.service.ts`, `workspace.policy.ts`, **`WorkspaceTaskTabs.tsx`, `dispute-task-navigation.ts`, `WorkspaceOverview.tsx`, `WorkspaceAppeals.tsx`** | **`admin-workspace-tabs.test.tsx` (12)**, `admin-inbox-route.test.tsx`                                                 | **Tabs: Impl PASS, route-level Verification PASS, browser/visual BLOCKED** |
| 12E   | Independent appeals                               | `workspace-appeals.service.ts`                                                                                                                                     | `dispute-decision-boundaries.integration.spec.ts`                                                                      | Impl PASS (merged) · Verification NOT_RUN                                  |
| 12F   | UX + operational acceptance                       | whole surface                                                                                                                                                      | Playwright + axe suites                                                                                                | **BLOCKED — host memory** (see §4)                                         |

---

## 3. Open product/source questions (not engineering blockers)

1. **The 47-point list** — §0. Blocks any completion denominator.
2. **Request-based (non-booking) disputes** — `README.md` §6 says intake alone
   "does not deliver request-based (non-booking) disputes". Whether that is in
   Sprint 12 scope cannot be decided from this checkout. Do not assume either
   way; the subject model differs materially.
3. **Statutory reporting window** — `README.md` §4: "No statutory reporting
   window is asserted: the product/privacy owners must approve this value."
   Still unapproved. Retention values remain policy inputs, not defaults.
4. **Product/Security/Privacy approvals** — never obtained. No code change can
   substitute; recorded as an external dependency, not a task.

---

## 4. Environment limitation affecting 12F

Browser, visual and responsive acceptance did not run. The host had **0.6 GB of
15.8 GB physical memory free** when the browser stage was reached, and the
harness had already reaped a Playwright run for memory pressure earlier in the
session. Chromium was not launched rather than produce an unreliable result.

This is an environment limitation, explicitly **not**:

- a failing assertion,
- a missing implementation,
- evidence that the tabs do or do not render correctly in a browser.

The smallest next action is in `HANDOFF.md` §4.

---

## 5. Admin completion — five separate statuses per item

Added 2026-09-20 for the unified-Admin continuation, head `6155a14`, Draft PR #93.

Columns, never collapsed into one "done":
**IMPL** = implementation · **AUTO** = automated verification ·
**BROWSER** = real Chromium · **VISUAL** = a human inspected it ·
**PROD** = production activation.

### 5.1 Provider approvals

| Item                            | IMPL | AUTO | BROWSER    | VISUAL  | PROD    |
| ------------------------------- | ---- | ---- | ---------- | ------- | ------- |
| Review queue                    | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Basics & Identity               | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Services & Experience           | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Work Area                       | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Working Hours                   | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Portfolio                       | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Review & Submission             | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Correction workflow             | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Approval + persistence          | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Work access separation          | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |
| Stale-confirmation safety (#90) | PASS | PASS | PENDING_CI | NOT_RUN | BLOCKED |

These were delivered by #89/#90 and are **unchanged by this branch**. The AUTO
column is this session's 251-test admin run; BROWSER is CI's
`admin-review-real-api` job on `6155a14`.

### 5.2 Dispute resolution

| Item                    | IMPL           | AUTO                    | BROWSER    | VISUAL  | PROD    |
| ----------------------- | -------------- | ----------------------- | ---------- | ------- | ------- |
| Inbox                   | PASS           | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| **Six true tabs**       | **PASS (new)** | **PASS (12 tests)**     | PENDING_CI | NOT_RUN | BLOCKED |
| Overview / source facts | PASS (new)     | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| Information             | PASS           | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| Evidence                | PASS           | NOT_RUN                 | PENDING_CI | NOT_RUN | BLOCKED |
| Solutions / decisions   | PASS           | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| Appeals (own tab)       | PASS (new)     | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| History                 | PASS           | PASS                    | PENDING_CI | NOT_RUN | BLOCKED |
| Assignment / deadlines  | PASS           | NOT_RUN                 | PENDING_CI | NOT_RUN | BLOCKED |
| Real scanner lifecycle  | PASS           | NOT_RUN                 | PENDING_CI | NOT_RUN | BLOCKED |
| Retention / privacy     | PARTIAL        | NOT_RUN                 | PENDING_CI | NOT_RUN | BLOCKED |
| Pagination past page 1  | PASS           | **PASS (real size 40)** | PENDING_CI | NOT_RUN | BLOCKED |

### 5.3 Unified Admin navigation

| Item                                  | IMPL                | AUTO               | BROWSER    | VISUAL  | PROD    |
| ------------------------------------- | ------------------- | ------------------ | ---------- | ------- | ------- |
| One Admin shell, nine sections        | PASS (pre-existing) | PASS               | PENDING_CI | NOT_RUN | BLOCKED |
| Provider approval centre on dashboard | PASS (pre-existing) | PASS               | PENDING_CI | NOT_RUN | BLOCKED |
| **Dispute summary on dashboard**      | **PASS (new)**      | **PASS (5 tests)** | PENDING_CI | NOT_RUN | BLOCKED |
| Server-authoritative counts           | PASS                | PASS               | PENDING_CI | NOT_RUN | BLOCKED |
| Shared design language                | PASS                | PASS               | PENDING_CI | NOT_RUN | BLOCKED |
| EN/AR + light/dark                    | PASS                | PASS (jsdom)       | PENDING_CI | NOT_RUN | BLOCKED |

**PENDING_CI** means the job exists and was triggered on this exact SHA; it is
not a pass. **VISUAL is NOT_RUN everywhere** — no human has inspected this
surface, and no screenshot may be cited as acceptance until one has.
