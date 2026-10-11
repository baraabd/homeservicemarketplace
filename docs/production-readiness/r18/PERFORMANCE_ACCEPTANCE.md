# R18 — Performance acceptance

Status: **NOT RUN.**

- No launch capacity target exists in the repository or in an owner decision;
  none is invented here (UNKNOWN_DECISION).
- A load test on a disposable CI runner or this low-memory host would measure
  the runner, not the product; a hosted target is required
  (HOSTED_ENVIRONMENT_BLOCKED).

## What the code already bounds

| Concern                | Evidence                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded pagination   | provider bids use cursor pages capped at 100 (`provider-bids.service.ts:157`), bookings likewise (#148); foreign cursors are refused (E-18) |
| N+1 on My Bids         | the booking is read with the bid in one query (`listForProvider` includes `booking`), replacing a second list request (E-18)                |
| Outbox after a restart | R17-B announces committed notifications once across a replica restart; backlog under load is not measured                                   |
| Existing tooling       | `scripts/perf/geo-query-plan.mjs` (feed geo query plan)                                                                                     |

## To run with a hosted target

Bounded scenarios for login, catalog, request list, provider feed, request
creation, bid submission and listing, booking reads, messaging,
notifications, admin queues, media metadata and worker throughput. Measure
p50/p95/p99, throughput, error rate, database pool use, Redis connections,
CPU, memory, query counts, slow queries and outbox lag. Inspect `EXPLAIN
ANALYZE` plans for the feed, bids, bookings and notifications queries on
production-sized synthetic data. Record the tested capacity as measured.

## Update 2026-10-11 (after PR #154, PR #155)

The three measurements are separate, and none stands in for another:

| Stream                                    | Evidence                                                                                                                                                                                                                                                                                                                                                       | State                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Developer setup, build, server boot       | PR #154 preflight diagnostics; `Web development startup` passed on Ubuntu and Windows on `ffe9a39` (run 38152627071)                                                                                                                                                                                                                                           | passing; no duration budget    |
| Browser cold/warm presented content (lab) | `Real application startup performance` on PR #154's final source (run 38149872911, artifact 11705917669): 100 observations; mobile cold/warm medians seeker 4.669/2.334 s, provider 4.698/2.534 s, admin 5.059/2.250 s; mobile CLS about 0.205. The post-merge run on `ffe9a39` (38152627102) succeeded; its artifact was not re-read here (the host lost DNS) | measured; **no budget agreed** |
| Hosted request and worker capacity        | none                                                                                                                                                                                                                                                                                                                                                           | `HOSTED_ENVIRONMENT_BLOCKED`   |

Notes that keep the lab numbers honest:

- They come from a fresh browser context with an existing session, on a CI
  runner, using Chromium's 4× CPU throttle, 150 ms latency and 1.6 Mbps.
  They are not a first-ever onboarding, a cold database or a physical phone.
- A warm reload keeps local application state as well as the HTTP cache, so
  the cold/warm difference is not caching alone.
- Five pairs per role and profile give a median and range. No p95 or p99 is
  reported, and the lab interaction acknowledgement is not field INP.
- Field Core Web Vitals need real users after launch.

Changed on this branch: the nginx image now serves `/assets/*` with
`Cache-Control: public, max-age=31536000, immutable` and gzip. Before, it had
no cache header and no compression. Vercel already declared immutable
assets. This affects repeat visits and transfer size on the nginx path. It
has **not** been measured as a startup-time improvement, and none is claimed.

Hotspots confirmed in source, not yet profiled. Tuning without a trace is
not done here:

- `AdminRouteContent.tsx:3-15` statically imports every admin section,
  including `DashboardOverview` (recharts).
- `HomeScreen.tsx:308-669` mounts every tab's queries on first render.
- `ProviderApp.tsx:346-349` waits for the profile read before the
  capability read.
- `getMe` has no total deadline (`auth-api.ts:50-53`; the axios instance has
  no default timeout).
- `fonts.css:1` imports external CSS for seven weights each of Inter and
  Cairo.
- Each change must keep session authority and degraded-network behaviour.
  The layout shift needs attributed layout-shift rectangles before a cause is
  assigned.

Proposed thresholds, awaiting the owner, are in `OWNER_DECISIONS.md`
(Hosting, registry and budgets).
