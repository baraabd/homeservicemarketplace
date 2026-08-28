# Sprint 9B.21 — Task 4: the weekly schedule, in one screen

V2 Task 4 behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**.

**No schema change and no migration.** The audit found the existing model
already did everything this sprint needs; the work was entirely in how the
provider is asked.

---

## 1. The audit came first, and it decided the shape

| Question                                  | Answer                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Who reads `ProviderAvailabilityInterval`? | **Only the onboarding wizard.** No matching, bidding, booking or customer surface touches it.   |
| Multiple windows per day?                 | **Yes** — up to 60 across the week, overlap-validated.                                          |
| Is a bulk write atomic?                   | **Yes** — `replaceAvailability` is `deleteMany` + `createMany` inside the wizard's transaction. |
| Overnight windows?                        | **Rejected** by the server.                                                                     |
| Where does the timezone come from?        | Per interval, and resolvable from the country by Sprint 9B.19's `resolvedTimezone`.             |

Two consequences shaped everything else:

- **Nothing downstream could break.** The grid is write-only outside
  onboarding, so replacing the editor carries no scheduling risk. Worth
  stating plainly rather than discovering later.
- **Atomicity is not something to add.** Because the API takes the WHOLE week
  and replaces it in one transaction, the way to make a partial bulk update
  impossible is to make sure no request ever carries part of a week. Every
  edit on this screen sends all seven days. There is no code path that sends
  three of five.

One documentation defect found: the contract comment claims "the wizard splits
[an overnight window] before sending". It never did — V1 simply requires
`start < end`. The comment is now the only place that claim exists, and the new
editor makes the state unreachable rather than splitting it. Splitting would be
wrong anyway: 22:00→02:00 becomes work on a day the provider did not choose.

---

## 2. What replaces the card stack

V1's step is a list of rows, each carrying its own day dropdown and its own two
time fields. Sunday–Thursday is **five rows, five day dropdowns, ten time
fields** — and five chances to pick the wrong day.

V2 is:

1. **Tap the days** — seven toggles, or one of two explicit presets.
2. **Choose the hours** — two selects.
3. **Apply.**

Then a seven-row summary, one line per day, with the day's windows or
`Unavailable`, and per-day controls to edit or clear. Seven rows, always —
whether the provider works one day or all seven.

**The preset is an offer, not a default.** "Sunday–Thursday" selects days and
stops; nothing is written until hours are chosen and apply is pressed. A preset
that silently filled in a working week would be the platform deciding when
somebody works. Asserted in the component suite and again in the browser.

---

## 3. Invalid states are unreachable, not merely rejected

The brief asks the editor to "prevent UI states the API cannot persist".
Validating afterwards is the weak form of that — it lets the state exist and
then complains. `weekly-schedule.ts` is built so it cannot:

| Failure              | Why it cannot happen                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| End before start     | The end control's options are **derived from the chosen start** — only later times are offered.        |
| Overnight window     | Same mechanism: there is no option before the start, so a wrap cannot be expressed.                    |
| Duplicate window     | `applyToDays` **replaces** a day rather than appending, so applying twice is idempotent.               |
| Overlapping window   | `addWindow` / `replaceWindow` refuse and return the week **unchanged**, with a message naming the fix. |
| More than 60 windows | Guarded in the same place.                                                                             |

`validateWeek` exists anyway and is used as the **property tests' oracle**:

> No sequence of editor operations, from any reachable week, produces a
> schedule the server would reject.

400 seeded random operation sequences, 25 operations each, drawn the way the
controls draw them. The generator is seeded, so a counterexample arrives with
the seed and the operation trail that produced it rather than as a story about
randomness.

**The server remains the enforcement point.** The web bundle cannot import the
API's validator (and importing runtime values from `contracts` breaks the
production Rollup build — Sprint 9B.17), so the client rules are a mirror. The
integration suite closes that gap: it proves the server still refuses an
overnight, inverted, overlapping or duplicated week, so a drift in the mirror
surfaces as a 422 and never as a silently-persisted bad schedule.

---

## 4. Time controls: a native `<select>`, not `<input type="time">`

`endMinute` is **exclusive**, so a window running to midnight is `1440` — a
value a clock input cannot express at all. Beyond that, a select:

- opens the platform's own picker on a phone;
- **raises no keyboard**, which is most of "the keyboard must not cover the
  last schedule row" solved by construction rather than by measuring;
