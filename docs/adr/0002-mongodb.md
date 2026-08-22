# ADR 0002 — MongoDB is an optional dependency, disabled by default

- **Status:** Accepted
- **Date:** 2026-08-22
- **Sprint:** 04 (reproducible runtime)
- **Supersedes:** nothing. The original decision to add Mongo was never written down; this ADR is the first record of it.

## Context

`apps/api` opened a MongoDB connection at boot, required `MONGODB_URI` to be
present or the process refused to start, and reported Mongo as a hard
dependency on `/health/ready`. Docker Compose ran a `mongo:7` container to
satisfy it, and CI ran a `mongo:7` service container for the same reason.

Before deciding anything, we searched for what actually reads it.

### The code search

Run from the repository root against `apps/api/src`.

**1. Consumers of the two model tokens, excluding the file that defines them:**

```
$ grep -rn "SERVICE_METADATA_DRAFT_TOKEN\|PROVIDER_PORTFOLIO_DRAFT_TOKEN" \
    apps/api/src --include=*.ts | grep -v "mongo.providers.ts"
(no matches)
```

**2. Every reference to `MongoService` outside `infrastructure/mongo/`:**

```
$ grep -rn "MongoService" apps/api/src --include=*.ts | grep -v "infrastructure/mongo/"
apps/api/src/infrastructure/health/health.service.ts:4:  import { MongoService } ...
apps/api/src/infrastructure/health/health.service.ts:28:   private readonly mongo: MongoService,
apps/api/src/infrastructure/health/health.service.spec.ts  (the test for the above)
```

**3. Every file importing `mongoose`:**

```
$ grep -rln "from 'mongoose'" apps/api/src --include=*.ts
apps/api/src/infrastructure/mongo/mongo.providers.ts
apps/api/src/infrastructure/mongo/mongo.service.ts
apps/api/src/infrastructure/mongo/schemas/provider-portfolio-draft.schema.ts
apps/api/src/infrastructure/mongo/schemas/service-metadata-draft.schema.ts
```

**4. Any use of the exported model types:**

```
$ grep -rn "ServiceMetadataDraftModel\|ProviderPortfolioDraftModel" \
    apps/api/src --include=*.ts | grep -v mongo.providers.ts
(no matches)
```

### What the search establishes

Two schemas exist — `ServiceMetadataDraft` and `ProviderPortfolioDraft` — and
both are wired as DI providers. **Nothing injects either one.** No repository,
service, controller, or job reads or writes a Mongo document anywhere in the
API. Every reference to Mongo outside its own infrastructure folder is the
readiness probe that reports on it.

So the database existed in order to be health-checked. That is not a neutral
state: an unconsumed dependency in the readiness path can only ever _subtract_
availability. A Mongo outage — or simply a `mongo` container that had not
finished starting — returned 503 from `/health/ready` and took the API out of
the load-balancer pool, while every request the API actually serves (all of
which are Postgres- and Redis-backed) would have succeeded.

The same unconsumed dependency also cost a container in Compose, a service
container in three CI jobs, and a required env var in every deployment.

## Decision

**Keep the code, remove the coupling.** Mongo becomes optional and is
**disabled by default**, via a new `MONGODB_ENABLED` flag (default `false`).

When disabled:

- no connection is opened at boot, and no retry budget is spent;
- `MONGODB_URI` is not required — the API boots with the variable absent;
- the model providers resolve to `null` rather than failing module resolution;
- **`/health/ready` does not mention Mongo at all** and does not probe it.

When explicitly enabled (`MONGODB_ENABLED=true`), behaviour is exactly as
before, and `MONGODB_URI` becomes required **at boot**: the env schema rejects
"enabled but unconfigured" via a `superRefine`, so the failure is a startup
error naming the variable rather than a readiness check that silently goes red
some seconds later.

### Why not delete it outright

Deleting was the alternative, and it is a defensible one — the honest summary
of the search is "this is dead code". We kept it because:

1. The two schemas are _drafts_ — `ServiceMetadataDraft`,
   `ProviderPortfolioDraft` — for a document-shaped feature that is planned,
   not abandoned. Deleting them deletes the modelling work and the decision
   record along with it.
2. Disabling removes 100% of the operational harm (the readiness coupling, the
   boot coupling, the containers, the required env var) at a fraction of the
   diff, and the remaining cost is two unreferenced files.
3. Deletion stays available and gets _easier_ from here: with the flag at
   `false` everywhere, deleting the folder is a change no running deployment
   depends on. If the document store is not adopted by the end of the next
   phase, delete it — see "Revisit" below.

What we explicitly rejected is the status quo: leaving a database nothing reads
in the readiness path.

## Consequences

**Good**

- A Mongo outage can no longer make a healthy API instance report not-ready.
- Local bootstrap drops a container; `docker compose up` no longer waits on a
  `mongo` healthcheck to start the API.
- `MONGODB_URI` is no longer required to boot the API.
- The "enabled but unconfigured" misconfiguration now fails loudly at startup.

**Costs / risks**

- Two schema files and their providers are now unreferenced code that still
  compiles and ships. Accepted deliberately; see "Revisit".
- Model consumers must handle `null`, because the type is now
  `Model<T> | null`. This is the honest contract for an optional store, and
  the compiler enforces it — but a future author must not paper over it with
  a non-null assertion. If the store becomes genuinely required for a feature,
  that feature's deployment sets `MONGODB_ENABLED=true` and the _module_
  should assert the model is present at construction time.
- Anyone who was relying on `/health/ready` to tell them Mongo was up no longer
  gets that signal unless they enable the flag. Nothing was relying on it.

## How to enable it

```bash
MONGODB_ENABLED=true
MONGODB_URI=mongodb://mongo:mongo@mongo:27017/?authSource=admin
```

In Docker Compose the `mongo` service now sits behind a profile, so:

```bash
docker compose -f infra/docker/docker-compose.yml --profile app --profile mongo up -d
```

## Revisit

Revisit when either happens:

- **A first real consumer lands.** At that point the flag flips to `true` for
  the environments that need it, and the owning module — not the health check —
  asserts the model is non-null.
- **The end of the next delivery phase arrives with no consumer.** Then delete
  `apps/api/src/infrastructure/mongo/`, the `MONGODB_*` env block, and the
  `mongo` Compose profile, and mark this ADR superseded.
