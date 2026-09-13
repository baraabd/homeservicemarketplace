# Sprint 09B.29 Phase 5A — integration gaps carried into 5B

Phase 5A was a **UI-only** migration: the eighteen approved screens, rendered by
the real V2 components, measured against the frozen prototype. It changed no
contract, no endpoint and no server policy, and it was not allowed to.

Matching the approved design exactly surfaced places where the design asks for
something the current API cannot supply, or stops asking for something the API
still requires. Each is recorded here with what shipped, what is missing, and
what it would take to close.

**None of these is a deviation from the prototype.** A deviation is a deliberate
difference needing a product-owner decision and belongs in
`PHASE5_DEVIATION_REGISTER.md`. These are places where the product and the
platform have not met yet.

---

## Data the approved screens no longer collect

### G-01 — `serviceAreaCountry` has no control — **CLOSED in Phase 5B**

**Where** state 6, work area.
**What shipped in 5A** one city field, the map band and the reward sentence —
the approved screen exactly.
**The gap** `serviceAreaCountry` is REQUIRED by the completeness policy and the
approved screen had nowhere to enter it. This was the most serious of the
fourteen: existing values were preserved on every write, so it was invisible to
anyone whose market was already recorded, but a provider who never had one could
finish all six tasks and be refused at submission with no screen able to fix it.
Onboarding was, for them, unfinishable through the UI alone. Every test missed
it because the harness sets the country through the API.

**Closed by** `useSupportedMarkets` and `MarketPicker`, asked **only when the
server's answer makes it necessary**: no market recorded, the operator has
withdrawn from theirs, or the country does not pin a timezone. In the settled
case it renders nothing at all, which is why the canonical cell for state 6 is
byte-for-byte unchanged and the approved design is untouched.

The choice is written through the same autosave coordinator as every other field
on the screen, so it is drained by the exit contract like any other unsaved
work, and the server validates both the ISO code and the market's enablement on
the write — this is a projection of the operator's list, not a second gate.

### G-13 was the same surface, and is closed with it

The timezone confirmation `resolvedTimezone.needsConfirmation` asks for is the
`CONFIRM_TIMEZONE` branch of the same prompt, writing `timezone` instead of
`serviceAreaCountryCode`. See G-13 below.

### G-02 — radius is no longer provider-adjustable

**Where** state 6.
**What shipped** the server's `radiusPolicy.suggestedKm`, committed once, drawn
as the approved map band.
**The gap** the reference shows a fixed "15 km" ring and no control. A provider
who wants 10 km cannot ask for it here.
**Closing it** decide whether the radius is a provider choice at all. The
expansion ladder implies it is earned rather than chosen, in which case the
approved screen is right and nothing is missing.

**Test consequence, recorded in 5B** the real-API persistence test for this
screen used to drag a `radius-slider`, so it failed permanently once the
approved screen shipped. It now proves the CITY instead — the one answer the
approved screen does let a provider give. Retargeting rather than deleting
matters: the screen still has durable state, and a test asserting a control the
design removed proves nothing while looking like coverage.

### G-03 — device location is not offered

**Where** state 6. The reference shows a static map band with no "use my
location" affordance. `geo-bootstrap.ts` still exists and is unused by this
screen.

### G-04 — availability presets and per-day editing are gone

**Where** state 7, working hours.
**What shipped** seven day toggles, one From/To pair, Apply, and the
"Unavailable" consent row — the approved screen.
**The gap** a provider who works 09:00–17:00 on four days and 09:00–13:00 on
Thursday cannot express that here. The API stores per-interval times and the
hub summary already declines to state a single window when the week is not
uniform, so the DATA supports it and the screen does not.

### G-05 — VAN and TRUCK are not drawn

**Where** state 5, experience and transport. The approved screen shows four
modes. `toggleMode` preserves any unlisted mode already stored, so a provider
with a van keeps it; they cannot add one here.

### G-06 — primary specialty has no change control

**Where** state 4. The server owns `primarySpecialtyId` and the approved screen
shows no way to move it.

### G-07 — the bio minimum is learned at submission

**Where** state 8. The approved screen has an input cap (2,000) and no counter
and no minimum hint. The server still enforces a minimum, so a provider can write
a short bio, leave, and meet the rule for the first time as a blocker on the
review screen.

