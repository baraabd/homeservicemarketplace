# CR-R27-07 — run the R27 harness unit tests in CI

- **Path:** `.github/workflows/production-governance.yml`, or another existing
  job that already runs `node --test` (coordinator-owned CI).
- **Patch:** add one step:

```yaml
- name: R27 performance harness unit tests
  run: node --test scripts/perf/post-r18/lib/lib.test.mjs
```

The tests are pure, with no database and no build: 17 tests covering chunk
graph closure, attribution, percentiles, budget evaluation, statement
classification and plan walking.

An owner decision follows from this: once the budgets are approved, should
`bundle-report.mjs` plus `check-budgets.mjs --bundle` become a non-blocking
CI job? It needs no services, only one production web build (about 1–2
minutes).
