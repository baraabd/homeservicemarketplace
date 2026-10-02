# R10 — Schedule authority matrix

One row per concept of the provider's weekly working hours. `PASS` is given
only where a named test executed and asserted the row; nothing is inferred from
reading code.

Evidence abbreviations:

- **IT** — `apps/api/test/integration/r10-working-hours-durability.integration.spec.ts`
  (real HTTP, real PostgreSQL), 47 tests.
- **E2E** — `apps/web/e2e/r10-working-hours-schedule-durability.real-api.spec.ts`
  (real browser, real API, real PostgreSQL, build-time flag, no override), 17
  tests.
- **ORD** — `…/components/AvailabilityTaskScreen.ordering.test.tsx`, the
  editor against explicit response orderings.
- **UNIT** — the unit spec named in the row.

Shared facts, true for every row unless it says otherwise:

- **Contract:** `availability: { dayOfWeek, startMinute, endMinute }[]` and
  `timezone: string | null` on `PATCH /v1/me/provider/onboarding/steps/AVAILABILITY`.
  Unchanged by R10.
- **Service:** `ProviderOnboardingWizardService.patchStep`, step `AVAILABILITY`.
  Validation (`availability-intervals.ts`) runs before any row is touched.
- **DB representation:** `ProviderAvailabilityInterval(providerProfileId,
dayOfWeek, startMinute, endMinute, timezone)`. CHECK constraints bound the day
  and the minutes and require `start < end`; a UNIQUE constraint refuses an
  exact duplicate. There is no overlap constraint and no single-zone
  constraint in the database: both are enforced by the service.
- **Concurrency rule:** a row lock on the provider profile, the draft `version`
  compared after the lock, and a compare-and-swap on the version bump, all in
  the transaction that deletes and inserts the week.
- **Reload source and fresh-login source:** `GET /v1/me/provider/onboarding/draft`,
  ordered by day then start. The screen holds no copy of its own across a
  reload.

## What the editor can and cannot enter

The approved working-hours screen is a **bulk editor**: one window, applied to
the selected days. It has no control for a second window on a day. So a split
day or two touching windows cannot be typed there. They can be stored (the API
accepts them, and earlier data may contain them), the screen shows them
truthfully, and applying a single window over them asks first. Where a row
below says "API-written", the provider's own session wrote the week through the
real API and the browser then read it.

## Concepts