- renders identically under RTL, with no locale AM/PM parsing to get wrong;
- lets the end options be a function of the start, which is what makes an
  inverted range unpickable.

The cost is granularity: the grid is 15 minutes, so `09:05` cannot be _entered_
here. A stored off-grid value — a row saved through V1's free-text input — is
**preserved and offered**, never snapped, because silently moving somebody's
saved hours is worse than an odd-looking option. Tested both ways.

---

## 5. Atomic autosave

Every mutation goes through one `commit`, which sends the complete week. The
server replaces it in one transaction. The integration suite proves the parts a
component test cannot see, against a real Postgres:

- a five-day apply that fails validation leaves the **previous** week exactly
  as it was;
- a write that loses the version race rolls back the delete too — the provider
  is never left with no schedule at all, which would be worse than the bad one
  they tried to save;
- two genuinely concurrent bulk applies produce **one winner and one 409**, and
  the stored week is one of the two, never a mixture;
- the loser succeeds once it re-reads the version, so the conflict is
  recoverable rather than a dead end.

**A note on request counts.** The autosave debounce legitimately coalesces a
bulk apply and an immediate per-day fix into a single request. An e2e assertion
that demanded two requests failed for that reason, and the assertion was wrong,
not the app — a component test with a held-open response proved an in-flight
edit is never dropped. The e2e now asserts on the **final payload**, which is
the property that matters; asserting on the count would have been asserting on
the debounce.

---

## 6. Time zones, stated rather than asked

Sprint 9B.19 resolves the zone from the country and left the ambiguous case to
this step. So:

- resolved → the screen **says** "Times are shown in Damascus time (UTC+3)".
  No IANA identifier reaches the UI.
- ambiguous → a select appears, and hours cannot be applied until it is
  answered, because the server requires a zone before it will store a window.
- changing the zone **re-stamps the whole week**, never half of it, and leaves
  the hours themselves exactly where they were — a re-stamp is a change of
  label, not a change of time.

---

## 7. A latent test-isolation bug this sprint exposed

CI failed on a suite this branch does not touch:
`work-access-enforcement.integration.spec.ts`, asserting `scanned: 0` from the
verification expiry sweep.

`VerificationExpiryService.runOnce` is a **queue consumer**: it scans every
ACTIVE grant table-wide for one that is due, and `scanned` is a global count.
No fixture prefix can hide another suite's grant from it — and worse, the
sweep can EXPIRE that other suite's grant, breaking a suite that did nothing
wrong. The assertion had been true only by luck of worker ordering; adding a
new suite shifted the schedule and put a grant-creating suite alongside it for
the first time.

Fixed with the mechanism `db-isolation.ts` already documents for exactly this
case (it is what the outbox queue uses): a new `workAccessGrants` advisory
lock, taken EXCLUSIVE by the sweep suite and SHARED by the five suites that
create grants.

**Acquired last, everywhere.** Every suite now takes
`providerLifecycle -> outbox -> workAccessGrants` in that order. Two suites
taking two locks in opposite orders is a deadlock, and a deadlocked CI job
looks like a hang rather than a failure. Verified by running the six
contending suites together at `--maxWorkers=4`, twice.

Not papered over with a retry, and the assertion was not weakened.

---

## 7. Evidence

| Gate                                    | Result                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| api lint / typecheck / build            | pass                                                   |
| api unit (hermetic)                     | 2872 passed, 521 DB-gated skipped                      |
| **api with DB + Redis gates ENABLED**   | **3393 passed, 0 skipped / 184 suites**                |
| web lint                                | 0 errors (32 pre-existing warnings, none in new files) |
| web typecheck / production Rollup build | pass                                                   |
| web unit                                | 1248 passed / 91 files                                 |
| **property tests**                      | 400 seeded operation sequences + 200 wire round-trips  |
| web e2e (Playwright ×3 viewports)       | see the PR — full sharded run                          |
| **migration drift**                     | no difference detected (no schema change)              |
| `pnpm audit --prod --audit-level high`  | no known vulnerabilities                               |
| lockfile                                | unchanged (no new dependency)                          |

Postgres and Redis for the gated run were throwaway containers on 15433 /
16380, never the developer's Compose volumes.

### Not in scope

- **The V1 wizard step is untouched.** With the flag off, providers get exactly
  what they get today.
- **A copy-week-to-another-week action.** Useful, and not what the brief asked
  for; the bulk editor already collapses the case it was for.
