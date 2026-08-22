# Sprint 3 — security exceptions

Every item here is a place where the ideal state was not reached. Each has a
named owner and a date. An exception without an expiry is just a decision
nobody wrote down, so entries here expire whether or not anyone has looked at
them, and the review date is the date the entry stops being an accepted risk
and becomes an open defect.

| #   | Exception                                            | Severity        | Owner    | Expires    | Review trigger                                               |
| --- | ---------------------------------------------------- | --------------- | -------- | ---------- | ------------------------------------------------------------ |
| E-1 | `ws` forced to 8.21.3 over upstream's `~8.18.3`      | High (if wrong) | Backend  | 2026-11-22 | socket.io releases a version whose `ws` range admits ≥8.21.0 |
| E-2 | ~28 High advisories in the dev-only tree             | Moderate        | Platform | 2026-11-22 | Any of them becomes reachable from a production dependency   |
| E-3 | CSP ships Report-Only, not enforcing                 | Moderate        | Frontend | 2026-10-22 | Report volume reaches zero for 14 consecutive days           |
| E-4 | HSTS `max-age=300`, no `includeSubDomains`/`preload` | Moderate        | Platform | 2026-10-22 | Ramp step completes without incident                         |
| E-5 | `METRICS_TOKEN` unset in existing environments       | Moderate        | Platform | 2026-09-22 | Token provisioned per environment                            |
| E-6 | Prisma pinned at 5.x while 7.x is current            | Low             | Backend  | 2027-02-22 | 5.x leaves security support                                  |

---

## E-1 — `ws` forced above the range socket.io declares

**What.** `pnpm.overrides` contains `"ws@>=8.0.0 <8.21.0": "^8.21.3"`.

**Why.** `engine.io`, `engine.io-client`, and `socket.io-adapter` all declare
`ws: ~8.18.3` — a patch-only range — and 8.18.3 carries a HIGH advisory.
socket.io 4.8.3 is the current release, so there is no upstream version to
move to. The choice is between forcing the dependency and shipping a known
HIGH, and this repo's audit gate is set at zero High or Critical.

**Why it is not simply hidden.** Forcing across three minor versions is exactly
the kind of override that can paper over an incompatibility, so it is not
accepted on faith:

- 63 realtime unit and integration tests pass against the forced version.
- A real Chromium-free handshake runs against the booted gateway with
  `transports: ['websocket']` and no polling fallback, so the WebSocket upgrade
  is the only path available. Result: `WS_PROBE: CONNECTED | transport:
websocket`.

**Removal condition.** When socket.io publishes a release whose transitive `ws`
range admits ≥8.21.0, delete the override, reinstall, and confirm
`pnpm why ws` reports a single version. The override is the last one left in
this repo; seven others were deleted in this sprint after being shown to bind
nothing.

**If the review date passes untouched:** treat as an open defect and re-test
the handshake against the then-current `ws`, because "it worked in August" is
not evidence about a version nobody has run.

---

## E-2 — High advisories in the dev-only dependency tree

**What.** The full audit reports 1 Critical and 28 High. The **production**
audit reports **zero**. The difference is build tooling: `vite`, `postcss`,
`turbo`, `@babel/core`, `tar`, `undici`, `js-yaml`, `brace-expansion`,
`fast-uri`, `nanoid`, `picomatch`.

**Why accepted.** None of these packages is present in a deployed artifact.
Blocking merges on them trains people to bypass the gate, which costs more
than the risk it buys — so the merge gate runs `--prod` and a second,
non-blocking step reports the full tree and uploads it as an artifact.

**What this does NOT mean.** A build-time compromise is a real attack (it is
how a CI pipeline gets turned into a supply-chain vector). The mitigations are
elsewhere: pinned action SHAs, `--frozen-lockfile`, Dependabot on the npm and
Actions ecosystems, and CodeQL. What is accepted here is the _timeline_, not
the risk.

**Removal condition.** These clear as the toolchain moves. Re-check whenever
the dev-tree High count changes materially in the uploaded audit artifact.

---

## E-3 — CSP is Report-Only

**What.** The API sends `Content-Security-Policy-Report-Only`; the web app's
`vercel.json` does the same.

**Why.** A CSP that is wrong on its first day breaks the entire app at once,
and the standard response to that is to delete the header and never try again.
Report-Only lets browsers evaluate the identical policy and report what _would_
have been blocked, with no user impact.

The API's policy is already `default-src 'none'` and is expected to enforce
cleanly — it serves JSON and has no legitimate subresources at all. The web
app's is the one that needs observation: it currently allows
`style-src 'unsafe-inline'` for emotion/MUI's injected styles, and
`connect-src https: wss:` rather than a pinned API origin, because that origin
differs per environment.

**Removal condition.** API: flip `CSP_MODE=enforce` — no directive changes, so
enforcing introduces no new rule. Web: pin `connect-src` to the real API
origin, then move the header key from `Content-Security-Policy-Report-Only` to
`Content-Security-Policy`.

**Blocked on:** a report collector. Report-Only produces nothing actionable
unless something receives the reports; no `report-to` endpoint is configured
yet, so today this buys browser evaluation without collection. That gap is the
first thing to close, and is why E-3 has the nearest expiry of the header work.

---

## E-4 — HSTS max-age is deliberately short

**What.** `HSTS_MAX_AGE_SECONDS` defaults to 300, with `includeSubDomains` and
`preload` off.

**Why.** HSTS is the one header whose mistakes cannot be withdrawn: once a
browser has pinned the directive it refuses plaintext for the full max-age
regardless of what the server later sends. Shipping a year on day one means a
year of no way back. Five minutes is long enough to be real and short enough to
age out over a coffee break.

**Ramp.** 300 → 86400 → 2592000 → 31536000, one step at a time, each held long
enough to be confident. `includeSubDomains` only once _every_ subdomain is
known to serve TLS — including ones nobody remembers, which is how this header
usually breaks something. `preload` last, and only deliberately: submitting to
the preload list is effectively irreversible on a human timescale.

**Removal condition.** Ramp complete at 31536000 with `includeSubDomains`.

---

## E-5 — `METRICS_TOKEN` is unset in existing environments

**What.** `/metrics` now requires `Authorization: Bearer $METRICS_TOKEN`. With
no token set, the endpoint is open outside production and returns 404 in
production.

**Why an exception.** Until the token is provisioned, production Prometheus
scraping of this API is off. That is a deliberate fail-closed choice — the
previous state was "readable by anyone who asks", justified in a code comment
by network policy this repository does not own, configure, or test.

**Health probes are unaffected** and need no token: they are on `/health/live`
and `/health/ready`, served by a different controller, and the guard is mounted
only on the metrics controller. Verified at runtime — probes 200 while
`/metrics` returned 404.

**Removal condition.** Generate a token per environment (≥16 chars), set
`METRICS_TOKEN`, and add the bearer token to the Prometheus scrape config.
Then delete this entry.

---

## E-6 — Prisma remains on 5.x

**What.** `prisma` / `@prisma/client` stay at 5.22.0 while 7.9.1 is current.

**Why.** Two majors, no advisory against 5.22.0, and the repo's entire
persistence layer plus four forward-only constraint migrations from Sprint 2
sit on top of it. A two-major ORM upgrade inside a _security_ sprint is how a
security sprint becomes a data incident.

**Removal condition.** Its own change, with its own migration testing, once
someone can give it the attention it needs. Bring it forward immediately if an
advisory lands against 5.x or 5.x leaves security support.