**Test consequence, recorded in 5B** the persistence test for this screen used to
type into a `title-input`. The approved profile screen has no such field — the
professional title is server-generated under ruling C1, and two other specs
already assert its absence — so the test now proves the BIO, which is what a
provider actually composes here.

### G-08 — equipment is not collected

**Where** state 5. Carried from the migration matrix, still **OPEN**: no ruling
names equipment, the approved screen shows none, the completeness policy never
asks for it, and stored values are untouched.

---

## Prose the API sends in one language

### G-09 — per-task summaries are composed on the client

**Where** state 10, the complete hub, and state 11, the review rows.
**What shipped** "Aleppo • 15 km", "Sunday–Thursday • 09:00–17:00", "3 photos
uploaded" — composed from the DRAFT in `hub-task-summary.ts`.
**The gap** the hub response carries a static English sentence per task id, so
these cannot come from the wire without a server change — and they must be
bilingual, which a single-language field cannot be. Composing them client-side is
projection rather than policy (every value is one the server stored), but it
means two places now know how to phrase a work area.
**Closing it** the hub response should carry per-task summaries in both
languages.

### G-10 — `profile.rejectionReason` is one free-text field

**Where** state 15, action required.
**What shipped** the note split for display — first sentence as the heading, the
rest as the paragraph (`splitReturnReason`). No word is added, removed or
rephrased.
**The gap** two problems in one field. It cannot structurally carry both the
instruction and the explanation the approved screen draws, and it is stored in
whichever language an operator typed it, so an Arabic reader can be handed an
English sentence.
**Closing it** a reason CODE plus an operator note, the way review blockers
already work — which fixes both halves at once.

---

## Server facts the screens project rather than read

### G-11 — the verification axis is inferred — **CLOSED in Phase 5B**

**Where** states 14 and 17, the status centre.
**What shipped** `profile.verified`, plus whether the application has been handed
in, projected onto Verified / In review / Not started.
**The gap** `GET /me/provider/verification/case` carries a real state machine
(outstanding requirements, unusable documents, scanning) and this row read none
of it. Two cases were wrong in the same direction: a provider whose documents
were sent back saw "In review", and so did one whose case was refused. Both are
somebody waiting for a queue they are not in.

**Closed by** `ProviderStatusCentreScreen` now reading the case and mapping its
state, with ACTION_REQUIRED, REJECTED and EXPIRED as their own answers, and an
explicit "Unavailable" when the request fails rather than a guess of
"Not started" — which would invite a provider to redo work already done.

**What proves it** 22 unit tests over the mapping, plus a per-row assertion in
the visual gate. The second one mattered more than expected: the first version
asserted the phrase "In review" anywhere on state 14, and that passes when the
verification row has fallen back to "Unavailable", because the SPECIALTY row
says "In review" too. Stubbing the case endpoint to return `null` proved the
page-wide check green and the row-scoped one red. The gate now reads
`[data-testid="axis-<row>"]` and checks the word and the tone.

### G-12 — the status centre timestamps in the browser's zone — **CLOSED in Phase 5B**

**Where** state 14's header, "Updated today at 12:43".
**What shipped in 5A** `profile.updatedAt`, formatted in the reader's own zone.
**The gap** the submission confirmation (state 13) formats in the PROVIDER's
stored zone, taken from the draft. The status centre did not load the draft, so
the two surfaces timestamped the same application an hour apart for a provider
who was travelling, with nothing to say which was meant.

**Closed by** the status centre reading the draft for its zone —
`data.timezone`, then `resolvedTimezone.resolved`, then the device as before.
The draft is deliberately NOT part of the readiness gate: `isFetched` is true
after a failure as well as a success, so a draft that cannot be read costs the
provider nothing worse than the zone their own device reports, rather than
costing them the status screen. An IANA id the platform rejects falls back the
same way instead of throwing.

**What proves it, and what did not** two unit tests: one that the header renders
in the provider's zone, one that it still renders when the draft fails.
Reverting the change turns the first red.

The visual gate could not see this at all, and that is the more useful finding.
The fixture pinned the profile update to 12:43 in **UTC** while telling the same
server the provider was in Asia/Damascus — so the cell only ever matched because
the runner happened to be at UTC too. Moving the fixture to
America/Los_Angeles left state 14 **green**: two changed digits are a few
hundred pixels out of 329,160, which is two orders of magnitude inside the 0.5%
budget.

