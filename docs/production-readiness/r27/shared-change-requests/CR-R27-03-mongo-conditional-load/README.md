# CR-R27-03 — do not load mongoose when MongoDB is disabled

- **Paths:** `apps/api/src/infrastructure/mongo/mongo.service.ts`,
  `apps/api/src/infrastructure/mongo/schemas/*.ts`,
  `apps/api/src/infrastructure/mongo/mongo.providers.ts` (API infrastructure owner);
  possibly `apps/api/src/app.module.ts` (coordinator-owned).
- **State:** proposal. The after-state has **not** been measured.

## Reason (measured)

One production-profile boot of `apps/api/dist/main.js` under V8's sampling
profiler (`docs/performance/post-r18/api-boot-profile.json`, 2 ms interval):

- About 92% of busy CPU time before `/health/ready` is CommonJS module
  loading (resolve, read, compile).
- `mongoose` and `mongodb` together are charged about 12.7% of busy time
  (487 ms + 400 ms of 6,958 ms under the profiler), although
  `MONGODB_ENABLED` defaults to `false` and the service never connects.
- The cause is that `mongo.service.ts` and both schemas import `mongoose`
  at module scope.

The profiler slows the boot about 1.9× (7.8 s against about 4.1 s ready), so
the saving in a normal boot is expected to be smaller than 887 ms. No number
is claimed until `api-boot.mjs` measures it.

## Proposed change (outline; the owner chooses the form)

Keep `MongoService`'s public contract. Load mongoose with a dynamic
`import('mongoose')` inside `connect()`, reached only when `MONGODB_ENABLED`
is true. Build the two schemas from factory functions that the model
providers call only when Mongo is enabled. The providers already return
`null` when Mongo is disabled.

## Tests

- Existing `mongo.service.spec.ts` stays green, including the
  disabled-connect error.
- New: with `MONGODB_ENABLED=false`, loading the built `app.module` leaves
  `mongoose` out of `require.cache`.
- `api-boot.mjs --runs 6` before and after on the same hosted runner class.

## Rollback

Revert; there is no persistence change.
