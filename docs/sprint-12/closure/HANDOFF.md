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