So the fixture now states 12:43 in the provider's zone, and `12:43` — with
`١٢:٤٣` for Arabic, which also pins the numeral system — is asserted as
required copy. With that in place the Los Angeles mutation fails in both
languages. A budget that cannot see a wrong hour is not a check on the hour, and
the same blind spot is what hid G-11 behind a page-wide phrase search.

### G-13 — the timezone confirmation has no surface — **CLOSED in Phase 5B**

**Where** state 7. `resolvedTimezone.needsConfirmation` is true for a country
that spans several zones, and the approved screen had nowhere to confirm one.

**Closed by** the `CONFIRM_TIMEZONE` branch of the market prompt described
under G-01 — the same surface, the same autosave path, and the same rule that it
appears only when the server says it is needed. A country that pins one zone
draws nothing.

### G-14 — a finished task was a blank screen — **CLOSED in Phase 5B**

**Where** every task screen, reached after the task completes.

**What shipped** the body was drawn only for a task the server calls
`AVAILABLE`. `COMPLETE` is not available, and `statusExplanation` answers only
`WAITING` and `BLOCKED` — so a completed task rendered no form AND no reason.
The provider got a header, a progress bar and a "Save and continue" with
nothing between them.

**How it was found** not by inspection. The Phase 5B real-API run failed looking
for `bio-input` and `field-displayName` after a reload, and the saved page
snapshot showed an empty `<main>`. Asked of the live server directly, PATCHing
a display name and a phone moves BASICS_IDENTITY to `COMPLETE` — so the path is
ordinary: finish task 1, press reload.

The hub row for a finished task is a non-interactive `<div>`, so this could not
be reached by clicking, which is presumably why it went unseen. It is reachable
by reloading the screen you just completed, and by any deep link to it.

**Closed by** `OnboardingTaskScreen` drawing the body for `COMPLETE` as well.
A completed task is still the provider's to revise until the application is
handed in; whether the fields ACCEPT input remains the server's answer, through
the draft's own `editable`, which is false after submission and renders every
body read-only.

**What proves it** two unit tests — one for the COMPLETE case, one asserting the
general rule that no task status may leave the screen with neither a body nor an
explanation. Reverting the one-line change turns both red.

---

## What Phase 5A deliberately did not earn

The Phase 5 ledger reports three counters, computed from artifacts on disk:

As Phase 5A left them:

```
presentation migrated:       6/6
production-route integrated: 0/6
real-API persisted:          0/6
```

As Phase 5B leaves them:

```
presentation migrated:       6/6
production-route integrated: 6/6
real-API persisted:          6/6
```

The second and third are **not** failures of this phase. Every Phase 5A artifact
is filed under `PROVISIONAL_UI`, a namespace the ledger keeps permanently
separate from `FINAL_REAL_API`, because the visual gate stubs the API. A screen
that passes every cell has been shown to RENDER correctly and to be free of axe
violations. It has not been shown to talk to a server, and nothing in this phase
claims it has.

Route and persistence credit need a real-HTTP, flag-ON run that stamps its own
`interceptionFree` marker, and a persistence marker recording hydration, hub
navigation, hard reload, fresh sign-in and a database assertion. That is Phase
5B's first job.

### The portfolio promised reordering and provided none — G-18 — **CLOSED in Phase 5B**

**Where** state 9, the portfolio.

**The defect** the approved screen's own hint reads **"Crop and reorder before
saving."** (`يمكنك القص وإعادة الترتيب قبل الحفظ.`), and the grid labels its
first tile "Cover photo" — so order is meaningful and the provider has been told
in writing that they can change it. Nothing on the screen could. Meanwhile
`POST /v1/me/provider/portfolio/reorder` had existed the whole time, and the web
client already wrapped it in `useReorderPortfolio`. A missing affordance, not a
missing capability, and a promise the UI broke.

**Why keys rather than a handle.** The reference draws no drag handle, no arrows
and no reorder button. Adding any of them puts pixels on state 9 that the frozen
prototype does not have, and the budget must not be widened to accommodate a
control the design did not draw. So the TILE became the control: focusable, with
arrow keys moving the photo it holds, Home making it the cover. Nothing is added
at rest — state 9 measures 0.00124 EN / 0.00108 AR, unchanged — and the screen
gained a keyboard path a drag handle would not have given it.

