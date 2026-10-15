# CR-02 — outbox timing keys in `env.schema.ts`; remove inert `DISPUTE_WORKER_ENABLED`

- **Owner:** coordinator (`apps/api/src/config/*` is global configuration).
- **Requested by:** R22.
- **Blocks:** nothing functional. Until applied, the worker uses code defaults
  and parses the same names leniently through `AppConfigService.get`, which
  falls through to `process.env`. Invalid values fall back to the defaults.

## Minimal patch — `apps/api/src/config/env.schema.ts`

Next to the existing `OUTBOX_*` keys:

```ts
  // R22 — delivery transaction timeout. Prisma's own default (5 s) was the
  // de facto handler limit before R22.
  OUTBOX_DELIVERY_TX_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
  // R22 — worker-side deadline; must exceed the transaction timeout so
  // Prisma's timer normally fires first.
  OUTBOX_DELIVERY_DEADLINE_MS: z.coerce.number().int().min(1_000).max(180_000).default(20_000),
  // R22 — shutdown grace for the in-flight delivery. Keep below the
  // container stop grace period.
  OUTBOX_SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(20_000),
```

Add a cross-field refinement where the schema already does them:
`OUTBOX_DELIVERY_DEADLINE_MS > OUTBOX_DELIVERY_TX_TIMEOUT_MS` and
`OUTBOX_DELIVERY_TX_TIMEOUT_MS < OUTBOX_CLAIM_TIMEOUT_MS`.

Remove line 15:

```ts
  DISPUTE_WORKER_ENABLED: trueish.default(false),
```

It is read by nothing (`git grep DISPUTE_WORKER_ENABLED -- apps/api/src`
returns only this declaration). The worker is governed by
`DISPUTE_WORKER_MODE` (R18 `BLOCKERS.md`). Also drop it from
`docs/production-readiness/FEATURE_INVENTORY.json` (disputes `configuration`
and `flags`, platform `flags`).

## Consequences

- With the keys declared, `this.setting()` in `outbox.worker.ts` receives
  numbers; its lenient parsing can stay or be replaced by `config.get`. That
  is a follow-up in the outbox module, owned by R22 or its successor.
- Removing `DISPUTE_WORKER_ENABLED` changes no behaviour. An environment
  still setting it becomes an unknown key. Check whether `env.schema` is
  strict before removal; if it is, announce the removal in release notes.

## Tests

`apps/api/src/config/env.validation.spec.ts`: defaults, bounds, and the two
refinements. Existing runtime-policy specs are unaffected.
