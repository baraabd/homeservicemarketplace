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
