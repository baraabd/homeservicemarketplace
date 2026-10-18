# R27 measured G1 findings — 2026-10-17

Source evidence: [R27 workflow 39032727959](https://github.com/baraabd/homeservicemarketplace/actions/runs/39032727959),
frozen baseline `40cdac5c9ce6acaa8dedc0385984a807ae9a84d0` and candidate/harness
`afec37ae717fbdca91a8e23dd5fc76a1cbd2a703`. Both artifact ZIP digests were
verified. Source/tree, lockfile, schema, safe configuration, dataset and
browser versions match their declared identities. Candidate runtime is clean;
baseline dirtiness is the declared same-harness overlay, not an application patch.
Exact artifact IDs, digests and screenshot review are in
`docs/production-readiness/r27/ACCEPTANCE.md`.

**The elapsed-time comparison is hardware-confounded.** Baseline used an Intel
Xeon Platinum 8573C; candidate used an AMD EPYC 7763. Both had 4 logical CPUs,
15.6 GiB RAM, Linux, Node 24.21.0 and Chromium 151.0.7922.34, on separate shared
GitHub VMs. The different CPU models and initial host load prevent attributing
latency differences solely to R27. The tables report observations, including
regressions; only byte and query-structure changes support the narrow repairs.
Even a later same-CPU run is not a controlled production-capacity experiment.

## Reproduced bundle and query changes

The fresh bundle journey arrays exactly reproduce the previous retained run.
Figures below are complete journey JavaScript bytes, including the shell.

| Metric                                   |               Frozen baseline | Candidate | Finding                                                           |
| ---------------------------------------- | ----------------------------: | --------: | ----------------------------------------------------------------- |
| Seeker-home gzip JS                      |                      369867 B |  311655 B | 58212 B / 15.74% fewer initial bytes                              |
| Admin gzip JS                            |                      505808 B |  380860 B | 124948 B / 24.70% fewer initial bytes                             |
| Complete admin-charts journey gzip       |                      505808 B |  507650 B | 1842 B more overall; charts are deferred                          |
| Public shell gzip                        |                      237979 B |  237972 B | Essentially unchanged                                             |
| Deferred address-map increment gzip      | No separate baseline boundary |   58500 B | Loaded when the map is requested; unknown is not zero             |
| Admin users statements, 5 returned rows  |                            22 |        10 | Batched enrichment                                                |
| Admin users statements, 15 returned rows |                            52 |        10 | The count remains bounded as the page grows                       |
| Seeker request statements                |                             5 |         6 | One extra page-bounded bid aggregation removes the broad Bid scan |
| Provider available-request statements    |                            13 |        13 | Unchanged populated-page hydration                                |
| Provider booking statements              |                            12 |        12 | Unchanged populated-page hydration                                |

The amplified seeker request observation was 33.31 / 12.71 ms HTTP p50 and
26.29 / 2.75 ms measured DB time (baseline / candidate). Amplified admin users
were 14.74 / 10.51 ms p50. These timings have the CPU caveat above; the
statement/plan evidence is independently useful. The initial small-data admin
measurement recorded 11 candidate statements, while the amplified and page-size
probes recorded 10; do not describe every observation as exactly ten.

There are 17 query scenarios in each of two phases, with five latency samples
per scenario and phase: 170 observations per source, all HTTP 200. All seven
candidate page-size 5/20 probes are bounded. Amplified data contains 10836
requests, 43344 bids, 5418 bookings, 15 users, 12 provider profiles and 180
notifications. This scales selected lists, not the whole marketplace population.
The admin financial list still has a generic Booking sequential scan over 5418
rows and returns zero completed bookings; index benefit and completed-booking
pagination remain unproven.

Full fixed-data cursor walks terminated without duplicates on both sources:

| List                        | Pages | Items |
| --------------------------- | ----: | ----: |
| Provider bids               |   542 | 10836 |
| Seeker requests             |    91 |  1806 |
| Seeker bookings             |    46 |   903 |
| Provider bookings           |    91 |  1806 |
| Provider available requests |   271 |  5418 |

The cache/authority audit has **10 asserted negatives and 3 informational
same-user conditional-response observations**. The ten negatives pass;
anonymous, foreign-user, role, cross-user ETag and post-logout session boundaries
remain intact. Fifteen of 17 sampled private reads still omit Cache-Control;
notifications and provider available requests already send no-store. Browser
account switching is tested in one context. Cross-tab sign-out and role or
permission revocation during an active session are separate integration gaps,
not established by these observations. See CR-R27-04 and CR-001-integration.

## Production-policy boot and admission control

Dependency installation and compilation are excluded. Cold means the first
process in this runner session; no OS-cache purge or reboot was performed.
Boot statistics have n=5 (warm-only subset n=4), so p95/p99 are not reported.

| Metric                        | Baseline Intel VM | Candidate AMD VM |
| ----------------------------- | ----------------: | ---------------: |
| Start to live, p50            |           1043 ms |          1192 ms |
| Start to ready, p50           |           1051 ms |          1200 ms |
| Warm-process readiness, p50   |           1048 ms |          1190 ms |
| First catalogue response, p50 |            7.9 ms |           7.7 ms |
| RSS at readiness, p50         |         209.6 MiB |        203.4 MiB |
| RSS after probes, p50         |         210.8 MiB |        206.3 MiB |

The earlier same-CPU diagnostic pair observed readiness 1282 / 1157 ms and
ready RSS 196.5 / 203.0 MiB, the opposite direction for these aggregate deltas.
Neither pair establishes a universal boot or memory improvement. Disabled
Mongo remains absent from the candidate's eager loading path by source/unit
verification; the enabled behavior tests remain intact.

Each source's independent default-policy overload made 150 requests at
concurrency 8: 100 HTTP 200 and 50 HTTP 429. Both recovered naturally, after
60329 / 60319 ms. The real default 100 requests per 60 seconds was unchanged;
no reset occurred during recovery. This verifies admission control and recovery,
not saturation capacity.

## Warm list workload observations

Each profile is a closed-loop 200-request run with warm app/DB caches. Every
request returned HTTP 200, with zero observed errors. Each individual n=200
profile can report empirical p95/p99; these are not hosted SLO estimates.

| Profile / concurrency   | Baseline p50 / p95 / p99 ms | Candidate p50 / p95 / p99 ms | API CPU seconds, baseline / candidate | Peak RSS MiB, baseline / candidate |
| ----------------------- | --------------------------- | ---------------------------- | ------------------------------------- | ---------------------------------- |
| Normal / 2              | 33.33 / 44.16 / 49.31       | 9.32 / 12.22 / 23.83         | 1.26 / 1.31                           | 500.0 / 523.3                      |
| Burst / 16              | 208.91 / 248.84 / 256.75    | 47.35 / 60.84 / 66.72        | 1.36 / 1.16                           | 502.3 / 532.7                      |
| Post-burst recovery / 4 | 52.78 / 61.15 / 65.56       | 13.79 / 20.96 / 30.33        | 1.35 / 1.35                           | 503.2 / 539.5                      |

Candidate peak RSS is higher in all three workload observations. Different
CPU models confound their time/CPU comparisons. Realtime connections, expensive
uploads, larger user populations and hosted failure-load testing remain R37
work, with proposed profiles already recorded in WORKLOAD_PROFILES.md.

## Complete real-browser matrix

Both modes cover seeker/admin, desktop/mobile and EN/AR with RTL and keyboard
assertions. The comparator reports **OBSERVED_COMPLETE_MATRIX, zero missing
groups**: 48 paired role/cache/project/mode groups, each n=3 on each side.
There are 192 useful-UI observations and 96 keyboard transitions across both
sources. Do not pool unlike groups to manufacture browser p95/p99.

Each table cell is baseline / candidate p50 in milliseconds. Cold means a fresh
browser HTTP cache; OS/server/DB caches remain warm. UI login and OTP setup,
installation and builds are excluded. CDP tracing adds overhead; compile event
categories overlap and must not be summed into a claimed parse-time total.
All time differences below remain hardware-confounded.

### Production

| Project    | Role   | Cold useful UI  | Warm useful UI  | Keyboard transition |
| ---------- | ------ | --------------- | --------------- | ------------------- |
| Desktop EN | Seeker | 414.43 / 349.99 | 187.08 / 204.02 | 857.74 / 879.36     |
| Desktop EN | Admin  | 381.72 / 371.73 | 154.36 / 211.84 | 82.57 / 126.08      |
| Mobile AR  | Seeker | 366.26 / 345.72 | 155.28 / 189.87 | 854.34 / 873.40     |
| Mobile AR  | Admin  | 364.45 / 296.18 | 149.33 / 153.88 | 72.72 / 84.11       |
| Desktop AR | Seeker | 385.06 / 332.31 | 157.74 / 173.81 | 858.34 / 877.36     |
| Desktop AR | Admin  | 365.75 / 307.89 | 162.68 / 161.22 | 78.69 / 108.05      |
| Mobile EN  | Seeker | 367.84 / 323.25 | 150.83 / 160.08 | 852.94 / 875.00     |
| Mobile EN  | Admin  | 363.78 / 293.20 | 158.13 / 148.14 | 74.60 / 82.18       |

### Development

| Project    | Role   | Cold useful UI  | Warm useful UI  | Keyboard transition |
| ---------- | ------ | --------------- | --------------- | ------------------- |
| Desktop EN | Seeker | 553.17 / 574.33 | 290.52 / 352.56 | 864.18 / 882.32     |
| Desktop EN | Admin  | 764.11 / 831.67 | 498.94 / 558.50 | 79.51 / 77.34       |
| Mobile AR  | Seeker | 515.96 / 561.57 | 278.94 / 318.59 | 860.08 / 877.71     |
| Mobile AR  | Admin  | 811.95 / 798.46 | 491.02 / 530.38 | 85.25 / 87.61       |
| Desktop AR | Seeker | 523.19 / 562.96 | 304.47 / 321.47 | 861.02 / 877.78     |
| Desktop AR | Admin  | 801.45 / 812.23 | 509.20 / 567.37 | 80.00 / 78.67       |
| Mobile EN  | Seeker | 510.69 / 546.36 | 286.38 / 317.14 | 858.13 / 868.54     |
| Mobile EN  | Admin  | 883.62 / 806.08 | 567.64 / 521.40 | 96.09 / 88.62       |

Production cold medians are lower in all eight groups, but six warm medians
and all eight transition medians are higher. Development is also mixed.
Seven production and five development groups exceed the unapproved 10%
regression observation level. These are recorded observations requiring a
matched-environment review, not proof of a causal regression or an accepted
budget violation. Bytes alone cannot establish useful-UI speed.

Production cold script transfer is 339425 / 288569 B for seeker and
457377 / 346793 B for admin. Runtime compilation/evaluation metrics are
retained in each browser JSON with their sample limits; no universal parse
speed claim is made. The separate existing Seeker/Provider/Admin startup CI
covers provider browser startup; this R27 timing matrix has two roles only.

## Acceptance boundary

The unchanged proposed bundle/query checker returns **47 PASS / 4 FAIL**, exit
1: seeker requests 6 > 5, provider available requests 13 > 10, provider bookings
12 > 7, and the completed-booking scan. The concrete budget/index/cache decisions
are in `docs/production-readiness/r27/shared-change-requests/CR-001-integration.md`.
R27's complete isolated service/browser evidence does not approve these budgets,
accept the combined wave, or establish hosted capacity. Final publication and
its exact-head CI are tracked in PR #173; this immutable measurement snapshot
is explicitly tied to afec37ae and is not relabeled as a later source.

---

## Historical records retained for audit

# R27 findings — measured on 059c018 (2026-10-14)

Source: `059c018576a75837d4dfb262ee49168d9217d881` (G0 base, approved for a
provisional pre-G1 start). The worktree was dirty only with the R27 harness
files. Every number below comes from a JSON report in this directory. A
"host-dependent" number was taken on a contended 12-thread / 15.8 GB Windows
host with 0.3–1.3 GB free memory; it locates problems and must not be read
as capacity.

## 1. Web bundle (host-independent bytes)

`bundle-baseline.json`, vite 6.4.3, `VITE_API_URL=http://127.0.0.1:4010`, no
other `VITE_*` flags.

| Graph                     | JS raw    | gzip-1 | brotli-11 | CSS raw   |
| ------------------------- | --------- | ------ | --------- | --------- |
| entry (`index.html`)      | 2.4 KiB   | 1.2    | 1.0       | 0         |
| shell (entry + bootstrap) | 635.1 KiB | 232.4  | 178.1     | 163.0 KiB |
| + auth                    | 51.7      | 19.5   | 15.5      | 0         |
| + seeker home             | **372.9** | 128.9  | **95.3**  | 21.1      |
| + provider workspace      | 125.6     | 46.1   | 35.5      | 5.8       |
| + provider onboarding     | 239.5     | 91.4   | 68.1      | 0         |
| + admin                   | **794.2** | 261.6  | **187.5** | 41.4      |
| + disputes                | 144.1     | 53.9   | 41.9      | 24.5      |
| + job wizard              | 212.1     | 79.1   | 61.6      | 15.2      |

Placement of heavy libraries (rendered bytes, before minification):

- **recharts: 508.9 KiB, all in `+admin`.** `AdminRouteContent.tsx:10`
  statically imports `DashboardOverview`, so every admin route pays it, not
  only `/admin`. → CR-R27-01.
- **leaflet: 472.9 KiB in `+seeker-home` and `+job-wizard`.**
  `SavedAddressesPage.tsx:21` statically imports `LocationMap`, but the map
  renders only after the seeker captures a location. → CR-R27-02.
- **pdfjs-dist:** already lazy (`identity-pdf.ts` uses dynamic `import()`).
  Only a worker URL stub sits in `+admin`.
- **motion / framer-motion: 377.7 KiB in the shell; socket.io-client: 90.4
  KiB in the shell.** Removing either is not a minimal change: motion drives
  `Root`'s transitions, and the realtime hook is mounted by
  `auth-provider.tsx`. Recorded for the owners; no CR.
- **MUI:** listed in `package.json` but absent from every chunk.

The R27 measured repair (bytes) used the `--overlay` build of the two CR
files (`bundle-after-cr01-cr02.json`):

| Journey                         | brotli before | brotli after | change                        |
| ------------------------------- | ------------- | ------------ | ----------------------------- |
| + admin (non-dashboard routes)  | 187.5 KiB     | 99.9 KiB     | −87.6 KiB (−47%)              |
| + admin dashboard charts (lazy) | —             | +89.6 KiB    | only on `/admin`              |
| + seeker home                   | 95.3 KiB      | 52.0 KiB     | −43.3 KiB (−45%)              |
| + address map (lazy)            | —             | +43.5 KiB    | only after a location capture |
| shell and every other journey   | unchanged     | unchanged    | within 0.3 KiB                |

These figures are transfer and parse **bytes**. Their effect on presented
content time is **not measured**. It must come from the hosted startup
workflow on the integrated candidate, which measures cold and warm mobile
content-ready per role. No percentage of speed-up is claimed.

## 2. API start-up (host-dependent time)

`api-boot-baseline.json`: production profile (`NODE_ENV=production`,
production env policy, secure cookies). The deviations are verification
enforcement off (no ClamAV in the lane) and an HTTPS placeholder CORS origin.
Workers were off, Postgres 16 and Redis 7 ran in loopback containers, and
dependency install and compile were excluded. The artifact was
`apps/api/dist/main.js`, sha256 `0207db041e61e67a…`. There were 6 runs; the
first was the first boot in the session, the rest had a warm OS cache.

- spawn → ready: median **4,128 ms** (range 3,953–5,177). Live and ready
  differ by 10–80 ms; readiness checks are cheap.
- RSS at ready: median 185.9 MiB.
- First catalogue read after ready: median 25 ms; repeated: p50 6.8–10.7 ms per run.
- Where the time goes (`api-boot-profile.json`, one profiled boot):
  - **about 92% of busy CPU is CommonJS module loading**;
  - mongoose plus mongodb are charged about 12.7% of busy time although
    MongoDB is disabled by default → CR-R27-03 (unmeasured after-state);
  - other large shares: class-validator 6.8%, @nestjs/core 6.4%, rxjs 4.0%.

A fixture-profile boot (development mode) twice failed to become ready
within 90 s, with an empty log, while free memory was 0.3–0.5 GB. This is
recorded as host starvation, not as a product defect.

## 3. Database reads (counts and plans host-independent; latency not)

`query-profile-baseline.json`:

- Real-API seed: 6 seekers, 4 providers, 36 requests, 144 bids, 18 bookings.
- Then ×300 amplification: 10,836 requests, 43,344 bids, 5,418 bookings.
- Statement counts were bounded across the 300× growth on all 17 reads.

| Finding                                                                          | Evidence                                                                                                   | Action                                          |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Admin user list N+1**                                                          | 52 statements for 15 rows: `UserRole ×15` and `AdminAccessRequest ×15` from `toSummary()` in `Promise.all` | CR-R27-08                                       |
| **Seeker request list scans every bid**                                          | `Seq Scan on "Bid"` feeding the filtered `_count`; 77.65 ms DB time at 43k bids vs 3.89 ms at 144          | CR-R27-05                                       |
| **Admin completed-bookings list has no index**                                   | `Seq Scan on "Booking"` for `status='COMPLETED' ORDER BY updatedAt, id`                                    | CR-R27-06 (migration lane)                      |
| Provider feed walks requests by `createdAt`                                      | `ServiceRequest_createdAt_idx`, est. 4,515 rows then a per-row bid probe (cost 1,953); 28.6 ms DB time     | watch item for R37; no CR without a hosted plan |
| Request detail and bids-on-a-request DB time rose (0.7 → 42.8 ms, 1.3 → 27.2 ms) | generic plans are index-driven; taken at 0.4 GB free                                                       | unconfirmed; re-measure on an uncontended host  |

Bounded reads with no finding: `/v1/auth/me` (5), seeker bookings (7),
notifications (3), conversations (3), provider bids (11), provider bookings
(7), portfolio (9), admin providers (8), category applications (3), disputes
(3), audit logs (3).

**Pagination.** Cursor walks at `limit=20` had no duplicates:

- provider bids: 60 pages and 1,200 items (stopped at the page cap);
- seeker requests: 60 pages and 1,200 items (stopped at the cap);
- seeker bookings: 46 pages and 903 items, terminated.

The provider-bookings and feed walks were empty for the chosen fixture
provider. The harness now uses a provider with bookings and a provider with
no bids, but that improved run could not execute; see `RISKS.md`.

**Cache and authorization negatives: 13/13 pass** (`cacheAuthorization` in
the report).

- Anonymous → 401. Cross-seeker request and bids → 404. Seeker or provider
  on admin → 403. Seeker on provider bids → 403.
- Another user's ETag replayed → 200, never 304, on three private reads.
- Cookies replayed after logout → 401.

**Headers.** 16/17 private reads send no `Cache-Control` → CR-R27-04.

**Client cache.**

- Query keys are role-namespaced (`seeker`, `provider`, `admin`,
  `participant-disputes`, `auth`).
- Every non-`['auth','me']` query is removed at session end
  (`apps/web/src/lib/auth-session-reset.ts`).
- A sign-out in another tab propagates through the `hsm.auth.boundary.v1`
  storage event.
- No cross-role key collision was found in the factories.

## 4. What R27 did not establish

- Hosted browser timing for the CRs, AR/EN/mobile route smoke on the
  changed builds, and p95/p99 under load. These belong to the integrated
  candidate (CRs) and to R37 (capacity).
- The after-state of CR-R27-03/04/05/06/08.
- A truly cold OS-cache API boot (it needs a reboot).
