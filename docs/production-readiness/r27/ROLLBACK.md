> **Current G1 continuation:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Current implementation/integration is IN_PROGRESS and is
> not accepted. Fresh baseline CI and required browser evidence are pending.

# R27 — Rollback

## This branch

R27 adds files only under `scripts/perf/post-r18/`,
`docs/performance/post-r18/` and `docs/production-readiness/r27/`. Nothing
imports them, and no application, route, schema, CI or configuration file
changed. To roll back:

- before merge, close the PR;
- after merge, revert the R27 commits.

Neither affects runtime behaviour.

## Lane resources

```bash
# Stop and remove the lane's own containers and anonymous volumes only.
docker compose -p hsm-r27-perf -f scripts/perf/post-r18/compose.r27.yml down -v
# Worktree-local, gitignored lane env file.
rm .env
```

Never run `down -v` with another project name, and never touch `hsm-postgres`
or `hsm-redis`, which are the developer stack.

## Change requests

Each CR's `README.md` states its own rollback:

- **CR-01, 02, 03, 05, 08:** revert, with no data involved.
- **CR-04:** remove the middleware.
- **CR-06:** a forward migration that drops the index.
- **CR-07:** remove the CI step.
