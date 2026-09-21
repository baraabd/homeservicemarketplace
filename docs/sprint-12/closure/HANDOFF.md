# Sprint 12 closure — handoff

Updated 2026-09-20 after the 12D tabs slice.

---

## 1. Exact state

|                     |                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Branch              | `sprint12/closure-20260920`                                                                             |
| Worktree            | `C:\Users\mohab\hsm-s12`                                                                                |
| Base                | `develop` `8cad7282f12bfb428f3e85402f0dadc6d69ec72b` (re-verified, unmoved)                             |
| Commit              | `65eeff1` — `feat(sprint12d): make the Admin dispute workspace six real tabs`                           |
| Published?          | **No.** Local only. No push, no PR, no merge, no deploy.                                                |
| User's own checkout | `701238c` on `feat/provider-onboarding-v2-phase5-exact-visual-parity` — **untouched**, 4 stashes intact |

Other worktrees left as found: `…-admin-check` (`43bc876`), `hsm-integrate`
(`3b2af99`), `hsmwt` (`a613bbb`).

---

## 2. What this slice changed

Nine files, all under `apps/web/src/app/features/disputes/`:

**New** — `dispute-task-navigation.ts`, `WorkspaceTaskTabs.tsx`,
`WorkspaceOverview.tsx`, `WorkspaceAppeals.tsx`, `workspace-task-tabs.css`,
`tests/admin-workspace-tabs.test.tsx`.

**Modified** — `WorkspacePanel.tsx` (tabs for `admin`, stacked layout preserved
for participants), `WorkspaceSolutions.tsx` (appeals moved out), `copy.ts`
(five EN/AR keys; reused the existing `appeals` label rather than duplicating it).

No API, schema, migration, contract, permission or flag change. Reverting
`65eeff1` is a complete rollback.

---

## 3. Verified in this session

- `typecheck` 0 · `typecheck:e2e` 0 · `lint` 0 errors / 34 pre-existing warnings
- web production build 0 · API build 0 (after `prisma generate`)
- **12/12** new tab tests · **217/217** across 32 dispute + admin files
- Real API on `:4022`: admin and participant workspace endpoints return **401**
  unauthenticated, error envelope leaks no internals
- Served bundle sha1 == built bundle sha1 (`408773c4…`)

Full detail: `TEST_REPORT_AR.md`.

---

## 4. Next executable step (smallest first)

1. **Browser + visual matrix for the tabs.** Blocked only by host memory
   (0.6 GB free of 15.8 at the time). Close Chrome/other consumers, then follow
   `RUNTIME_ACTIVATION_RUNBOOK_AR.md` §1–§4 and run the Admin dispute browser
   spec at widths 320/390/430/768/1024/1440 × EN/AR × light/dark, **foreground,
   `--workers=1`** (background Playwright has been reaped twice on this host).
   Inspect the PNGs; do not accept generated output unseen.
2. **API DB-gated suites** (`RUN_DB_INTEGRATION`) against the isolated stack.
3. **Ask for the 47-point acceptance list.** Until it exists no Sprint 12
   completion figure is computable — see `REQUIREMENTS_MATRIX.md` §0.
4. **Request push authorisation** to get CI's `dispute-workspace` and
   `evidence-retention` real-service jobs onto this source. They cannot run
   locally and no prior SHA's green badge applies to `65eeff1`.

---

## 5. Pending decisions that are not engineering tasks

| Decision                                       | Owner             | Blocks               |
| ---------------------------------------------- | ----------------- | -------------------- |
| The 47 subcriteria                             | Product           | Any completion claim |
| Request-based (non-booking) disputes in scope? | Product           | HSM-DISP-001 closure |
| Statutory reporting window value               | Product + Privacy | Retention defaults   |
| Product/Security/Privacy sign-off              | Those owners      | All activation       |
| Visual/design acceptance of the new tabs       | Design            | 12F                  |

None of these may be assumed, and none was assumed.

---

## 6. Environment left behind

Stopped by me: API `:4022`, preview `:4190` (both mine, stopped to relieve
memory pressure). Still running: the three `hsm-phase2-it-*` containers on
ephemeral ports, holding the migrated + seeded isolated database — keep them if
resuming step 1, or `down` (without `-v`) when finished.

Untouched throughout: `docker-api-1` on `:4000`, `hsm-postgres`, `hsm-redis`,
`hsm-mailpit`, `hsm-mongo`, and the user's `.env`.

---

## 7. Continuation update — 2026-09-20 (unified Admin)

|                   |                                                 |
| ----------------- | ----------------------------------------------- |
| HEAD              | `6155a14` (was `7dfadfa`)                       |
| Remote            | `origin/sprint12/closure-20260920` — **pushed** |
| Draft PR          | **#93** → `develop`, head `6155a14`             |
| CI run            | `35531480334` · CodeQL `35531480187`            |
| Merged / deployed | **No. Neither.**                                |

