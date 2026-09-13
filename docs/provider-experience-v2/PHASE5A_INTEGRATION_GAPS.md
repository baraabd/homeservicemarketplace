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

### G-01 — `serviceAreaCountry` has no control

**Where** state 6, work area.
**What shipped** one city field, the map band and the reward sentence — the
approved screen exactly.
**The gap** `serviceAreaCountry` is REQUIRED by the completeness policy, and the
approved screen has nowhere to enter it. Existing values are preserved on every
write; a provider who has never had one cannot acquire one from this screen.
**Closing it** the multi-country work (D5-01) already defines six market
substates for exactly this. They are a Phase 5B surface, not a Phase 5A one.

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

### G-12 — the status centre timestamps in the browser's zone

**Where** state 14's header, "Updated today at 12:43".
**What shipped** `profile.updatedAt`, formatted in the reader's own zone.
**The gap** the submission confirmation (state 13) formats in the PROVIDER's
stored zone, taken from the draft. The status centre does not load the draft and
the profile carries no timezone, so the two surfaces can disagree for a provider
who is travelling.

### G-13 — the timezone confirmation has no surface

**Where** state 7. `resolvedTimezone.needsConfirmation` is true for a country
that spans several zones, and the approved screen has nowhere to confirm one.
Existing values are preserved.

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

```
presentation migrated:       6/6
production-route integrated: 0/6
real-API persisted:          0/6
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
