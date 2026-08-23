# ADR 0008 — Category hierarchy, and where a half-finished application lives

- **Status:** Accepted
- **Date:** 2026-08-24
- **Sprint:** 08
- **Related:** [0005](0005-provider-lifecycle-axes.md) (lifecycle axes), [0003](0003-service-area-geo-strategy.md) (why no PostGIS)

## Context

Sprint 8 builds the provider onboarding wizard. Two structural decisions have to be made before any of it can be written, and both are easy to get wrong in ways that are expensive to reverse.

**1. `ServiceCategory` is flat.** Every row is selectable, and a provider's granted categories are the competencies matching uses. The wizard needs _primary groups_ ("Plumbing") and _leaf specialties_ ("Boiler repair"), which the model cannot express.

**2. There is nowhere to put a half-finished application.** Nothing records which step a provider reached. Close the tab on step 6 of 9 and the server cannot say where you were, because nothing ever wrote it down. "Resume from the last saved step" is unimplementable against the current schema.

## Decision 1 — hierarchy by self-reference, with explicit leaf marking

`ServiceCategory` gains `parentId` (self-relation) and `isLeaf`.

**Backward compatible by construction.** Existing rows keep `parentId = NULL` and `isLeaf = true`, so every one stays exactly what it is today: a selectable competency at the root. Nothing that reads `ServiceCategory` — matching, the seeker catalogue, the admin queue — changes at all, and the flat-to-hierarchy migration is a data exercise the catalogue team can do gradually rather than a breaking schema change.

### `isLeaf` is stored, not derived

The tempting definition is "a leaf is a category with no children". It is wrong twice:

- **Selectability would become a client inference.** If the client decides what is selectable, "only leaves are selectable" is a suggestion, and a crafted request selects a parent.
- **It flips silently.** Deactivate a parent's last child and the parent becomes a leaf — turning an organisational heading into a selectable competency with no admin action and no audit entry.

So selectability is a property of the catalogue, set deliberately, server-side.

### Selecting a parent grants nothing

This is the decision that matters most, because the obvious UI convenience is an authorization bypass wearing a UI hat. Ticking "Plumbing" must not grant the twelve plumbing leaves beneath it: that would hand a provider a dozen competencies no admin reviewed, defeating `ProviderCategoryApplication` — the approval boundary Sprint 2 built — through a checkbox.

`expandParentSelection()` is therefore shaped so the bypass is _not expressible_. It has no way to return a granted competency: the `autoApproved` field exists, is always empty, and is pinned empty by a test. Everything a parent expands to comes back as `requiresApplication`. A future change that genuinely needs auto-approval must add a new field and justify it — it cannot quietly start populating this one.

The existing guard stays too: `ProviderService.authorizeCategoryDiff` already throws `FORBIDDEN` on any category the profile does not hold, and a test pins that so introducing the hierarchy cannot erode it.

_(For the record: the brief asked about "any confirmed category-selection bypass". There was none. The current PATCH path is correctly guarded. The bypass risk is one this sprint could have created.)_

## Decision 2 — a draft table, with a JSON bag and a version

`ProviderOnboardingDraft`, one row per provider: `currentStep`, `completedSteps[]`, `data` (JSON), `version`, `policyVersion`.

### Why JSON rather than typed columns

A half-filled wizard is genuinely unstructured. Modelling every intermediate state as nullable columns would mean a migration every time a step is reordered or split, and would litter `ProviderProfile` with fields that are meaningless once the application is submitted.

The trade is real and bounded: **committed values live in typed columns** on `ProviderProfile` and its relations (`ProviderAvailabilityInterval`, `ProviderEquipment`, `ProviderServiceArea`). The JSON bag is scratch space with a lifetime of one application, and nothing queries across it.

### `completedSteps` is server-computed

Never client-asserted. A client that can mark its own steps complete can mark itself finished, and submission validity would rest on the honesty of the caller.

### `version` is an optimistic-concurrency token

Every PATCH presents the version it read; a mismatch is a **409**, not a silent overwrite. Two tabs open on one wizard is the ordinary case, not the exotic one — and the failure mode without it is a provider watching half their answers disappear with no error.

### `policyVersion` is pinned per draft

A draft judged under one version of the completeness policy must not be silently re-judged under a newer one mid-flight, or a provider is failed on a rule that did not exist when they started.

## Decision 3 — the shape of the collected facts

| Domain       | Modelled as                                               | Rejected alternative                                                                                                                                                                                                            |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability | `(dayOfWeek, startMinute, endMinute, timezone)` intervals | One broad enum. The marketplace must answer "free at 14:30 Tuesday"; a bucket cannot.                                                                                                                                           |
| Experience   | `yearsOfExperience` **or** `professionSince`              | A display bucket. Buckets cannot be compared, filtered, or aged; the UI renders whatever band it likes from a number.                                                                                                           |
| Equipment    | Catalogue codes, category-linked                          | Free text. "van", "Van", "small van" are one capability, and matching fails if providers type it.                                                                                                                               |
| Transport    | Stable enum codes                                         | Localised strings. The label belongs in the i18n bundle, keyed by code.                                                                                                                                                         |
| Places       | `City → District → Neighborhood`                          | Only free text. The existing `serviceAreaCity` + `cityKey` + bounded-Haversine strategy from ADR 0003 is **untouched and still authoritative for matching**; this is a canonical spine so districts have something to hang off. |

Minutes-from-midnight rather than a time type: integer-comparable, trivially indexable, and carrying no zone of its own — the zone is stored once per interval, so a provider who moves cities does not silently shift every window.

**No PostGIS and no CQRS.** ADR 0003 declined PostGIS without measured evidence, and nothing in this sprint produced any. The same reasoning rules out adding `btree_gist` for a database-level overlap `EXCLUDE` constraint: overlap is validated in the service and tested there, with a unique index closing the exact-duplicate case for free.

## Consequences

**Good** — the catalogue can grow a hierarchy without a breaking change; selecting a parent cannot grant anything; a provider can resume where they left off; concurrent edits fail loudly instead of silently; every collected fact is queryable rather than decorative.

**Costs / risks**

- **Two representations of an in-flight application** (draft JSON + committed columns) until submission. Bounded by the draft's one-application lifetime, and nothing queries across the JSON.
- **`isLeaf` can be set wrong by an admin**, making a parent selectable or a leaf invisible. It is admin-controlled data, so it needs the same audit and validation as any other catalogue change.
- **Overlap validation lives in application code.** A direct database write bypasses it. Accepted rather than adding an extension; the unique index catches exact duplicates regardless of writer.
- **`DOCUMENTS_REQUIRED` is a new terminal-looking state that grants nothing.** It sits between `SUBMITTED` and `ACCEPTED` precisely so "application complete" and "approved to work" can never be read as the same fact — but it _will_ be read that way by someone, so every surface that renders it must say what is still outstanding.

## Revisit

- `btree_gist` + an `EXCLUDE` constraint, if overlapping intervals are ever observed reaching the database despite service-level validation.
- Promoting hot draft fields out of JSON into columns, if anything ever needs to query across in-flight applications.
