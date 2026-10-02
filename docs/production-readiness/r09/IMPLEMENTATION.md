# R09 — Work area, map and marketplace geo authority

Status: **IMPLEMENTED, PENDING MERGE.** This document records what the branch
`feat/r09-work-area-geo-authority` changes and the evidence gathered for it.

Baseline: `origin/develop` @ `dc64f432cf85c02f918e26af144d8c8b928b3da9` (R08
merged, all six post-merge workflows green).

## Objective

The provider's work area and the marketplace must obey one geographic
authority: what the work-area screen shows, what the API accepts, what
PostgreSQL holds and what matching reads must be the same thing.

R09 is a prove-and-repair sprint. It is not a map redesign.

## The authoritative model

In full in `GEO_AUTHORITY_MATRIX.md`. In short:

- A provider with a point and a radius is matched by distance; the typed city
  is then not consulted. Otherwise the normalised city keys must be equal
  (ADR 0003).
- The radius is a server value: derived from the transport answer until the
  provider sets one, bounded by operator settings, refused rather than clamped.
- A market is a country the operator has enabled. It decides what may be
  stored; it takes no part in matching.

## Defects reproduced, then repaired

Each was reproduced by a failing test on `develop` before anything was changed.

| #   | Defect on `develop`                                                                                                                                                                                                                                                                               | Reproduction                                                     | Repair                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The announcement and the feed disagreed at the edge of the radius.** Matching in memory compared the distance rounded to 0.1 km; the feed query selected with an exact bounding box. A provider 10.04 km from a request was announced a job that the feed, the detail and the bid then refused. | `r09-geo-matching`: 6 failures (feed, detail, bid × 2 providers) | The decision is made on the unrounded distance everywhere (`exactDistanceKm`). The 0.1 km rounding is display only.                                                       |
| 2   | **Half a point could be stored.** A latitude without a longitude was accepted. Matching silently treated it as no point.                                                                                                                                                                          | `r09-geo-authority`: 4 failures                                  | A point is both numbers or neither, on every write (`COORDINATES_INCOMPLETE`).                                                                                            |
| 3   | **A point could be anywhere on the planet.** The R08 finding. A provider who chose Syria could store a starting point in the Sahara; matching was computed from it while the application said Syria.                                                                                              | `r09-geo-authority`: 5 failures                                  | The operator's market registry can describe each market's envelope. A point outside it is refused (`POINT_OUTSIDE_MARKET`). The development seed describes SY, SE and SA. |
| 4   | **The old market's point survived a change of market.**                                                                                                                                                                                                                                           | `r09-geo-authority`: 1 failure                                   | A stored point the new market does not contain is cleared in the same write. The same rule the stored timezone already follows.                                           |
| 5   | **The map made defect 3 the easy path.** With no point chosen it opened on the whole world at zoom 2, where one tap is hundreds of kilometres wide.                                                                                                                                               | R08 browser run (a tap near the centre stored 16.02, 7.03)       | The map opens fitted to the provider's market, using the envelope the server sends. A point the envelope excludes is explained on the screen and never queued.            |
| 6   | **The profile route approved providers use applied none of this.** `PATCH /v1/me/provider/profile` writes the same columns with no pairing, no market check and a fixed 1–500 km radius bound instead of the operator's.                                                                          | unit tests in `provider.service.spec.ts`                         | The route calls the same point rule and the operator's radius bounds. Its city-centroid convenience no longer invents a point outside the provider's market.              |

One existing assertion changed on purpose: `phase5-c2-market-and-radius`
pinned the exact fields the markets endpoint may return. It now allows
`bounds` and pins its four keys; the registry fields it must never leak are
still asserted absent.

## Candidates examined and found sound

- **Radius authority.** The screen has no radius control and writes the
  server's suggestion only when none is stored. Opening the work-area screen
  before choosing transport does not freeze the radius: it still follows the
  transport answer. Proved in the browser.
- **`near` on the feed.** The list accepts a city override for browsing; the
  detail and the bid do not. This is deliberate and documented in source: a
  query parameter may widen what is browsed, never what can be opened.
- **Privacy.** Provider coordinates reach the provider's own draft and profile
  and admin review only.

## Files changed

API

- `apps/api/src/shared/geo/service-area.ts`, `service-area.sql.ts` — decide on
  the unrounded distance.
- `apps/api/src/modules/provider/onboarding/market/supported-market.ts` —
  optional `bounds` on a market, its validation, `marketContainsPoint`.
- `apps/api/src/modules/provider/onboarding/market/supported-markets.service.ts`
  — serve the envelope.
- `apps/api/src/modules/provider/onboarding/service-area/work-area-point.policy.ts`
  (new) — the one rule for a starting point.
- `apps/api/src/modules/provider/onboarding/provider-onboarding-wizard.service.ts`
  — apply it on the `LOCATION` step.
- `apps/api/src/modules/provider/provider.service.ts` — apply it, and the
  operator radius bounds, on the profile route.

Web

- `components/ServiceAreaMap.tsx` — open on the market; put a refused pin back.
- `components/ServiceAreaTaskScreen.tsx` — explain and do not queue a point
  outside the market; a test id on "Remove the pinned location".
- `copy/service-area-copy.ts` — one sentence, English and Arabic.

Shared