Deliberately no visible text inside the tile button: this codebase's base layer
gives a `button` a 500 weight and a 1.5 line-height, so the "Cover photo"
caption stays outside it. The instruction that makes the keys discoverable is
`sr-only` and wired through `aria-describedby`, because an arrow-key affordance
nobody is told about is not an affordance — and because the reference does not
draw that sentence either.

**RTL is a correctness question, not a styling one.** In Arabic the first tile is
on the right, so LEFT moves a photo later. The mapping is resolved against the
document direction, and a test asserts it — the pixel gate cannot see a photo
moving the wrong way, and every Arabic provider would have hit it.

**What proves it**

- six component tests: move later, Home-to-cover, refusal at both ends, the RTL
  reversal, the locked application, and the accessible name and description.
  Reversing the direction mapping turns the Arabic one red.
- one real-API journey: three photos uploaded through the real
  presign → PUT → register path (fixture setup, so the test does not perform the
  edit it is proving), reordered **from the keyboard in the browser**, then
  checked against the server's order, the DOM order, a hard reload, a fresh
  authenticated session, and the `position` column read straight from Postgres.
  Stopping the mutation from reaching the server turns it red.

**Still open on this screen:** crop. The hint promises it and the approved screen
draws no cropper; `image-processing.ts` can rotate, centre-crop and downscale,
but an interactive cropper is a new surface and needs a product decision about
what it looks like. Recorded rather than improvised.

### The third throttle — G-19

Fixing the OTP limiter (G-16) moved the failure rather than removing it: the job
then hit `429` on `GET /me/provider/onboarding/draft`, the coarse per-IP
backstop of 100 requests per rolling minute that every route sits behind.

Two changes, in that order, because only one of them is a configuration change:

1. **The suite stopped asking.** `patchStep` re-read the draft before every
   write to learn its version — a GET per PATCH, roughly a hundred and forty of
   them across the suite, each to discover a number the previous response had
   already returned. The version is now THREADED: each write returns the version
   it reached and the next one uses it. That is also the correct
   optimistic-concurrency discipline; read-then-write is a race by construction,
   however short the gap.
2. **The backstop became configurable**, like its two siblings:
   `GLOBAL_THROTTLE_LIMIT` / `GLOBAL_THROTTLE_TTL_SECONDS`, defaulting to the
   production values, read through `AppConfigService` in the module that already
   had DI, with `env.validation.ts` refusing to boot a hardened environment
   above 100 or below a minute. Raising it widens only the backstop; the
   route-level guards in front of it are untouched.

Verified against a running server: the throttled routes report
`X-RateLimit-Limit: 5000` with the override and `100` without it.

**The pattern worth naming:** three limiters, three sprints apart, each
discovered the same way — a legitimate suite from one IP looking exactly like
abuse. Registration got its override in Sprint 1. OTP verification and the global
backstop got theirs here. When a new route gets a tighter limit than the
backstop, it needs the same treatment on the same day, or the next long suite
finds it.

### The real-API job's twelve failures were three causes, and mostly one — G-16

The `phase5-real-api` job on `ec9b956` reported **12 failed, 11 passed**. Read as
twelve problems it looks like the integration is broadly broken. Read from the
annotations it is three, and the largest by far is a single number.

**C — eight identical 429s.** `Error: OTP verification should succeed |
Expected: 200 | Received: 429` at `real-api.ts:191`. `POST /v1/auth/verify-otp`
carried `@Throttle({ limit: 20, ttl: 60s })`, IP-scoped, and the job registers
a fresh account per test from one address.

The registration limiter already had an override for exactly this reason —
`AUTH_REGISTER_THROTTLE_LIMIT: '200'`, documented as "NOT a production knob" —
and the OTP limiter had none. That inconsistency is the whole defect: the job
could **create** accounts freely and then could not **confirm** them. Closed by
giving the OTP budget the same treatment as its sibling:
`AUTH_OTP_VERIFY_THROTTLE_LIMIT` / `..._TTL_SECONDS`, defaulting to the
production values (20 per rolling minute), read per request from the validated
environment, with `env.validation.ts` refusing to boot a hardened environment
above the ceiling or below the window. Nine unit tests cover the ceiling, the
staging refusal, the tighter-than-default case and the short-window refusal.