| Concept                       | UI authority                                                            | API validation                                                                                                                    | Normalization                           | Evidence                                                                                                | Result |
| ----------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| `dayOfWeek`                   | seven toggles, 0 = Sunday                                               | integer 0–6; anything else `400`                                                                                                  | none                                    | IT "REFUSES a day of 7 / a negative day"; E2E journey                                                   | PASS   |
| `startMinute`                 | "From", a native time input                                             | integer 0–1440; text and fractions `400`                                                                                          | none                                    | IT shape table; E2E                                                                                     | PASS   |
| `endMinute`                   | "To"; `00:00` means the end of the day                                  | integer 0–1440, exclusive; must be after the start                                                                                | `00:00` in the To field is sent as 1440 | IT; E2E "hours that end at midnight…"                                                                   | PASS   |
| Timezone                      | none on this screen; stated in the summary                              | a real IANA zone, and one of the market's zones                                                                                   | trimmed; empty treated as not sent      | IT "the timezone belongs to the market…" (9 tests)                                                      | PASS   |
| Empty week                    | select the working days, "Unavailable", Apply                           | `availability: []` accepted, with or without a market                                                                             | none; no default hours anywhere         | IT "an empty week…"; E2E "a new schedule starts empty…", "an empty week is stored as no rows…"          | PASS   |
| Several windows on a day      | not enterable (bulk editor); shown read-only in the summary             | accepted                                                                                                                          | returned in start order                 | IT "keeps several windows on one day…"; E2E "a split day…" (API-written, browser-read)                  | PASS   |
| Interval ordering             | the summary lists windows by start                                      | input order is irrelevant                                                                                                         | rows returned by day, then start        | IT "stores exactly the rows that were sent… in order" (sent unsorted)                                   | PASS   |
| Adjacency                     | not enterable; shown as two windows                                     | `end == next.start` accepted                                                                                                      | not merged                              | IT "accepts touching windows and does not merge them"; E2E split-day test (API-written)                 | PASS   |
| Overlap                       | not enterable                                                           | `422 OVERLAP` on the later-starting row, with `conflictsWith`                                                                     | none                                    | IT, six overlap shapes in both orders, and four orderings among valid windows                           | PASS   |
| Exact duplicate               | not enterable                                                           | `422 OVERLAP`                                                                                                                     | none                                    | IT "an exact duplicate"                                                                                 | PASS   |
| Overnight single window       | refused on the screen with a sentence, before anything is asked or sent | `422 END_NOT_AFTER_START`                                                                                                         | none; never converted                   | IT; E2E "a single window that runs past midnight…"; UNIT `AvailabilityTaskScreen.test.tsx` (R10 cases)  | PASS   |
| Overnight as two windows      | not enterable; shown on both days                                       | accepted as `22:00–24:00` and `00:00–02:00` on the next day                                                                       | none                                    | IT "keeps a shift that crosses midnight as two windows…"; E2E split-day test                            | PASS   |
| Midnight end                  | To `00:00`; summary prints `24:00`                                      | `1440` accepted; a whole day is `0–1440`                                                                                          | none                                    | IT; E2E midnight test (reload keeps `00:00` in the field and `1440` in the row)                         | PASS   |
| Off-grid minute               | the time inputs accept any minute; nothing snaps                        | any integer minute                                                                                                                | none                                    | IT "stores a minute that is not on a quarter hour…"; E2E (09:07–16:53 unchanged after reload and login) | PASS   |
| Maximum interval count        | unreachable (at most seven windows)                                     | 60 accepted, 61 refused (`400` at the DTO; `422` in the service)                                                                  | none                                    | IT "accepts exactly the maximum…"; UNIT `availability-intervals.spec.ts`                                | PASS   |
| Whole-week replace            | Apply sends the complete week                                           | delete and insert in one transaction with the version bump                                                                        | none                                    | IT "replaces the whole week"; "rolls the whole replacement back when the database itself refuses a row" | PASS   |
| Invalid week over a valid one | —                                                                       | the stored week, its row ids, its zone and the version are untouched                                                              | none                                    | IT, every refusal case asserts it                                                                       | PASS   |
| Repeated identical save       | —                                                                       | accepted; stored once; the version advances                                                                                       | none                                    | IT "saving the same week twice stores it once"; E2E "saving the same week again…"                       | PASS   |
| Single-zone market            | —                                                                       | zone derived from the market when none is sent                                                                                    | —                                       | IT; E2E (rows carry `Asia/Damascus`)                                                                    | PASS   |
| Multi-zone market             | zone is chosen on the work-area screen                                  | must be told; only the market's zones accepted                                                                                    | —                                       | IT "a multi-zone market must be told which zone…"                                                       | PASS   |
| No market                     | —                                                                       | hours refused (`TIMEZONE_MARKET_REQUIRED`); an empty week accepted                                                                | —                                       | IT                                                                                                      | PASS   |
| Timezone change               | —                                                                       | every row restamped together; no minute moves                                                                                     | —                                       | IT "changing the zone moves every row together…"                                                        | PASS   |
| Change of market              | —                                                                       | **R10:** stored hours move to the new market's zone in the same write; a multi-zone market reports no zone until one is confirmed | —                                       | IT "the hours follow the provider to a new market" (3 tests, failing before R10); E2E same title        | PASS   |
| Rows in two zones             | —                                                                       | not producible by any route; repaired by the next write                                                                           | —                                       | IT "repairs rows that were left in two zones…"                                                          | PASS   |
| Summary day count             | counts days with at least one window                                    | none (client-derived from the week on screen)                                                                                     | —                                       | E2E "5 days · 24.77 hours" for a week with two split days; UNIT `weekly-schedule.test.ts`               | PASS   |
| Summary total minutes         | sum of every window                                                     | none                                                                                                                              | hours shown to two decimals             | E2E "3 days · 24.75 hours", "5 days · 24.77 hours"                                                      | PASS   |
| Stale version                 | "changed somewhere else", never "saved"                                 | `409`, nothing stored                                                                                                             | —                                       | IT; E2E "a stale second tab…"; ORD                                                                      | PASS   |
| Concurrent writers            | —                                                                       | exactly one wins; the stored week is the winner's, whole                                                                          | —                                       | IT: 12 two-writer rounds, 4 five-writer rounds, 6 zone-versus-week rounds                               | PASS   |

