# Sprint 09B.29 — the reported manual-test failures, diagnosed

Written from the screenshots of 2026-09-13 and read-only inspection of the
developer's own running stack. Every claim below is evidence-backed; where a
cause is inferred rather than proven, it says so.

---

## 1. The single fact that explains most of it

**The browser was running current frontend code against a fifteen-day-old API.**

|                           |                                                    |
| ------------------------- | -------------------------------------------------- |
| API the browser talked to | `http://localhost:4000`                            |
| Process behind that port  | container `docker-api-1`, image `hsm-api:dev`      |
| Image created             | **2026-08-30T21:58:57Z**                           |
| Container started         | 2026-09-11T21:33:08Z                               |
| Command                   | `node dist/main.js` — a build baked into the image |

The frontend was current: the screenshots show the approved V2 hub in Arabic,
which only exists on this branch.

### How it was proven, not assumed

The compiled bundle inside that container contains **zero** occurrences of the
contract the current frontend speaks:

```
stale-build occurrences of 'specialtyLeafIds':    0
stale-build occurrences of 'primarySpecialtyId':  0
stale-build occurrences of 'markets':             0
stale-build occurrences of 'resolvedTimezone':    0
stale-build occurrences of 'serviceAreaExpansion':0
```

`@Get('markets')` entered the repository on **2026-09-11** (`5fa166d`), twelve
days after that image was built.

### Why it happened, and it is not the developer's mistake

`infra/docker/docker-compose.yml` declares the api service with **both** a
`build:` context and `image: hsm-api:dev`. `docker compose up -d` reuses an
existing image of that name and does **not** rebuild. Nothing surfaced the
staleness — the API started healthy and served most routes correctly, because
most routes are older than the drift.

---

## 2. The markets 404, at the serving boundary

Three requests, one route, three answers — which is what separates a router miss
from a guard refusal:

| Request                                  | Stale API (4000)       | Current-code API (4011)               |
| ---------------------------------------- | ---------------------- | ------------------------------------- |
| `GET /v1/me/provider/onboarding/markets` | **404** `Cannot GET …` | **401** (route exists, guard refuses) |
| `GET /v1/me/provider/onboarding/draft`   | **401** (route exists) | —                                     |

So on the developer's API the route is genuinely **not registered**; on current
code it is. **Confirmed cause: stale build.** Not a client URL mismatch — the
client's path matches the controller exactly. Not missing market configuration —
that path returns HTTP 500 with `MARKET_REGISTRY_MISSING`, never 404. Not a
proxy rule — the 404 body is the application's own `NOT_FOUND` envelope.

### The product defect found alongside it

The 404 itself was environmental. The **repetition** was not. `useSupportedMarkets`
had `retry: 1`, and React Query re-attempts a failed query on every mount — so
each trip between the hub and the work area asked again for a route that was
never going to appear, burying the one console line that named the cause.

**Repaired:** a 4xx is asked once and never retried, including across a remount;
network errors, 5xx and 429 keep their single retry. The screen's UNAVAILABLE
state already carries a real **Retry** button, so recovery stays with the
provider rather than in a loop. A missing route is never converted into a
successful empty market list — that would read as "the operator has opened no
countries", which is a lie.

**Regression:** `useSupportedMarkets.bounded.test.tsx` — 5 tests. Reverting to
`retry: 1` reddens three of them; the "still retries a 500" test stays green, so
the bound cannot silently become "never retry".

---

## 3. The `/auth/me` 401

**Expected, and not the cause of the Required state.** An unauthenticated probe
on boot is how the app asks "is anyone signed in": `auth-provider.tsx` calls it
before any session exists, and the stale API answers `401
AUTH_INVALID_CREDENTIALS` — the same answer current code gives. The screenshots
show it at app start, initiated from the provider's own boot path.

It is **not** evidence of a broken session: the same account went on to load the
hub, the draft and four completed tasks, all of which are authenticated routes.

401 versus 403 semantics are unchanged, no bounded refresh path was altered, and
no negative assertion was weakened.

---

## 4. Why Services said مطلوب and the hub stuck at 4 of 6

Read-only from the developer's own database, provider
`cmtq65u3e006k2h57hji17ow9` (updated 2026-09-13 23:23, their session):

| Fact                                                      | Value                                          |
| --------------------------------------------------------- | ---------------------------------------------- |
| `professionSince`                                         | `2023-01-01` — **stored**                      |
| `transportMode`                                           | `TRUCK` — **stored**                           |
| `serviceAreaCity` / `serviceAreaCountryCode`              | `حلب` / `IQ` — **stored**                      |
| `serviceAreaRadiusKm`                                     | `54` — **stored**                              |
| `primaryServiceCategoryId`                                | set                                            |
| `ProviderProfileServiceCategory` (membership)             | **0 rows**                                     |
| `ProviderCategoryApplication`                             | **5 rows, all PENDING** (3 created 2026-09-13) |
| `onboardingState` / `verificationState` / `standingState` | **all NULL**                                   |

