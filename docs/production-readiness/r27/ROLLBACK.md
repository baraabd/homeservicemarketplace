# R27 continuation rollback — 2026-10-17

The continuation changes only the dedicated browser/performance harness and
its evidence. The measured repair is remote commit
`afec37ae717fbdca91a8e23dd5fc76a1cbd2a703`; the later comparison advisory and
evidence publication are identified in PR #173. Revert the selected continuation
commit through a reviewed PR if needed; this
restores the former test behavior and may restore the Arabic/throttle failure.
Do not reset the assigned branch or undo another lane's work.

The existing R27 runtime repairs can be reverted separately using the earlier
procedure below: restore eager chart/map boundaries, prior optional-Mongo
loading and list-query implementations through their owners. Expect the
measured extra bundle/query work to return; retain authorization, schemas,
financial history and source evidence. There is no migration to roll back.

The new fixture helper contains no deployed runtime path or persistent schema
change. It affects only verified disposable runner counters before project
setup. No production Redis/session rollback or database restoration is needed.
Never flush a shared Redis instance or reset the user's database to reproduce
these tests. Preserve G1's accepted source and independent R16/R18 holds.

---

## Historical records retained for audit

> **Historical continuation note:** R27 resumed from frozen source
> `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` after verified owner merge of #171.
> See `ALLOWLIST.md` and `G1_HANDOFF.json`. The earlier report below is historical
> pre-G1 evidence. Its pending statements describe the earlier snapshot;
> the current measurement and acceptance state are recorded above.

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
