# Web cold-start dependency discovery

Delivery mode: A (scoped reliability/performance bug fix). No UI redesign.
Baseline: `66e336cb4823802aabacc536584972aa43056d23`.

## Evidence and limits

A user-supplied Windows Chromium trace and Vite debug log at the baseline show:

- Vite ready: 3,608 ms. This is not application-ready time.
- HTML request: HTTP 200, 282.3 ms.
- `/src/main.tsx`: HTTP 200, 12,972.9 ms.
- `/src/bootstrap.tsx`: HTTP 200, 22,089.2 ms.
- The initial dependency scanner took 36,262.04 ms and found 24 entry points.
- 73 network records: 31 HTTP 200, one WebSocket 101 and 41 incomplete records
  (status -1 is trace metadata, not an HTTP error response).
- Ten incomplete records target optimized dependencies, including React,
  React DOM, React Router and TanStack Query.
- The debug log has 510 transform records, including 205 contracts source files.
- No `/v1/` API request and no raw `packages/contracts/dist` browser request was
  recorded before the test closed the page. The screenshot still shows the HTML
  loading state. No application console error or unhandled exception was recorded.

These observations identify excessive cold discovery/transformation work before
first render. They do not establish a deadlock, the eventual load time, disk or
antivirus causation, or anything about Nest bootstrap time. Request and transform
intervals overlap; their durations must NOT be added as independent CPU times.
The trace was captured with debug/tracing enabled, so its numbers are a diagnostic
sample rather than a production performance benchmark.

## Change

The current initial HTML scanner recursively walks the eager application and
contracts barrels to rediscover the same dependency entry points. Seed its 24
observed library imports plus the injected React JSX development runtime in
`optimizeDeps.include`. Set `entries: []` to avoid the up-front application-source
scan. Keep `noDiscovery: false`, so a future import omitted from the seed list is
still discovered and optimized when requested, rather than executing raw CJS.

Keep the contracts alias to TypeScript source and its optimizer exclusion. Do not
replace it with a CommonJS entry. Preserve the explicit `--config vite.config.ts`
commands, strict port, production build checks, recovery UI, dependency versions,
lockfile, authorization, and existing test assertions/timeouts.

This starts pre-bundling known dependencies without waiting for the observed
36-second scan. It does not eliminate dependency bundling or all source transforms,
and does not promise a specific speedup on the user's machine.

## Validation

The existing real Vite resolver test also checks the optimizer configuration,
critical dependency seeds, enabled runtime discovery, and preserved contracts
boundary. Existing startup/recovery and full browser suites remain unchanged.

Run on the final source:

```sh
pnpm install --frozen-lockfile
pnpm --filter @homeservicemarketplace/web lint
pnpm --filter @homeservicemarketplace/web typecheck
pnpm --filter @homeservicemarketplace/web test:ci
pnpm --filter @homeservicemarketplace/web build
pnpm --filter @homeservicemarketplace/web test:startup
pnpm --filter @homeservicemarketplace/web test:dev-startup
```

The production build requires the existing VITE_API_URL configuration. Startup
browser tests use deterministic HTTP fixtures; they do not prove live API flows.
Report CI outcomes separately from the user's local before/after comparison.
Do not mark a configuration assertion as proof of a performance improvement.

## Local comparison and rollback

Use a separate worktree at the PR head; preserve the original project, baseline
worktree and uploaded traces. Run the same startup suite, which deliberately creates
fresh caches and uses `--force`. The positive case must render the real public and
Admin surfaces within its original budget. Compare the scanner/optimizer log and
trace against the baseline, without increasing timeouts or skipping the negative
case. A remaining local failure must be reported, not overridden by a CI pass.

For daily development, use `pnpm --filter @homeservicemarketplace/web dev` after a
successful initial run; reserve `dev:reset` for recovery. Repeated `--force` ignores
the reusable optimizer cache and is intentional only in cold-cache testing.

Rollback is limited to reverting this config change and its associated test; no
migration, data deletion, account change, or environment reset is involved.
