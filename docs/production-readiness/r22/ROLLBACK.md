# R22 — rollback

R22 ships **no migration, no schema change, no configuration change and no
feature flag**. Everything is code in `infrastructure/outbox`, plus tests,
scripts and docs.

## Code rollback

An owner-authorized rollback may revert the original R22 commit(s) and
redeploy, but reverting the original lease fixes reintroduces their defects:

- **Data shape is unchanged.** R22 writes the same columns with the same
  meanings. `PROCESSED` committed together with effects is indistinguishable
  from the old two-step write.
- **Mixed fleets are not protected against stale writes by old replicas.** An old replica's unfenced
  `markProcessed`/`markFailed` can still overwrite a new replica's result.
  That reintroduces pre-R22 behaviour. New replicas fence their own writes,
  but cannot fence the old code. Domain deduplication still needs validation;
  do not infer safe mixed operation from compatible row shapes.
- **Handler-run markers written by R22** (`ON CONFLICT DO NOTHING`) are the
  same rows the old code writes.
- **Rows released by an R22 shutdown** are plain `PENDING` rows with
  `claimedBy = NULL`.

## Operational rollback of individual behaviours

| Behaviour             | How to neutralise without a revert                                                      |
| --------------------- | --------------------------------------------------------------------------------------- |
| 15 s delivery timeout | Set `OUTBOX_DELIVERY_TX_TIMEOUT_MS=5000` (honoured leniently now; strictly after CR-02) |
| Deadline              | Set `OUTBOX_DELIVERY_DEADLINE_MS` higher (≤ 600000)                                     |
| Shutdown grace        | Set `OUTBOX_SHUTDOWN_GRACE_MS`                                                          |
| Replay                | Do not grant `outbox:replay`; execution also refuses until CR-01                        |

## After CR-01 is integrated

The enum value cannot be dropped. Rolling back R22 code leaves an unused
`AuditEventType` value, which is harmless and forward-only. Existing
`OUTBOX_DEAD_LETTER_REPLAYED` audit rows must be kept; they are history.

## Verification after rollback

- Re-run `outbox.integration.spec.ts` (Sprint 6) on the reverted tree. It
  passes with R22 applied (ACCEPTANCE §2); this lane did not run it on the
  unmodified base.
- `node scripts/production/workers/outbox-health.cjs` is read-only and uses
  only the database package, so it works against either version.

## 2026-10-15 correction only

Prefer a scoped revert of `eec7488c9d2ee506f3b430895d081973a1a74d21` if the
bounded-publication correction causes a regression. This preserves the
original R22 lease, heartbeat, deduplication, replay and shutdown changes.
No migration, dependency, environment or data rollback is needed. Do not
remove markers, rewrite event history, reset attempts or replay PROCESSED
events to recover a missed best-effort callback.

Reverting this correction restores the known risk that a hung callback can
hold the rest of its batch indefinitely. An operator should stop claims and
allow bounded shutdown, inspect queue health, and rerun the owned unit and
real-Postgres reliability suites on the rollback candidate before an
owner-authorized rollout. No rollback, deployment or merge occurred in this
follow-up.
