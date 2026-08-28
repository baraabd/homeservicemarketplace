# Sprint 9B.18 — Task 2: services, experience, equipment, transport, title

Behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off** on the web. The
API changes are additive and unflagged; see §6.

---

## 1. The defect this closes

The Sprint 8 screen rendered one flat cloud of toggle chips — every selectable
competency in the catalogue, at once, ungrouped, unsearchable — and put a
**"pending" badge inside each selected chip**. That collapsed three unrelated
facts into one visual:

| Question                        | Who answers it |
| ------------------------------- | -------------- |
| Have I chosen this?             | the provider   |
| Has an admin decided on it?     | an admin       |
| Is this category still offered? | the catalogue  |

A provider whose application was declined and one whose category was retired
last month saw the same greyed chip. Neither was told which had happened, and
**the second had done nothing wrong at all**.

---

## 2. Selection and review, kept apart

Two sections that cannot be confused:

- the **picker** answers _what have I chosen_ — searchable, grouped, collapsed
  by default, with the operator-configured limit shown as a count;
- the **state list** answers _what happened to each_ — four sections, each with
  its explanation stated **once on the group**, never as a badge per row.

`ProviderSpecialtyState` is `APPROVED | PENDING | REJECTED | INACTIVE`, derived
server-side from the existing tables. Precedence is INACTIVE first (a retired
category is retired regardless of what was approved), then APPROVED over
PENDING over REJECTED — so a category rejected and later approved reads as
approved, not as a refusal that has since been overturned.

INACTIVE is a **display** decision only. The grant row still exists and
submission still counts it: taking someone's approval away because an admin
tidied the catalogue would punish them for somebody else's housekeeping.

### The pending-is-not-a-failure fix

The completeness policy reported `specialties: REQUIRED` for a provider who had
applied and was waiting — telling someone who _did_ choose a specialty that
they had not. That is exactly the acceptance criterion about misrepresenting
pending admin state.

A new issue code, `AWAITING_REVIEW`, is emitted when nothing is approved **but
something is pending**. It **still blocks submission** — the canonical rule
that submission needs approved leaf specialties is untouched — and it says
something true. The existing test that asserted the refusal was updated to
assert the refusal _and_ the honest code.

---

## 3. Schema: two additive columns, and what happens if you roll back

`ProviderProfile` gains `transportModes ProviderTransportMode[]` and
`primaryServiceCategoryId`.

**`transportMode` is not replaced.** It is consumed today by matching, the
public profile and the policy; turning it into an array would have meant
rewriting all of them in the same change that introduced the concept, and any
one missed would read an empty value as "no transport". So it stays and is now
explicitly the **primary**, with the new column carrying the full set,
backfilled from it.

A scalar enum list rather than a join table: no per-mode data, nothing joins on
a single mode.

**Proven against a real Postgres before pushing:**

| Property                         | Result                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| applies to an empty database     | ✔ all migrations, no drift                                                                   |
| backfill on an upgraded database | `transportMode=VAN` → `transportModes={VAN}`                                                 |
| a null mode                      | stays `{}`, not `{NULL}`                                                                     |
| **replay does not clobber**      | a provider who since added MOTORCYCLE keeps `{VAN,MOTORCYCLE}` — the `cardinality = 0` guard |
| **rollback**                     | dropping both columns leaves `transportMode` intact and correct                              |
| old binary / new database        | ignores both columns; `transportMode` still answers                                          |

The set and the primary are kept consistent **server-side**: a set that no
longer contains the primary re-points it, clearing every mode clears it, and a
primary arriving alone (an older client) joins the set. Resolving that in each
client is how two clients resolve it differently.

---

## 4. Experience, equipment, transport

- **Experience** asks for the **year you started** and stores a date. The
  server derives the years, so the stored fact does not silently age — which is
  why the schema already carried `professionSince` beside the count. Bounded
  1950…this year, refused inline without a round trip.
- **Equipment** reuses `EquipmentCatalogItem` and saves by `code`. Real
  checkboxes, announced and keyboard-operable.
- **Transport** is multi-select with the primary marked. The client never sends
  the primary — see §3.

---

## 5. The title: suggested, never published

`suggestProfessionalTitle` is a deterministic mapping keyed by the catalogue
**slug**, returning the **trade name** ("Plumber", not "Plumbing") and falling
back to the catalogue label for a slug it has not met. Computed server-side and
returned in **both languages**, like the category catalogue, so switching
language needs no refetch.

**Nothing is published.** Reading the draft writes nothing; accepting the
suggestion only fills the box; the profile task is where a title is written.
The screen says so in as many words, and a test asserts the read performs no
write at all.

`validateProfessionalTitle` refuses URLs, emails, phone numbers (Latin and
Arabic-Indic digits), unsubstantiable superlatives, and **credential claims**
— "certified", "licensed", "insured". A customer reads those as facts the
marketplace checked; until verification can evidence them, typing one is a
claim made on our behalf that nobody verified. `Bestway Plumbing` is
deliberately fine: substring matching would refuse legitimate names.

A test asserts every suggestion the platform makes would itself pass
validation — a feature that suggests what it then refuses is worse than one
that suggests nothing.

### The mirror, again

The web cannot import runtime values from the CJS-emitting contracts package
(third time: `request-media/constants.ts`, `phone-format.ts`, now
`title-format.ts`). The **validation** is mirrored with a drift test importing
both; the **trade-name table is not** — the suggestion arrives from the server,
so the client never needs it.

---

## 6. Evidence

| Gate                                             | Result                                                 |
| ------------------------------------------------ | ------------------------------------------------------ |
| api lint / typecheck / build                     | pass                                                   |
| api test (unit)                                  | 2762 passed                                            |
| **api test with DB + Redis gates ENABLED**       | **3239 passed, 0 skipped**                             |
| web lint / typecheck                             | 0 errors (32 pre-existing warnings, none in new files) |
| web unit                                         | 1135 passed / 87 files                                 |
| web e2e (Playwright ×3 viewports)                | 535 passed                                             |
| **migration drift** (`migrate diff --exit-code`) | no difference detected                                 |
| **constraint-migration harness**                 | ALL CHECKS PASSED (A–D)                                |
| `pnpm audit --prod --audit-level high`           | no known vulnerabilities                               |
| isolated Compose smoke                           | 29/29                                                  |
| lockfile                                         | unchanged (no new dependency)                          |

The browser suite covers the picker at 320px and 430px with a nested
catalogue, the four review states, and Arabic RTL without overflow.

### Not in scope

The **title is not written anywhere** by this task — by design. The
public-profile task owns final editing and publication, which is what makes
"suggested, never published" true rather than aspirational.