## Ordering of the editor against the server

| Ordering                                            | What was proved                                                                                | Evidence                 | Result |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------ | ------ |
| A late refetch while an applied week is being saved | The applied week stays on screen and is not called saved until acknowledged                    | ORD                      | PASS   |
| An older answer after the acknowledgement           | The draft version decides; the acknowledged week stays                                         | ORD                      | PASS   |
| A week applied while an earlier save is pending     | The earlier acknowledgement does not report it saved; it is sent with the acknowledged version | ORD                      | PASS   |
| A refused stale write                               | Shown as a conflict, sent once, not retried into an overwrite                                  | ORD; E2E                 | PASS   |
| Another provider's draft in the same mounted screen | **R10:** the screen restarts from that draft; no unapplied selection is carried over           | ORD (failing before R10) | PASS   |

The first four held before R10. They are recorded because the profile editor
failed the equivalent questions (the R05 baseline repair) and the schedule
editor had not been asked them.

## Behaviour under failure and on devices

| Scenario                        | What was proved                                                                                                                             | Evidence                                            | Result |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------ |
| Navigation, reload, fresh login | Summary, toggles and times equal the rows in a browser that shares nothing with the writer; reading back writes nothing                     | E2E journey (four weeks)                            | PASS   |
| Lost response                   | Stored once; shown as not saved; a retry is refused with `409`; a reload finds the week                                                     | E2E "a week whose acknowledgement is lost…"         | PASS   |
| Offline                         | Not called saved; nothing reaches the server; written once on reconnect                                                                     | E2E "an offline week…"                              | PASS   |
| Lost session                    | Refused, nothing stored, sign-in required; the stored week is shown afterwards                                                              | E2E "hours applied after the session is lost…"      | PASS   |
| Account isolation               | A second provider sees none of the first's hours; writes, clears and the first's version number land only on the caller                     | IT "one provider cannot reach…"; E2E isolation test | PASS   |
| Arabic, right-to-left, by touch | At 360, 390 and 430 px: no sideways overflow, 44 px targets inside the viewport, Arabic day names and messages, times left-to-right         | E2E "Arabic, right-to-left, {360,390,430}px wide…"  | PASS   |
| Keyboard                        | Tab order days → From → To; Space and Enter toggle a day; Enter applies; labelled fields; the result is announced                           | E2E "the week can be set with the keyboard alone"   | PASS   |
| Database failure mid-replace    | A real PostgreSQL refusal of the insert, after the delete has run, leaves the previous week whole and the database's words out of the reply | IT, by a temporary trigger scoped to the fixture    | PASS   |

## Not applicable, and why

| Concept                                   | Why                                                                                       | Result         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- | -------------- |
| Adding or removing a window on the screen | The approved screen has no such control. R10 does not redesign the editor                 | NOT APPLICABLE |
| A timezone control on this screen         | The zone is the market's. A multi-zone market is confirmed on the work-area screen        | NOT APPLICABLE |
| Server-side summary                       | The server computes no day count or total; the screen derives both from the week it shows | NOT APPLICABLE |
| Appointments and DST                      | Nothing converts weekly minutes to instants. See `APPOINTMENT_DST_POLICY.md`              | NOT APPLICABLE |
| Holidays, exceptions, vacation            | Not part of the model                                                                     | NOT APPLICABLE |
