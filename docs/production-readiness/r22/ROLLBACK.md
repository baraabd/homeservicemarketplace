# R22 — rollback

R22 ships **no migration, no schema change, no configuration change and no
feature flag**. Everything is code in `infrastructure/outbox`, plus tests,
scripts and docs.

## Code rollback

Revert the R22 commit(s) on `develop` and redeploy. This is safe in both
directions and at any time:

- **Data shape is unchanged.** R22 writes the same columns with the same
  meanings. `PROCESSED` committed together with effects is indistinguishable
  from the old two-step write.
- **Mixed fleets during a rolling deploy are safe.** An old replica's unfenced
  `markProcessed`/`markFailed` can still overwrite a new replica's result.
  That is the pre-R22 behaviour, no worse. New replicas never overwrite old
  ones' leases. Markers keep effects exactly-once in both versions.
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
