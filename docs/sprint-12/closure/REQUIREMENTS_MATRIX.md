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
