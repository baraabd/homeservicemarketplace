# R27 reproducible comparison — current continuation

The measurement workflow executes the same harness against the immutable G1
runtime source and the candidate source on separate disposable GitHub VMs.
Read `docs/production-readiness/r27/ACCEPTANCE.md` for current status, exact
identities, retained artifact digests, failed proposals and ownership.

Download and extract the baseline/candidate artifacts from the same workflow
run, then compare them with the pinned Node version:

```bash
node scripts/perf/post-r18/compare-reports.mjs \
  --baseline /path/to/baseline-artifact \
  --candidate /path/to/candidate-artifact \
  --out-json /path/to/comparison.json
```

The tool rejects mixed source/tree identities within either directory,
mismatched harness/lock/configuration/datasets, duplicate report cells, and
unsupported schemas. It summarizes observed bundle, boot/RSS, query, page-size,
workload and browser metrics. Missing browser projects/modes/repetitions remain
pending, including when some screenshots exist. Build duration is never used
as a page runtime metric, and n<20/n<100 cannot produce p95/p99 respectively.

`check-budgets.mjs` separately evaluates unchanged **proposed** budgets.
A nonzero result must remain a recorded finding until its owner resolves or
explicitly approves the current-source contract. A comparator successfully
writing JSON does not mean the sprint or release is accepted.

Browser setup now clears only the verified disposable runner's hashed
`rl:throttler:default:*` counters before each serial project; ordinary sessions,
registration budgets and other caches remain. The real login limit stays
10/minute, and no reset occurs during measured or overload/recovery flows.
The existing production-policy overload harness still observes natural expiry.

---

## Historical records retained for audit

# Post-R18 performance harness (R27)

Measured evidence for startup, bundle and database performance. Every report
is JSON with its source commit, worktree dirtiness, lockfile hash, toolchain
and host. No report contains secrets, cookies, response bodies or personal
data.

| Harness (`scripts/perf/post-r18/`) | Measures                                                                                                                | Needs                 | Host-independent?                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------ |
| `bundle-report.mjs`                | chunk graph, shell, per-journey increments, library placement (raw / gzip-1 / brotli-11)                                | installed deps        | yes (bytes)                          |
| `api-boot.mjs`                     | spawn → `/health/live` → `/health/ready`, first and repeated public reads, RSS                                          | built API, lane stack | **no** (time)                        |
| `api-boot-profile.mjs`             | V8 sampling profile of one boot, attributed to packages                                                                 | built API, lane stack | shares are indicative, not timings   |
| `query-profile.mjs`                | statements per request, page-size invariance, generic plans, cursor walks, cache headers, cache/authorization negatives | built API, lane stack | counts and plans yes; latency **no** |
| `check-budgets.mjs`                | compares reports with `budgets.proposed.json`                                                                           | reports               | yes                                  |

Browser presented-content timing is **not** re-implemented here. The
existing hosted workflow `Real application startup performance`
(`.github/workflows/startup-performance.yml`,
`apps/web/e2e/startup-performance.real-api.spec.ts`) owns it, and refuses to
run outside a disposable GitHub runner.

## Lane stack

```bash
docker compose -p hsm-r27-perf -f scripts/perf/post-r18/compose.r27.yml up -d --wait
printf 'DATABASE_URL=postgresql://r27:r27-local-only@127.0.0.1:54397/hsm_r27_perf\n' > .env   # worktree-local, gitignored
bash scripts/perf/post-r18/lane-db-reset.sh          # recreate + migrate + seed (lane DB only)
pnpm --filter @homeservicemarketplace/api build
```

The stack uses the containers `hsm-r27-perf-{postgres,redis,mailpit}` on
loopback ports 54397, 63797, 11027 and 18027, and runs the API on port 4027.
`lib/lane-env.mjs` refuses any other database. The API child process
inherits only `PATH` and the system variables Node needs, never the parent
environment. Tear the stack down with
`docker compose -p hsm-r27-perf -f scripts/perf/post-r18/compose.r27.yml down -v`.

## Commands

```bash
node scripts/perf/post-r18/bundle-report.mjs --label baseline --out-json docs/performance/post-r18/bundle-baseline.json
node scripts/perf/post-r18/bundle-report.mjs --label after \
  --overlay apps/web/src/app/components/admin/AdminRouteContent.tsx=docs/production-readiness/r27/shared-change-requests/CR-R27-01-admin-dashboard-charts/AdminRouteContent.tsx \
  --out-json /tmp/after.json
node scripts/perf/post-r18/api-boot.mjs --runs 6 --requests 30 [--profile production|fixture]
node scripts/perf/post-r18/api-boot-profile.mjs
node scripts/perf/post-r18/query-profile.mjs --copies 300      # needs a freshly reset lane DB
node scripts/perf/post-r18/check-budgets.mjs --bundle <bundle.json> --queries <query.json>
node --test scripts/perf/post-r18/lib/lib.test.mjs
```

## Reading the numbers

- **Bundle bytes.** gzip is zlib level 1 (`apps/web/nginx.conf` sets no
  `gzip_comp_level`). brotli-11 is a lower bound for any brotli edge. The
  "shell" is the entry plus `src/bootstrap.tsx`, because `index.html`'s
  2 KiB entry only imports the bootstrap dynamically. A journey's increment
  is what its lazy page adds beyond the shell. A nested boundary (charts,
  address map) is measured beyond its parent page.
- **Statement counts** come from `pg_stat_statements`, reset immediately
  before one request, with all background workers disabled.
  Transaction-control statements are counted separately.
- **Plans** are `EXPLAIN (GENERIC_PLAN)` of the exact statements Prisma sent.
  A generic plan can differ from the custom plan used with real parameters.
  `auto_explain` (≥ 50 ms, with ANALYZE) is enabled in the lane database for
  slow statements.
- **Percentiles** are nearest-rank. p95 is reported only with ≥ 20 samples
  and p99 only with ≥ 100; otherwise only the median is shown.
- **Time on this host is not capacity.** The 2026-10-14 runs shared a
  12-thread i5-12450H / 15.8 GB Windows host with four other lanes. Free
  memory fell to 0.3–1.3 GB, and twice the API could not boot within 90 s.
  Hosted capacity is R37's job.

See `FINDINGS.md` for the measured results and `WORKLOAD_PROFILES.md` for the
R37 load design.
