# CR-03 — seed the `outbox:replay` permission (no role grant)

- **Owner:** coordinator (`packages/database/src/seed.ts`; the seed is a
  global baseline guarded by the `seed` advisory lock in tests).
- **Requested by:** R22.
- **Blocks:** any real replay. `OutboxReplayService` requires an ACTIVE user
  holding `outbox:replay`.

## Minimal patch

In the permission list in `packages/database/src/seed.ts`, alongside the
other `key: 'resource:action'` entries:

```ts
  { key: 'outbox:replay', description: 'Replay dead-lettered outbox events (audited, rate-limited)' },
```

**Do not** add it to any role mapping. Granting it to a role or user is an
account/permission grant that needs separate owner authorization. Recommended
owner decision: a dedicated `operations` role with named members, not
`admin`.

## Consequences

- `seed-idempotency.spec.ts` asserts table-wide counts of seeded rows. Its
  expected permission count increases by one.
- No migration. The `Permission` table already exists.

## Tests

`seed-idempotency.spec.ts` (count update). The R22 replay suite creates the
permission itself if absent and removes it only if it created it, so it
passes before and after this CR.
