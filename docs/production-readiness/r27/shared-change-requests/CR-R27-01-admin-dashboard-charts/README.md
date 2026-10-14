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

## Rollback

Revert the commit; no data, contract or flag involved.