- `packages/contracts/.../provider-supported-markets.ts` — optional `bounds`.
- `packages/database/src/seed.ts` — development envelopes for SY, SE, SA.
- `scripts/perf/geo-query-plan.mjs` — `--check`.
- `.github/workflows/ci.yml` — two steps in the existing real-API job.

## Schema, migration, contract

- **Schema:** none. **Migration:** none.
- **Contract:** one additive, optional field, `SupportedMarketView.bounds`. An
  older web bundle ignores it. R09 is added to the `packages/contracts`
  reservation in `BASELINE.json`.
- **Setting:** `platform_supported_markets` entries may carry
  `bounds: { south, west, north, east }`. Existing registries without it remain
  valid and behave exactly as before.

## Market policy

A point must lie inside the envelope of the market the write leaves the
provider in. The envelope is a coarse rectangle the operator declares; its
edges are inside. It is not a border and is not meant to be. A market with no
envelope cannot judge a point: the server accepts it, as it did before R09.

## Radius policy

Unchanged on the onboarding step. On the profile route the operator's standard
minimum and maximum now apply; the earned ceiling is not consulted there, so
that route is never the more permissive of the two.

## Privacy

No exposure was broadened. The one new field describes a country. The new log
line carries no coordinate. See the matrix.

## Evidence

Local run on Windows 11, Node 24.21.0, pnpm 10.32.1, throwaway PostgreSQL 16,
Redis 7 and Mailpit containers; API and web built from this branch with
`VITE_PROVIDER_ONBOARDING_V2=true`.

| Check                                                                                                | Result                                                            |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `r09-geo-authority.integration.spec.ts` on `develop` code                                            | 10 failed, 23 passed (the reproduction)                           |
| `r09-geo-matching.integration.spec.ts` on `develop` code                                             | 6 failed, 20 passed (the reproduction)                            |
| Both R09 integration suites with the repairs                                                         | 59 passed, four consecutive runs                                  |
| Full gated API suite, 6 shards, fresh database                                                       | 5001 passed, 33 skipped, 1 failed (Findings, item 1)              |
| API unit suite, ungated                                                                              | 3856 passed, 1178 skipped (gated), 1 failed (same)                |
| API `lint` / `typecheck` / `build`; `prisma validate`; `prisma migrate status`; database `typecheck` | PASS                                                              |
| Web unit suite (`test:ci`)                                                                           | 181 files, 2263 passed                                            |
| Web `lint` (34 pre-existing warnings) / `typecheck` / `typecheck:e2e` / build with the flag          | PASS                                                              |
| `r09-work-area-geo-authority.real-api.spec.ts`                                                       | 18 passed, three consecutive runs                                 |
| Existing V2 real-API browser suites (`v2-real-api`, `v2-persistence`, `repairs`)                     | 34 passed                                                         |
| R06, R07, R08 and R09 real-API browser suites together                                               | 35 passed                                                         |
| R05 real-API browser suite                                                                           | 2 passed in 4 of 5 runs (Findings, item 2)                        |
| `geo-query-plan.mjs --rows 50000 --check`                                                            | PASS: `sr_city_idx`; `sr_geo_idx` OR `sr_city_idx`; no table scan |
| Governance scripts (`production-governance`, `release-baseline`, inventory)                          | PASS                                                              |

Query plan, 50,000 rows: the radius predicate is a `BitmapOr` of
`sr_geo_idx` (the bounding box) and `sr_city_idx` (the fallback for requests
with no point), 756 and 3,695 index rows, 301 candidates after the category
filter, about 2.4 ms. The check asserts the indexes and the absence of a table
scan, not the time. The provider-side announcement query selects within 500 km
of a request and is not selective inside one country by design; it pages by
key and is not gated here.

## Findings outside the R09 change

1. `restricted-erasure.spec.ts` fails one `ENOTDIR` case on Windows only.
   Re-confirmed on untouched code in this sprint. It passes on Linux CI.
2. `r05-seeker-durability.real-api.spec.ts` failed once in five local runs.
   Inspected this time: the profile `PATCH` returned 200 and the row still held
   the original name, which is consistent with the seeker profile editor
   re-hydrating its form from the server after the fields were typed. Seeker
   profile code is not touched by R09.
3. The web autosave still reads the conflict version from the wrong place
   (recorded in R08). No visible effect.
4. The seeker request wizard's own coordinates are client-supplied and are not
   compared with a market. Requests are outside R09's scope.

## R10 deferred items

Nothing in R09 touched working hours. One observation for R10: a change of
market invalidates the stored timezone only on the next availability write,
whereas R09 clears an out-of-market point in the same write.

## Residual risks

- A market the operator has not described cannot judge a point.
- A point may be far from the typed city inside the same market. The point
  decides matching.
- The envelope is a rectangle: near a border it contains some of a neighbour.
- Production operators must add `bounds` to their registry to get the check;
  the development seed does it only for a registry it creates.
- A provider with an earned radius ceiling cannot set a radius above the
  standard maximum through the profile route. No web screen sends a radius
  there.

## Rollout and rollback

- No migration and no deploy ordering. API and web are independently
  compatible: an older web bundle ignores `bounds`; a newer one without
  `bounds` from the server opens the map on the world as before.
- To enable the check for a market, add `bounds` to its entry in
  `platform_supported_markets`. To disable it, remove `bounds`.
- Reverting the PR restores the previous behaviour. Points stored while R09 was
  live remain valid under the old rules.
