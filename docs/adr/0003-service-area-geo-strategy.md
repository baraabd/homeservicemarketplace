# ADR 0003 — Service-area matching: bounded Haversine, not PostGIS

- **Status:** Accepted
- **Date:** 2026-08-22
- **Sprint:** 06

## Context

`ProviderProfile.serviceAreaRadiusKm` has existed since Sprint 5. Onboarding
requires it, the profile API returns it, and **nothing filters on it.** Provider
matching is city-string equality; the radius is decorative.

What the code actually does today:

| Surface                                            | Filter                            | Distance                                        |
| -------------------------------------------------- | --------------------------------- | ----------------------------------------------- |
| `GET /v1/provider/available-requests` (list)       | `addressSnapshot->>'cityKey' = ?` | computed in JS **after** the query, for display |
| `GET /v1/provider/available-requests/:id` (detail) | same                              | same                                            |
| request-created fan-out                            | `serviceAreaCity ILIKE ?`         | not computed                                    |

Three call sites, three hand-rolled filters, one unused column. A provider who
sets a 5 km radius gets every job in the city; a provider 2 km away across a
municipal boundary gets nothing.

Two facts constrain the fix:

1. **Request coordinates are not columns.** They live inside
   `ServiceRequest.addressSnapshot`, a `jsonb` blob. The city filter is a JSON
   path equality, which no index serves — every feed page is a sequential scan
   of the whole table. Any geo strategy needs the coordinates promoted to real
   columns first, so that work is a prerequisite of both options, not a
   tiebreaker between them.
2. **PostGIS is not installed.** Postgres runs as `postgres:16-alpine` in
   Compose and as a service container in three CI jobs.

## Options

### A. PostGIS — `geography(Point,4326)` + GiST + `ST_DWithin`

Correct on the ellipsoid, indexes the radius predicate directly, and gives
KNN ordering (`<->`) and polygon service areas for free.

Costs, all of them infrastructural:

- The image changes to `postgis/postgis:16-*` in Compose **and** in every CI
  job that starts a Postgres service container, **and** in every deployment
  target. Managed Postgres offerings vary in whether the extension is
  available and on what version.
- `CREATE EXTENSION postgis` needs superuser on first run — an install-time
  privilege the migration job (which runs as an ordinary application role) is
  deliberately not granted.
- Prisma 5 has no native `geography` type. The column becomes
  `Unsupported("geography")`, which Prisma can create but cannot read or write
  — every read and write through raw SQL, and the generated client stops being
  the single description of the row.
- The shadow-database drift gate in CI would need the extension too.

### B. Bounded Haversine — promoted `double precision` columns + B-tree

A bounding box in plain SQL narrows the candidate set using an ordinary
composite index, then exact Haversine filters the remainder:

```sql
WHERE "locationLat" BETWEEN :minLat AND :maxLat      -- index range scan
  AND "locationLng" BETWEEN :minLng AND :maxLng      -- index range scan
  AND 6371 * acos(least(1, greatest(-1,              -- exact, on survivors
        sin(radians(:lat)) * sin(radians("locationLat"))
      + cos(radians(:lat)) * cos(radians("locationLat"))
      * cos(radians("locationLng") - radians(:lng))))) <= :radiusKm
```

The box is a **prefilter, never the answer** — it over-selects the corners of
the square, and the Haversine term removes them. Ordinary B-tree indexes serve
it, Prisma models the columns natively, and no image anywhere changes.

Costs: spherical-earth error (~0.3% worst case, metres at these radii, against
a radius a human typed as a round number); no KNN ordering; the meridian and
poles need explicit handling.

## Decision

**Option B — bounded Haversine.**

The deciding factor is not accuracy, it is that PostGIS's price is paid in
infrastructure this repo would have to change in five places and re-verify,
to buy precision that a user-entered "25 km" does not have in the first place.

Expected data size supports it. This is a pre-launch marketplace: the feed
query is already scoped by `status = 'OPEN_FOR_BIDS'`, `deletedAt IS NULL`,
and a category set, so the bounding box runs against _open requests in the
provider's categories_ — thousands, not the whole table, for a long time yet.
A B-tree range scan over that is not the bottleneck at any volume this
product will see before it can afford a dedicated geo story.

### Scope of the decision

- Coordinates are promoted to `ServiceRequest.locationLat/locationLng/
locationCityKey` and mirrored on `ProviderProfile.serviceAreaCityKey`,
  backfilled from existing data in the same migration. **This part would have
  been required by PostGIS too.**
- One predicate module — `apps/api/src/shared/geo/service-area.ts` — is the
  only place that knows the matching rule. List, detail, and fan-out all call
  it. The three-way drift above is what made the radius silently dead.

### Semantics (the part that is a product decision, not a maths one)

| Provider               | Request   | Behaviour                                                                                                                                                                   |
| ---------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lat/lng + radius       | lat/lng   | **Radius.** City is _not_ additionally required — a job 3 km away in the next municipality matches, which is the entire point.                                              |
| lat/lng + radius       | no coords | **City fallback.** Include when the city keys match. A seeker's address failing to geocode must not make their job invisible; the provider sees it with `distanceKm: null`. |
| no coords or no radius | either    | **City fallback.** Preserves exactly today's behaviour for providers who have not set a service-area centre, so this change cannot narrow anyone's feed.                    |
| no city and no coords  | —         | **Invisible**, and logged. Nothing can match it; silence here would be a black hole.                                                                                        |

The fallback direction is deliberate: every ambiguous case resolves toward
_showing_ the job. A false positive costs a provider one glance; a false
negative costs a seeker a bid they never knew they missed.

## Consequences

**Good** — the radius column finally does something; the feed's city filter
becomes indexable (it was a seq scan); one predicate replaces three; the
matching rule is unit-testable without a database.

**Costs / risks**

- Two sources of location on `ServiceRequest` (snapshot JSON + columns). The
  columns are written by the same code that writes the snapshot, and the
  repository is the only writer. A raw-SQL insert bypassing it would desync
  them; there is no such call site today.
- `acos` runs per surviving row. Bounded by the box, so it scales with
  _candidates_, not table size.
- Providers with a small radius will see **fewer** jobs than before. That is
  the intended correction, not a regression — but it is a visible behaviour
  change and belongs in release notes.
- Antimeridian (±180°) crossings are handled by splitting the longitude range;
  near-polar boxes clamp latitude and widen longitude to the full range. Both
  are tested. No service area in this market is near either, but a wrong
  answer there would be silent.

## Revisit

Move to PostGIS when any of these becomes true:

- Non-circular service areas (drawn polygons, postcode sets) are needed.
- "Nearest N providers" ordering is needed — Haversine cannot use an index for
  ordering, only for filtering, and `ORDER BY distance LIMIT n` degrades to a
  full sort of the candidate set.
- The bounding box stops being selective — a single metro with >1M concurrent
  open requests, or a `EXPLAIN` showing the box scan dominating feed latency.

The promoted columns are what make that migration cheap: adding a `geography`
column generated from `locationLat`/`locationLng` is an additive change, and
the predicate module is the one place that would have to learn the new SQL.
