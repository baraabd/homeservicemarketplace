# CR-R27-01 — load the admin overview charts on demand

- **Path:** `apps/web/src/app/components/admin/AdminRouteContent.tsx` (web, admin surface owner).
- **Patch:** `patch.diff` in this directory (full proposed file: `AdminRouteContent.tsx`).
- **Delivery mode:** A (narrow performance defect); no visual change intended.

## Reason (measured)

`AdminRouteContent` statically imports `DashboardOverview`, the only admin
module that uses recharts. Every admin route — reviews, users, disputes,
identity cases — therefore downloads and parses recharts and its lodash
dependency, and the approval queue on `/admin` cannot render before them.

| Build (059c018, vite 6.4.3)           | `+admin` JS raw | gzip-1 | brotli-11 | recharts in `+admin` |
| ------------------------------------- | --------------- | ------ | --------- | -------------------- |
| baseline                              | 794.2 KiB       | 261.6  | 187.5     | 508.9 KiB rendered   |
| with this CR (overlay build)          | 403.0 KiB       | 139.6  | 99.9      | 0                    |
| charts chunk, loaded only on `/admin` | 393.6 KiB       | 123.8  | 89.6      | 508.9 KiB rendered   |

Source: `docs/performance/post-r18/bundle-baseline.json`,
`bundle-after-cr01-cr02.json` (`--overlay` of this file). These are bytes,
not time. The time effect must come from the hosted startup workflow on the
integrated candidate (see `../../ACCEPTANCE.md`).

## Behaviour

- Non-dashboard admin routes no longer fetch the charts chunk.
- `/admin` renders `ApprovalCenter` immediately; the overview shows the
  existing `AsyncBoundary` loading state (EN/AR copy, `role="status"`,
  reduced-motion-safe pulse) until the chunk arrives.
- If the chunk fails, the existing localized error + reload button replace
  the charts only; the approval queue stays usable.
- No authorization, query or data change. `RequireAdmin` still gates the route.

## Tests to add with the patch (owner)

1. Vitest: render `AdminRouteContent` with `section: 'users'` and assert
   `DashboardOverview`'s module is not requested (mock the dynamic import
   and assert it was not called).
2. Vitest: `section: 'dashboard'` shows `ApprovalCenter` before the lazy
   overview resolves; a rejected import shows the reload alert while the
   approval list is still in the document.
3. Existing admin Playwright specs (`admin-rtl`, `admin-approvals`, admin
   review real-API) must stay green; screenshots of `/admin` may change only
   by the loading state while charts stream in.
4. Re-run `bundle-report.mjs` on the integrated tree and `check-budgets.mjs`
   (`+admin` ≤ 110 KiB brotli, recharts only in `admin-dashboard-charts`).

## Required adjustment to an existing test (observed)

On 2026-10-14 the patch was applied transiently to the R27 worktree, never
committed, and the admin and address suites were run:

```bash
vitest run src/app/components/admin src/app/components/profile/SavedAddressesPage.test.tsx
```

| Tree                                        | Run 1                                                        | Run 2                                                                |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| patched                                     | 80/81 (`DashboardOverview` R17-D currency test failed, 51 s) | 78/81 (2× `DashboardOverview` R17-D, 1× `AdminUsersSection` Suspend) |
| `DashboardOverview.test.tsx` alone, patched | 6/6                                                          | —                                                                    |
| unpatched baseline                          | 80/81 (`AdminUsersSection` self-suspend failed, 14 s)        | —                                                                    |

The host had about 0.8 GB free and four other lanes running.
`AdminUsersSection` fails with or without the patch, so it is host
flakiness. The `DashboardOverview` failures appeared only with the patch.
That test renders the whole `AdminDashboard` and waits with `findByTestId`
(1 s default). With the lazy boundary, Vitest transforms the recharts-heavy
`DashboardOverview` module graph **inside** that wait rather than when the
test file is imported.

The patch must therefore ship with a test change that keeps every
assertion.

**Tried and rejected:** a `beforeAll(async () => { await
import('./DashboardOverview'); })` preload, applied transiently with the
patch. On the same host it ran twice:

- Run 1 still failed 3 tests: 1 in `DashboardOverview`, plus
  `AdminUsersSection` and `AuditLogsSection`, which are unrelated.
- In run 2 the hook itself timed out, and that file's 5 tests were
  **skipped** (76 passed, 5 skipped).

A hook that can skip tests under load is not acceptable.

**Proposed:** a static side-effect import at the top of
`DashboardOverview.test.tsx`. It loads the module when the test file is
imported, exactly as the static import in `AdminRouteContent` did before
the patch. `React.lazy`'s `import()` then resolves from the module cache,
outside every `findBy` wait:

```ts
// Load the lazily rendered overview with the test file, as the route did
// before CR-R27-01, so no test waits on its first module transform.
import './DashboardOverview';
```

This form was **not verified locally**, because the host was starved. Verify
it on hosted CI three consecutive times before accepting. Do not raise
global `findBy` or hook timeouts.

## Rollback

Revert the commit; no data, contract or flag involved.