Added: `DisputeCenterSummary` on the Admin dashboard (four server counts),
cursor-pagination coverage at the real page size of 40, and a product fix to
`ApprovalCenter` (`data?.items?.length`) that removed a white-screen path.

Local on this SHA: typecheck 0, typecheck:e2e 0, lint 0 errors / 34 warnings,
web build 0, **251/251** admin+dispute tests across 37 files.

### Next executable step

1. Read the finished CI jobs on `6155a14` (`admin-review-real-api`,
   `dispute-workspace`, `browser-e2e`, `phase5-visual`, security scans),
   download the Playwright/visual artifacts and **inspect the PNGs**.
2. Human visual + screen-reader acceptance of both Admin surfaces.
3. Supply the 47-point list, or accept that no completion figure exists.
4. Decide merge — not authorised, not performed.

---

## 8. Correction after CI on `0ccad07` — Goal C is NOT delivered

CI found three regressions, all mine. Two are fixed; one killed a feature.

**The Admin dashboard dispute summary has been reverted.** It required
`GET /v1/admin/dispute-workspaces`, which needs a granular `rolePermission` that
not every Admin holds, so every dashboard load emitted a **403** and broke the
"normal Admin entry produces no 4xx" guard. It also overflowed the page
horizontally (14px at 390, 2px at 768) by nesting `.ac-metrics` in an extra
`.ar-card` and using a class (`.ac-header`) that does not exist.

The overflow was a straightforward mistake. The 403 is not: **there is no
server-provided capability signal telling the browser whether this Admin may
read the dispute queue.** `/v1/admin/analytics/overview` carries only
`disputesOpen`, under a different permission scope.

### The smallest correct next step for Goal C

Add a capability to an Admin endpoint the dashboard already calls — e.g.
`canReadDisputeQueue: boolean`, resolved from the same `rolePermission` lookup
`workspace.service.ts` already performs — then render the summary only when it
is true. That is a contract + API + integration-test slice, not a UI tweak, and
it must not be faked by having the client guess.

Until then the dashboard keeps its existing single `disputesOpen` KPI and the
four detailed counts live only in the inbox, which is authorised to ask.

**Goal C (unified Admin dashboard) is therefore PARTIAL, not complete.**

---

## 9. Continuation — accessibility fix (`816a68c`)

CI `35533734443` on `db9f527`: **15 of 16 jobs green.** The two earlier fixes
held — Browser E2E and Admin review real-route both passed. Only the dispute
journey failed, on axe `definition-list` (serious) in the Overview fact list:
`dl element has direct children that are not allowed: div > p`.

Fixed by moving Source/Recorded inside the `<dd>` and restoring `cw-facts`.
Guarded by `workspace-overview-semantics.test.tsx`, proven by mutation.
Dispute suite counts at the time: **31 tests, 30 passed, 1 failed**.

No open-handle warning exists in that run; `--forceExit` was not used.

### Still true, and not to be softened

- The Admin dashboard dispute summary is **REVERTED**, blocked by the missing
  server capability signal. Goal C stays **PARTIAL**. See §8.
- **No human has inspected a screenshot.** Visual acceptance is NOT_RUN.
- The 47-point list remains absent; no completion percentage anywhere.
- Product / Security / Privacy approvals: not sought, not granted.

---

## 10. Final state — CI fully green

|                    |                                                        |
| ------------------ | ------------------------------------------------------ |
| HEAD at full green | `ad5f1f99395b6da75221496b0c9566887da66775`             |
| CI                 | `35569900436` — **17/17 SUCCESS**, including `CI gate` |
| CodeQL             | `35569900141` — **SUCCESS**                            |
| PR #93             | open, **Draft**, base `develop`                        |
| Merged / deployed  | **No. Neither.**                                       |

Four regressions were found by CI and fixed at their cause, plus one found by
opening a screenshot:

1. Horizontal overflow on the Admin dashboard (390/768).
2. A 403 on every Admin dashboard load — feature **withdrawn**, see §8.
3. Private statement hidden behind a tab — journey drives the real control.
4. axe `definition-list` (serious) — provenance moved inside the `dd`.
5. Tab labels broken mid-word at 320–639px, worst in Arabic — one column below
   640px. **No automated gate caught this one.**

A sixth was found and fixed in the API: closure took two clock reads, so the
retention deadline drifted from the `closedAt` it is measured from.

### What is still NOT done

- **Human visual acceptance: NOT_RUN.** Dark themes, 430/1024/1440 and 200%
  zoom were never opened; no screen-reader pass.
- **Goal C: PARTIAL.** The dashboard dispute summary stays reverted pending a
  server capability signal (§8).
- The 47-point list is still absent; no completion percentage is claimed.
- Product / Security / Privacy approvals: not sought, not granted.