The provider's answers were **not lost**. They entered specialties; all five are
**awaiting moderation** and none is approved.

### The causal chain

`applyForSpecialties` creates a PENDING `ProviderCategoryApplication`; membership
rows appear only when an administrator approves. So a provider with pending-only
specialties has `leafSpecialtyCount === 0`.

- **Current code** raises that as `AWAITING_REVIEW`, classifies it as the
  **platform's** item, and does **not** let it block final review or submission.
  The task reads "We are checking this. You do not need to do anything."
- **The stale build predates that split entirely.** It raises `REQUIRED`, counts
  it against completeness, and deadlocks submission — which is exactly the
  reported 4-of-6 with مطلوب on Services.

**Confirmed cause of the stuck task: the stale API's policy.** The fix already
exists on this branch; the developer's API does not have it.

`onboardingState` and the other axis columns being NULL is the same staleness one
layer down: the schema has the columns, the old build never populates them.

### The product defect found alongside it

The hub copy maps **both** `AVAILABLE` (your input is needed) and `BLOCKED`
(finish an earlier task first) to the single word **Required**, and the sentence
that distinguished them was rendered `sr-only`. A sighted provider staring at two
"Required" rows was told nothing about which one was theirs to act on.

**Repaired:** the explanation now takes the row's existing second line for the
statuses where the badge cannot speak for itself. No line was added — the
reference draws one second line per row — and a real `summary` still wins the
line, because that is the provider's own data. Measured after the change:
hub-partial `0.00173` EN / `0.00133` AR, hub-complete `0.00017` / `0.00069`,
returned `0.00222` / `0.00143` — all inside the 0.005 budget, so no design
conflict.

**Regression:** `OnboardingHubScreen.test.tsx` — "shows that reason ON SCREEN,
not only to a screen reader".

---

## 5. A real defect in the current code, reproduced and fixed

Independent of the stale API, and the one thing here that would have bitten the
user even against a correct server.

`ServicesTaskScreen` derived every toggle's next set from the last
**acknowledged** server state. A second pick made before the first round trip
finished therefore **replaced** it rather than joining it, and the queue merges
by property so the later array simply won. The checkbox also rendered
acknowledged state, so a just-tapped box looked untouched.

Proven with a held acknowledgement — the only way the race is deterministic:

| Action                 | Sent to the server | Lost         |
| ---------------------- | ------------------ | ------------ |
| plumbing, then wiring  | `['wiring']`       | plumbing     |
| tick after a click     | unchecked          | the feedback |
| select, then de-select | `['plumbing']`     | the removal  |
| CAR, then MOTORCYCLE   | `['MOTORCYCLE']`   | CAR          |

**Repaired:** a pending-intent set, ahead of the server, is what the screen
renders and what each new toggle builds on. Authority returns to the server the
moment nothing is queued (`isDirty`), so a moderator's decision or a leaf the
server legitimately dropped still reaches the screen — and a **failed** save
keeps the provider's intent visible rather than silently reverting it.

**Regressions:** 4 component tests with a held acknowledgement, plus real
specialty interaction added to the real-API journey (two rapid picks, a remove
and re-add, membership read from Postgres after approval). Reverting the fix
reddens both the component tests and the browser journey.

---

## 5A. Two evidence defects found while proving the repair

Neither is user-visible, and both made the evidence weaker than it looked.

**`acknowledgedVersion` was always 0.** The marker read `version` from the
draft's `data` projection, where it does not live — it is on the response
ENVELOPE — so it was `undefined` and a `?? 0` fallback wrote `0` into every
marker on disk. Every one claimed the draft had never been written to, for
screens that had just been written to half a dozen times. It is now read from the
envelope and ASSERTED to be a positive integer: a marker whose central claim is
"the server acknowledged this revision" must not be able to say revision 0
because a field moved. Verified: a real journey now records `acknowledgedVersion:
7`.

**A second viewport list.** Adding 393x852 to `PHASE5_VIEWPORTS` moved the
registry unit test from 216 to 252 records and changed nothing the browser
visited, because `phase5-responsive.spec.ts` iterates `RESPONSIVE_VIEWPORTS` — a
hand-written duplicate in the ledger. A passing count over a list nobody runs is
the same vacuous shape as a testid no component renders. `RESPONSIVE_VIEWPORTS`
now derives from the registry, and the artifact records seven widths:
`320, 390, 393, 430, 768, 1024, 1440`, zero problems.

---

## 6. Exact retest recipe

