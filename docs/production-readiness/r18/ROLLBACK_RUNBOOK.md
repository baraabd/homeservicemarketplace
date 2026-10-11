# R18 — Rollback runbook

Not rehearsed: no hosted target (`HOSTED_ENVIRONMENT_BLOCKED`). A rehearsal on
staging is a launch requirement (`GO_NO_GO.md`).

## Application rollback

1. Re-run the launcher with the previous release JSON (the recorded
   rollback digests for API, migrator and web).
2. Do not run the previous migrator: migrations are forward-only and each
   release so far has been additive, so the previous application runs on the
   newer schema.
3. Wait for `/health/ready`; repeat the smoke.
4. Record the time, digests and reason.

## Schema problems

- A migration that failed part-way: stop, keep the application on the
  previous digests, and ship a forward-fix migration. Never edit applied
  migrations or reverse them by hand.
- Data damage: restore to an isolated database first
  (`BACKUP_RESTORE_EVIDENCE.md`), compare, and decide with the owner before
  any production restore.

## Web

The web image is static and hashed per build. Rolling back the image restores
the previous bundle. The app registers no service worker, so no stale worker
cache must be cleared; an open tab picks up the restored bundle on its next
navigation or reload.

## Rehearsal to record

Deploy release N, then N+1, then roll back to N on staging; record each
digest, the elapsed time and the smoke results.
