# Current G1-source findings — 2026-10-17

These numbers come from retained workflow38982468755, frozen baseline
`40cdac5c9ce6acaa8dedc0385984a807ae9a84d0`, candidate/harness
`5fe27fdbfc63437d7315d2b3820c4345e6aed27f`. ZIP IDs/digests and limitations
are in `docs/production-readiness/r27/ACCEPTANCE.md`. Later repaired-head
runs must carry their own identities; these figures remain diagnostic history.

| Metric                              | Baseline           | Candidate          | Interpretation                                           |
| ----------------------------------- | ------------------ | ------------------ | -------------------------------------------------------- |
| Seeker-home gzip JS                 | 369867 B           | 311655 B           | Deferred optional map: 15.74% fewer initial bytes        |
| Admin gzip JS                       | 505808 B           | 380860 B           | Deferred charts: 24.70% fewer initial bytes              |
| Complete admin charts journey       | 505808 B           | 507650 B           | Optional functionality is slightly larger overall        |
| API readiness p50, n=5              | 1282 ms            | 1157 ms            | Shared-VM observation; no tail/SLO claim                 |
| Readiness RSS p50                   | 196.5 MiB          | 203.0 MiB          | Memory increase, not an improvement                      |
| Admin users statements, 5/15 items  | 22 / 52            | 10 / 10            | Eliminated measured N+1 enrichment                       |
| Seeker amplified list p50           | 37.23 ms           | 11.47 ms           | Extra bounded query removes broad Bid scan               |
| Seeker measured DB time             | 29.48 ms           | 3.27 ms            | Broad scan est.28896 rows becomes bounded est.136        |
| Browser cold seeker, desktop EN n=3 | 344.23 ms          | 386.27 ms          | Slower diagnostic sample; do not infer bytes imply speed |
| Browser cold admin, desktop EN n=3  | 333.79 ms          | 338.93 ms          | Mixed result                                             |
| Browser warm seeker/admin           | 201.44 / 164.37 ms | 167.19 / 152.10 ms | Faster diagnostic medians                                |
| Admin keyboard dashboard transition | 60.86 ms           | 103.61 ms          | Deferred work becomes visible on transition              |

Three 200-request warm-list workloads completed with zero non-200 responses:

| Profile, concurrency   | Baseline p50/p95/p99 ms  | Candidate p50/p95/p99 ms |
| ---------------------- | ------------------------ | ------------------------ |
| Normal, 2              | 34.87 / 45.31 / 53.75    | 8.17 / 10.08 / 14.22     |
| Burst, 16              | 234.44 / 276.25 / 292.02 | 46.36 / 63.00 / 68.26    |
| Post-burst recovery, 4 | 57.10 / 67.56 / 77.99    | 12.76 / 17.40 / 18.98    |

Peak RSS increased from483.6–489.5 to521.8–537.8 MiB across these profiles.
These empirical fixture tails are not hosted capacity. Independent default-
policy overload returned100 successful plus50 rate-limited responses from150,
then recovered naturally after about60.3 seconds on both sources.

The request/bid/booking dataset is10836/43344/5418 rows. User/provider tables
are15/12 rows. Query bounds and13 cache/authority negatives pass; the existing
admin completed-booking scan remains. The proposed checker reports47 PASS,
4 FAIL. See the current acceptance matrix; no proposal was silently approved.

The diagnostic AR/mobile browser projects were incomplete. The new harness
repairs their label, fixture counters and error handling. Use the comparison
CLI for subsequent complete artifacts instead of quoting these diagnostic
numbers as final repaired-head results.

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