Proven against a running server rather than by reading the diff: with the
override set the route answers `X-RateLimit-Limit: 400`, and without it `20`.

**B — one PATCH refused for a malformed version**, which was C wearing a
disguise:

```
PATCH PROVIDER_TYPE should be accepted:
  "version must not be less than 0; version must be an integer number"
```

That reads like a contract bug in the wizard. It is not. `currentVersion()` did
`return draft.body.version` **with no status check**, so when the unverified
session made the draft GET fail, `version` was `undefined`, and the next call
reported the server's validator complaining about a value the harness had
invented. Closed by asserting the draft read succeeded and that the version is a
non-negative integer, at the read — so a broken fixture names its own cause
instead of describing the symptom one call later.

**A — `expected 9, received null`.** The genuine third cause, and the only one
about product behaviour: the approved experience screen is a stepper that stores
`professionSince` (a date, so experience does not silently stop ageing) and
derives the displayed years. `yearsOfExperience` legitimately stays null. The
test asserted the wrong column. It now drives the stepper unconditionally and
asserts the stored date's year — and the fix that mattered was reading each
representation on its own terms: `professionSince` is
`timestamp without time zone`, so node-postgres materialises it as LOCAL
midnight and `getUTCFullYear()` reported the previous year on this UTC+3 host,
while the same fact from the API arrives as an ISO string with a `Z` where UTC
is correct.

**The lesson:** twelve failures, three causes, one of them responsible for nine.
A count of red tests is not a count of defects, and the cheapest thing to do
with a long failure list is to read it for repeats before reading it for
variety.

### A failure that moves between runs is usually one cause — G-17

Three local runs of the same suite failed on three different tests:

```
run 1  'a task edited in the browser is persisted'   (timed out)
run 2  'a direct task deep link opens that task'     (timed out)
run 3  'review blockers agree with the hub'          401 from the admin queue
```

The 401 named it. `JWT_ACCESS_TTL_SECONDS` defaults to **600**, and the
harness memoised one admin session for the lifetime of the worker with nothing
to renew it, so every admin call after minute ten failed — landing on whichever
test happened to run next. `adminJar()` now renews through the real refresh
endpoint once the session is older than half the TTL, and signs in again only if
the refresh token has gone too. Proactive rather than a retry on 401: nothing in
this suite should learn that a 401 is something to retry past.

Two of those three runs were additionally slowed by an API typecheck running
concurrently on a memory-constrained host — the API answered a registration in
**11.7 s** — which is a measurement error of mine, not evidence about the
product. Both runs were discarded rather than interpreted.

### What 0/6 actually meant — G-15

Phase 5B produced those markers, and the counters **stayed at 0/6**. The reason
was not evidence. It was one argument.

`creditFor(root, screen, …)` took a **single** root and read all three kinds of
evidence under it, and the report passed `PROVISIONAL_ROOT`. So route and
persistence were looked for in `PROVISIONAL_UI/route` and
`PROVISIONAL_UI/persistence` — directories the visual gate never writes,
because it is the stubbed run, and that the real-API job never writes to,
because it correctly files under `FINAL_REAL_API`. Six correct route markers and
six correct persistence markers could sit on disk and the ledger would report
nothing.

This was the more dangerous of the two failure modes available here. A missing
marker reads as "the work has not been done" and invites more testing. A counter
pinned by arithmetic reads exactly the same way, and no amount of further
testing moves it. The honest 0/6 of Phase 5A and this silent 0/6 were
indistinguishable from the outside — which is why it survived being _explained_
in this very document.

`creditFor` now takes the real-API root separately, defaulting to `root` so the
ledger's own unit tests still exercise the mechanism under one temporary
directory, and the report and the conformance test pass `FINAL_REAL_API_ROOT`
explicitly. The counters moved the moment the argument was added, with no new
evidence produced.

**The lesson worth keeping:** a counter derived from artifacts is only as
trustworthy as its path arithmetic, and a counter that reads zero should be made
to read non-zero once, deliberately, before it is believed.