The developer's own stack is **untouched** — no container restarted, no volume
removed, no data mutated. To retest against current code, rebuild the API image:

```bash
cd infra/docker
docker compose up -d --build api        # --build is the part that matters
```

Then confirm the route exists before testing the UI:

```bash
curl -i http://localhost:4000/v1/me/provider/onboarding/markets
# 401 = the route is registered (guard refusing an anonymous call) — good
# 404 = still a stale build
```

The V2 flag is **default OFF**. To see the redesigned journey:

- build-time: `VITE_PROVIDER_ONBOARDING_V2=true`, or
- runtime: `localStorage.setItem('hsm.ff.providerOnboardingV2', 'true')`

A provider whose specialties are all pending will now read "We are checking
this. You do not need to do anything." on the Services row rather than
"Required", and submission is not blocked by that queue.

### What was verified, and on what

|            |                                                                                     |
| ---------- | ----------------------------------------------------------------------------------- |
| Tested URL | `http://127.0.0.1:4174` (vite preview of `apps/web/dist`)                           |
| Bundle     | built with `VITE_API_URL=http://127.0.0.1:4011`, `VITE_PROVIDER_ONBOARDING_V2=true` |
| API        | `node apps/api/dist/main.js` on **4011**, built from this branch                    |
| Database   | throwaway Postgres on **55432** (`hsm-p5-pg`)                                       |
| Viewports  | 390×844 canonical, plus 320/430/768/1024/1440 structural                            |

The reported **393×852** is now in the responsive matrix (structural, not pixel:
the frozen prototype supplies a genuine rendering at 390 and nowhere else, so a
pixel baseline at 393 would be invented rather than approved).

---

## 6A. Evidence artifacts

Playwright traces of the repaired journey, captured with `--trace on` against
the real API and a real database. A trace carries the DOM snapshots, the console
and the full network panel, so it is the before/after record for the reported
requests.

```
apps/web/test-results/phase5-evidence/services-journey-after-repair.trace.zip
apps/web/test-results/phase5-evidence/work-area-journey-after-repair.trace.zip

pnpm --filter @homeservicemarketplace/web exec playwright show-trace <file>
```

Network results extracted from those traces — the counterpart to the reported
404s and the stuck task:

```
work-area journey
  200  GET   /v1/me/provider/onboarding/markets      <- was 404, repeatedly
  200  GET   /v1/me/provider/onboarding/hub
  200  GET   /v1/me/provider/onboarding/draft
  200  PATCH /v1/me/provider/onboarding/steps/LOCATION
  200  GET   /v1/me/provider/profile

services journey
  200  GET   /v1/me/provider/onboarding/hub
  200  GET   /v1/me/provider/onboarding/draft
  200  PATCH /v1/me/provider/onboarding/steps/SPECIALTIES
  200  PATCH /v1/me/provider/onboarding/steps/EXPERIENCE
```

No unexpected 401 or 404 in the repaired happy path.

### The value table, from the markers that journey wrote

Each column is an INDEPENDENT read — the rendered control or the API, a fresh
authenticated session, and a direct PostgreSQL query — not one value copied
across.

| Screen    | Field                    | Intended / API          | After reload | After fresh sign-in | In PostgreSQL | Ack. revision |
| --------- | ------------------------ | ----------------------- | ------------ | ------------------- | ------------- | ------------- |
| Basics    | `displayName`            | `Left Immediately …`    | same         | same                | same          | v7            |
| Services  | `professionSince`        | `2016-12-31T22:00Z`     | same         | same                | same          | v8            |
| Work area | `serviceAreaCity`        | `Aleppo …`              | same         | same                | same          | v7            |
| Hours     | `intervals`              | Sun–Thu 540→1020        | same         | same                | same          | v7            |
| Portfolio | `bio`                    | `I have wired houses …` | same         | same                | same          | v7            |
| Review    | `acceptedConsentVersion` | `v1`                    | same         | same                | same          | v8            |

Specialty membership is asserted separately, because choosing a specialty creates
a PENDING application rather than membership: the journey checks the chosen set
reaches the server as held-or-applied-for, then — after an administrator
approves — that every one has a `ProviderProfileServiceCategory` row.

---

## 7. Still outstanding

- **Whole-flow keyboard traversal, 200% zoom/reflow and reduced-motion** have no
  automated gate. Keyboard operation is proved for the controls added this
  sprint.
- **Manual NVDA / VoiceOver acceptance: not performed.**
- A **second enabled market** journey: the market substates are unit-tested, but
  every real-API journey runs in the one seeded market.
- The design-decision gaps (G-02, G-03, G-05, G-06, G-07, G-08, G-09, G-10,
  G-04 expressiveness, portfolio crop) are unchanged — see
  `PHASE5A_INTEGRATION_GAPS.md`.
