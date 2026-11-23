# K01 — Windows dev-startup failure (run 41093704442)

Mode A. Scope: `apps/web/startup-tests/startup.spec.ts` only. Application code,
`vite.config.ts` and `optimizeDeps` are unchanged.

## Reported failure

`Web development startup` on develop `92770ea6`, job
`Dev browser startup (windows-latest)` (124193868765). Five tests passed. The
test _real pnpm dev renders public and Admin routes_ failed in
`admin-en-desktop`:

1. `/admin` rendered `admin-approval-center`.
2. Clicking _Review applications_ rendered `admin-review-directory`; the
   screenshot was captured.
3. `page.reload()` on `/admin/reviews` stayed on _Loading the page…_ for 30 s,
   with `page errors: []`.

Linux passed. The run kept no network, console or optimizer evidence. The dev
log shows only `vite … ready in 536 ms`.

History: one failure of this signature in about 40 `web-startup` runs, so it
was intermittent. The earlier failure `40036523101` was a different test.

## What the stall is

The screenshot shows the route-level `AsyncBoundary` fallback with no admin
shell. For `/admin/*` the only lazy boundary is
`lazyPage(() => import('./pages/AdminPage'))` (`src/app/routes.ts`). React keeps
the fallback while that dynamic `import()` neither resolves nor rejects. A
rejected import would render _The page could not load_. In Vite dev, that
means at least one module request in the `AdminPage` graph never completed.

## Local Windows reproduction (same symptom)

With failure diagnostics added (unfinished requests, failed requests, console
problems, `DEBUG=vite:deps`), three local runs on this Windows host stalled
on _Loading the page_. Each time, the only open requests were pre-bundled
dependency modules, for example
`/node_modules/.vite/deps/react-dom_client.js?v=…`.

The optimizer log explains why. `--force` re-bundles every `optimizeDeps.include`
entry on start, and Vite holds every `/node_modules/.vite/deps/*` request until
that bundle commits.

| Measurement (local Windows, `--force`)   | Value                 |
| ---------------------------------------- | --------------------- |
| `index.html` first answered              | 17 s                  |
| `/node_modules/.vite/deps/react.js` held | 160.6 s, then 200     |
| `vite:deps Dependencies bundled in`      | 75.2 s – 170.3 s      |
| Non-optimized dep URL                    | 404 at once (no hold) |

`serve()` counted the first `index.html` 200 as ready. The 30 s route
assertion therefore spent its whole budget waiting on the optimizer.

## Hypothesis tested and rejected

`optimizeDeps.entries: []` disables the up-front scan. Any bare import missing
from `include` would therefore be discovered at runtime and force a full,
request-holding re-bundle. A probe of the exact journey (`/` → `/admin` →
_Review applications_ → reload) under `DEBUG=vite:deps` logged **no** runtime
discovery. The reload rendered in about 2 s once the first bundle had
committed. `optimizeDeps` was therefore not changed.

## Fix

- `serve()` treats a dev server as ready only when it serves a pre-bundled
  module (`/node_modules/.vite/deps/react.js` → 200). It polls that held
  request within a separate, named cold-start budget
  (`DEV_DEPENDENCY_OPTIMIZER_BUDGET_MS`, 240 s) and attaches the measured
  readiness. Route assertions keep their 30 s expectation. The production
  preview is unaffected.
- The three dev-server tests set `DEV_TEST_TIMEOUT_MS` (180 s plus that budget)
  for this phase only. The suite's `globalTimeout` and expect timeouts are
  unchanged. Nothing is inflated globally.
- On failure, the real `pnpm dev` test records unfinished and failed requests,
  console problems and the `vite:deps` optimizer log.

## Evidence

| Where                              | Result         | Readiness (HTML → deps served)                             |
| ---------------------------------- | -------------- | ---------------------------------------------------------- |
| Local Windows, before fix (3 runs) | 0/3 dev passes | stalled; only `.vite/deps` requests open                   |
| Local Windows, after fix           | 6/6 passed     | legacy 35.6 → 104.1 s; fixed 7.3 → 15.2 s; r02 2.2 → 5.4 s |
| Hosted windows-latest, `02bd845b`  | 6/6 passed     | legacy 0.96 → 4.4 s; fixed 2.3 → 4.1 s; r02 2.1 → 3.3 s    |
| Hosted ubuntu-latest, `02bd845b`   | 6/6 passed     | legacy 0.41 → 1.3 s; fixed 0.88 → 1.3 s; r02 0.90 → 1.2 s  |

Repeated hosted runs on the final SHA are listed in [JOB_LEDGER.md](JOB_LEDGER.md).

## Honest status

- **Fixed:** a dev server counted as ready while it still held every
  dependency request. That reproduces the same symptom deterministically on
  slow Windows hosts.
- **Not proven:** the root cause of the single hosted stall. Hosted Windows
  optimizes in about 2–3.5 s, and that stall began about 10 s into a session
  whose earlier routes had rendered. Cold optimization is therefore an
  unlikely explanation for it. A recurrence will now record the open requests
  and optimizer activity instead of ending as a bare locator timeout.
- This is a development-server startup defect in a test harness. It is not
  a production crash; the production-preview test passes on both systems.
