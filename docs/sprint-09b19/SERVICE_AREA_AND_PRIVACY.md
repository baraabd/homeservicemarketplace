# Sprint 9B.19 — Task 3: service area, location privacy, suggested radius

Web behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**. The API
changes are additive and unflagged; see §7.

---

## 1. The audit came first, and it changed the plan

Before writing anything I traced every path a provider's location could take
out of the system.

**Result: nothing leaks today.** Every route carrying coordinates
(`ProviderProfileSummary`) is under `me/provider` — the provider's own data.
`ProviderBidSummary`, which is what a _seeker_ sees of a provider, carries no
location field at all: not a coordinate, not even a city. The 9B.9 redacted
preview redacts service _requests_ and its `PreviewItem` allowlist has nowhere
to put a coordinate.

So this sprint's privacy work is **proof, not repair** — see §4.

The audit also found two things that shaped the design:

- **The `City` / `District` / `Neighborhood` tables are never seeded.** They
  are an empty spine. Free-text `serviceAreaCity`, normalised to
  `serviceAreaCityKey`, is what matching actually uses. A city _picker_ over an
  empty table would have blocked the task outright, so the manual fallback is
  text + country.
- **Syria was not in the country list.** The seed data uses Damascus and
  Aleppo, the Arabic copy is written for that market, and the timezone resolver
  maps `SY` — but `COUNTRY_DIAL_CODES` had no entry, so the country picker
  could not offer the platform's primary market. Added, with Iraq and Yemen.

---

## 2. Completing the task without device permission

This is the load-bearing acceptance criterion, so the screen is built manual-first:

- **No permission prompt on mount.** Geolocation is behind a button the
  provider presses. Firing a prompt at someone who has not been told why is how
  people learn to hit "block" reflexively.
- **The manual fields are present before any permission decision** — city,
  country, radius. Everything the server needs is typed.
- **A refusal is a fact with a way forward**, not an error to clear: "That is
  fine — fill in the city and country below and carry on."

A guard bug was found by its own test and fixed: `'geolocation' in navigator`
is true even when the value is `undefined` (a locked-down or embedded browser),
so the screen crashed at the exact moment the fallback should have taken over.
It now checks the function.

---

## 3. Radius: policy-driven and auditable

Eight new platform settings — one suggestion per transport mode, plus a floor
and a hard ceiling. **No distance appears in React.**

`resolveRadiusPolicy` reads the operator's numbers and returns
`{ suggestedKm, minKm, maxKm, basedOn }`. The client renders those bounds on
the slider, so the control cannot offer a value the save will refuse, and the
server enforces the same policy on write — the DTO's `@Min/@Max` remain only as
a blast radius.

Details that matter:

- **`basedOn` is returned** so the UI can say _why_: "Suggested because you
  travel by car." An unexplained default looks arbitrary and gets ignored.
- **Unknown transport falls back to the most conservative suggestion** (on
  foot), not a separate "default" setting nobody would tune.
- **A per-mode suggestion outside the floor/ceiling is clamped.** The settings
  validate independently, so that combination is reachable, and an unclamped
  suggestion would be a number the provider is not allowed to keep.
- The shipped ceiling is asserted to stay within `MAX_SERVICE_AREA_RADIUS_KM`,
  the matching blast radius.
- Copy makes **no volume promise**. "Reach more customers" is a guarantee the
  marketplace cannot keep, and the provider who drives further on it pays for
  the fuel. A test forbids that phrasing.

---

## 4. Proving the privacy claim

`location-privacy.spec.ts` is deliberately **structural** rather than
behavioural — a test of one endpoint's behaviour passes forever while a new
endpoint leaks. It asserts:

- `ProviderBidSummary` declares no coordinate, address **or city** field;
- `PreviewItem` has nowhere to put a coordinate outside the snapped cell;
- redaction never emits the source coordinates — the serialised payload
  contains neither number;
- snapping is deterministic and maps every point in a cell to one output (the
  property that makes it safe where jitter is not);
- the onboarding wizard logs no coordinate field;
- the analytics read-model selects no coordinate column.

The screen also **shows an area, not a pin**. A marker on the provider's base
would show them exactly the thing the privacy note promises nobody else can
see, and would teach them the pin is what gets published.

---

## 5. Timezone, resolved rather than asked

`Asia/Damascus` is a database convention, not a question about someone's
working hours. The server resolves the zone from the country **code** and the
UI shows a city and an offset — "Damascus time (UTC+3)".

Where a country genuinely spans several zones (`US`, `RU`, …) the resolver
returns `AMBIGUOUS` rather than guessing: a guess is indistinguishable from an
answer and would shift every window the provider enters. Those cases defer to
the availability step, which is the one place an identifier may reasonably
appear. A country we have not mapped is `AMBIGUOUS` too, not a failure.

The offset is computed per render, never cached — a stored offset is wrong for
half the year.

---

## 6. Country: display name and code, side by side

`serviceAreaCountry` keeps its meaning (the display name, in the provider's
language) and `serviceAreaCountryCode` is added beside it. Nothing is
backfilled: mapping arbitrary prose in many languages back to a code is
guesswork, and a wrong code is worse than an absent one because everything
downstream would trust it.

**Rollback proven against a real Postgres:** dropping the column leaves the
display name intact and every current reader unaffected.

---

## 7. Evidence

| Gate                                   | Result                                                 |
| -------------------------------------- | ------------------------------------------------------ |
| api lint / typecheck / build           | pass                                                   |
| api unit                               | 2807 passed                                            |
| **api with DB + Redis gates ENABLED**  | **3284 passed, 0 skipped**                             |
| web lint / typecheck                   | 0 errors (32 pre-existing warnings, none in new files) |
| web unit                               | 1159 passed / 88 files                                 |
| web e2e (Playwright ×3 viewports)      | 535 passed                                             |
| **migration drift**                    | no difference detected                                 |
| **constraint-migration harness**       | ALL CHECKS PASSED                                      |
| **rollback proof**                     | display name intact after dropping the column          |
| `pnpm audit --prod --audit-level high` | no known vulnerabilities                               |
| isolated Compose smoke                 | 29/29                                                  |
| lockfile                               | unchanged (no new dependency)                          |

### Note for review

The API changes are **additive but unflagged**: the new settings, the column,
the read-model fields and the DTO field reach every client. The one behaviour
change on an existing endpoint is that `serviceAreaRadiusKm` is now bounded by
**policy** rather than only by the DTO's `1…500` — a radius above the
configured ceiling (default 100 km) is refused where it previously saved. That
is the point of the sprint, but it is a real change for any existing client
sending a larger value.

### Not in scope

A tile map. Leaflet is available and key-free, but a map centred on the
provider's base contradicts the privacy statement standing next to it, so the
preview is a described area instead.
