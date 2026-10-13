# CR-04 — CI: run the R22 process suite and the worker CLI tests

- **Owner:** coordinator (`.github/workflows/*` is coordinator-owned).
- **Requested by:** R22.
- **Blocks:** hosted evidence for the two-process crash suite. The in-process
  R22 suites (`r22-outbox-reliability`, `r22-outbox-replay`) need **no** CI
  change: they are gated on `RUN_DB_INTEGRATION=1`, which the existing gated
  job already sets.

## Minimal patch — `.github/workflows/ci.yml`

1. In the job that runs the DB/Redis-gated API suite, after
   `Seed baseline roles / permissions`, build the API (the process suite runs
   the compiled worker, like the dispute worker suite) and run it:

```yaml
- name: Build API for worker-process suites
  run: pnpm --filter @homeservicemarketplace/api build
- name: R22 outbox worker processes (two real processes, kill/restart)
  working-directory: apps/api
  env:
    RUN_R22_WORKER_PROCESS: '1'
  run: npx jest --runInBand test/integration/r22-outbox-process.integration.spec.ts
```

Place it after the main `pnpm --filter @homeservicemarketplace/api test` step,
so its child workers never share the queue with the parallel run.

2. In the job that runs `node --test` for repository scripts, add:

```yaml
- name: R22 worker CLIs
  run: node --test scripts/production/workers/outbox-replay.test.cjs
```

## Consequences

About 40 s extra on Linux. The suite sends SIGTERM on Linux and IPC on
Windows; CI therefore exercises the real signal path.

## Tests

The step is the test. Local evidence: 3/3 passed on Windows (IPC shutdown).
