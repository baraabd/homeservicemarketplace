# CR-01 — `AuditEventType.OUTBOX_DEAD_LETTER_REPLAYED` (schema/migration)

- **Owner:** coordinator (schema and migrations are coordinator-owned; R19
  lane holds the schema this wave).
- **Requested by:** R22 (`feat/r22-worker-outbox-reliability`).
- **Blocks:** execution mode of `OutboxReplayService`. Until applied, replay
  execution refuses with `audit-unavailable` (fail closed); dry-run works.

## Paths and minimal patch

`packages/database/prisma/schema.prisma`: append to `enum AuditEventType`
(order is irrelevant to Postgres; append to avoid diff noise):

```prisma
  // R22 — an operator moved dead-lettered outbox events back to PENDING.
  // Metadata: reason, scope, limit, replayedCount, events[{id, eventType,
  // aggregateType, aggregateId, attemptsBefore, replayed}]. No payloads.
  OUTBOX_DEAD_LETTER_REPLAYED
```

New migration `packages/database/prisma/migrations/<ts>_r22_outbox_replay_audit/migration.sql`:

```sql
-- R22: audit type for authorized outbox dead-letter replay. Additive only.
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'OUTBOX_DEAD_LETTER_REPLAYED';
```

## Consequences

- Additive enum value on PostgreSQL 16. It is safe in a Prisma migration
  transaction as long as the same migration does not use the value, and this
  one does not. Online, no rewrite, no lock beyond a brief catalog lock.
- **Not reversible** by a down migration (Postgres cannot drop enum values).
  Rollback is forward-only: leave the value; unused values are harmless.
- `prisma generate` adds the value to the client union. `OutboxReplayService`
  uses a text-cast raw insert, so it works before and after regeneration.
- CI `prisma migrate diff` must stay empty after both files land together.

## Tests

- `apps/api/test/integration/r22-outbox-replay.integration.spec.ts` in default
  mode asserts the fail-closed refusal. With `R22_APPLY_CR01_IN_TEST=1` it
  applies exactly the statement above (disposable DBs only) and exercises
  execution, the audit row, the rate limit and concurrent replays. After
  CR-01 merges, CI runs the execute path without the flag, because the value
  exists, and the fail-closed test self-skips. Update that `it.skip`
  condition to key on the enum's presence if preferred.
- Evidence (R22 lane): 7/7 execute-path tests passed against a disposable
  PG16 with the statement applied.
