# Sprint 09B.29 Phase 5 — Baseline and entry audit

_Exact UX/UI Visual Parity for the Six Provider Onboarding V2 Tasks and All 18
Approved Journey States._

**Branch:** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Branched from:** `origin/develop` @ `e11499b9afc8753661887b356d5d7113838b3b85`
**Mode:** B — UX/UI Redesign, scoped to the Provider Onboarding V2 surfaces.

---

## 1. Entry state, proved rather than assumed

| Check                                                | Result                                                    |
| ---------------------------------------------------- | --------------------------------------------------------- |
| Repository root                                      | `C:/Users/mohab/Documents/GitHub/Homeservicesmarketplace` |
| `origin/develop`                                     | `e11499b9afc8753661887b356d5d7113838b3b85`                |
| Contains the known Phase 4 merge SHA                 | **yes** — `git merge-base --is-ancestor` returns 0        |
| Commits ahead of the known SHA                       | **0** — develop has not advanced                          |
| Phase 4 tested head `b34b09a` reachable from develop | no, and correctly so: PR #74 was **squash**-merged        |
| Local `develop`                                      | fast-forwarded `0744e74 → e11499b`, no merge, no rebase   |
| Worktree at entry                                    | clean, 0 modified, 0 untracked                            |
| Stashes at entry                                     | **4**, all preserved                                      |
| Node / pnpm                                          | v20.18.1 / 10.32.1                                        |

No destructive Git command was used. The branch was created with
`git switch -c … origin/develop`.

## 2. Reference lock

Hashed from the canonical Git blob (`git show HEAD:<path> | sha256sum`), not the
working-tree copy, so `core.autocrlf` cannot change the answer between this host
and Linux CI.

| File                                     | SHA-256          | Matches mandate |
| ---------------------------------------- | ---------------- | --------------- |
| `provider-onboarding-prototype.html`     | `c5ceb93a…725b9` | ✅              |
| `provider-onboarding-user-flow.svg`      | `694af15d…7aa7`  | ✅              |
| `provider-onboarding-user-flow.png`      | `fbbcaabb…6663`  | ✅              |
| `provider-onboarding-delivery-readme.md` | `f765e326…4790`  | ✅              |

All four match exactly. **No reference file was modified by this phase.**

### How the prototype is actually structured

Worth recording because it is not obvious and it shapes the capture harness: the
approved file is an **outer shell** whose entire content is a sandboxed
`<iframe srcdoc="…">` carrying the real prototype as HTML-escaped text. The
product markup, the `hsmScreens` registry and the `#hsm-phone-content` surface
all live inside that frame. Playwright reaches it over the browser protocol, so
the missing `allow-same-origin` is not an obstacle.

The prototype's own screen registry (`hsmScreens`) is the authority for the 18
indices, and it reads, in order:

```
0 activate    1 sync       2 hub         3 basics     4 services   5 experience
6 area        7 hours      8 profile     9 portfolio 10 hubComplete 11 review
12 terms     13 submitted 14 waiting    15 returned  16 expired    17 active
```

## 3. The six task screens — measured migration baseline

Recalculated on the Phase 5 entry tree, as the mandate requires, rather than
carried over from the Phase 4 audit.

| File                          |    Lines | `style={{` | `fontSize` | Raw palette |   Hex | Provider UI imports |
| ----------------------------- | -------: | ---------: | ---------: | ----------: | ----: | ------------------: |
| `BasicsTaskScreen.tsx`        |      472 |         15 |         14 |          35 |     0 |                   0 |
| `ServicesTaskScreen.tsx`      |      592 |         30 |         28 |          68 |     0 |                   0 |
| `ServiceAreaTaskScreen.tsx`   |      471 |         28 |         26 |          60 |     0 |                   0 |
| `AvailabilityTaskScreen.tsx`  |      772 |         27 |         24 |          61 |     0 |                   0 |
| `PublicProfileTaskScreen.tsx` |      543 |         31 |         30 |          66 |     0 |                   0 |
| `ReviewTaskScreen.tsx`        |      527 |         22 |         20 |          69 |     0 |                   0 |
| **Total**                     | **3377** |    **153** |    **142** |     **359** | **0** |               **0** |

The mandate's entry audit quoted "at least 366" raw palette utilities; my regex
counts **359**. The difference is a matter of which utility prefixes are
counted, not of substance — the finding is identical: **zero Provider UI imports
across all six screens**, and every visual decision expressed as an inline style
or a raw Tailwind palette class.

`provider-ui` currently exports 24 symbols across `primitives`, `forms`,
`feedback` and `status`. None of them is used by the six screens.

## 4. Two gaps found in the test infrastructure itself

### F-1 — the `e2e` directory has never been typechecked

Neither `tsconfig.app.json` nor `tsconfig.node.json` includes `e2e/`, and
`tsconfig.app.json` explicitly **excludes** `src/**/*.test.ts(x)`. Vitest and
Playwright both transpile without type checking, so several thousand lines of
test code have never been shown to the type checker.

`tsconfig.e2e.json` was added, scoped as the mandate specifies, and wired as
`pnpm --filter web typecheck:e2e`. **Its first run reported 20 real errors in
5 files**, all pre-existing:

| File                                                                                                | Errors | Nature                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | -----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider-onboarding.spec.ts`                                                                       |     16 | `type Draft = ReturnType<typeof draft>` infers the _narrowest_ type from the default literals — `completedSteps: []` becomes `never[]`, every `null` field becomes the type `null`. So `completeDraft`, whose entire job is to override those fields, could not be typed. Fixed by declaring the fixture's shape. |
| `_diagnostic-visual.real-api.spec.ts`, `provider-activation-{a11y,session,visual}.real-api.spec.ts` |      4 | `seedLanguage(context, …)` passes a `BrowserContext` to a parameter typed `Page`.                                                                                                                                                                                                                                 |

**On the second of those — an honest note rather than a silent fix.**
`BrowserContext` also exposes `addInitScript`, so this runs. But
`context.addInitScript` applies to pages created _afterwards_, and in all four
specs the page already exists by that line — so the language seed is plausibly a
**no-op** in those suites today. They pass either way, which means either the
default already matches or the seed is redundant.

I widened the parameter type to `Page | BrowserContext`, which is
**behaviour-preserving**, and did **not** change the call sites. Changing them
would alter what four passing real-API specs actually do, inside a PR about
visual parity, on a suspicion. It is recorded here as a follow-up rather than
fixed blind.

### F-2 — the visual gate cannot currently be a Linux CI gate

The existing `prototype-reference.spec.ts` compares the prototype against
**committed Windows PNG baselines**, which is why Phase 3 recorded it as
opt-in (`E2E_VISUAL_REFERENCE=1`) with the honest note that Skia hints glyphs
differently on Linux.

The Phase 5 architecture removes that obstacle rather than working around it:
the 36 canonical cells compare **the live prototype capture against the live
application capture, taken in the same job on the same Chromium**. No committed
baseline participates, so the comparison is platform-independent by
construction. Committed PNGs remain only as a drift guard for the reference
itself.

## 5. C2's country source — SUPERSEDED by the multi-country decision

> **This section is kept as the entry record, not as a live blocker.**
>
> It reported a hard stop: C2 required the provider's country to come from a
> single canonical operator-market configuration, and the repository contained
> none. The product owner has since ruled that the marketplace is
> **multi-country from launch**, which replaces the premise rather than
> answering the question — there is no single platform country to find, and
> looking for one was the wrong search.
>
> The audit below stands because it is still an accurate account of what the
> repository held at entry, and because it is the evidence that a single-country
> assumption had to be abandoned rather than patched. What replaced it is in
> `PHASE5_VERIFICATION.md` §1.
>
> The one finding in it that survives unchanged: `serviceAreaCountryCode` was
> validated only by `/^[A-Z]{2}$/`, so `ZZ` and `AQ` were both countries as far
> as the API was concerned. That hole is now closed.

### The original finding

**This blocks state 6 (work area) and, transitively, C3's market-default
timezone.** Reported rather than worked around, exactly as C2 instructs.

### The clause

> **C2 — Country and radius.** Derive country only from the API's existing
> canonical server-side operator-market configuration. Never infer it from UI
> language, browser locale, IP geolocation, device settings, or client-supplied
> fallback values. **If the repository does not expose one unambiguous canonical
> operator-market source, stop and request the exact product/configuration
> decision; do not invent one.**

### What I searched, and what is actually there

| Candidate                                                | Result                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Environment schema (`apps/api/src/config/env.schema.ts`) | no country, market or timezone variable                                                                                                                                            |
| `.env.example`                                           | none                                                                                                                                                                               |
| `PlatformSetting` keys referenced anywhere in the API    | 20 keys exist; **none names a country, market or timezone**. They are fee, portfolio, specialty, consent and radius keys.                                                          |
| `ServiceAreaExpansionPolicy.country`                     | a **consumer**, not a source. It selects a ladder _given_ a provider's country, and its "global default" row is `country: null` — it deliberately does not name one.               |
| `timezone-resolution.ts`                                 | a **consumer**: it maps a country code to an IANA zone, and returns `AMBIGUOUS` rather than guessing. It cannot produce a country.                                                 |
| `City` / `District` catalogue                            | exists in the schema and is **never seeded** (recorded in earlier sprints).                                                                                                        |
| Demo seed                                                | seeds providers across **three different countries** — Saudi Arabia, Syria and Sweden — so there is not even an implicit single market to read.                                    |
| Current behaviour                                        | `serviceAreaCountry` and `serviceAreaCountryCode` arrive **entirely from the client request body** (`patch-onboarding-step.request.ts`), which is precisely the source C2 forbids. |

### Why it blocks

The approved work-area screen (reference index 6) has **no country control**.
Removing the existing selector before the server can supply a country would
produce a visually correct screen whose draft can never satisfy the location
step — the failure mode the mandate's own "critical entry finding" warns about.

C3 inherits the block for its _market-default_ half only: timezone resolution
**from a known country** already works and is untouched.

### What is NOT blocked

- **C1** — `providerType` default and `suggestedTitle → headline`: fully
  implementable, no missing source.
- **C2's radius half** — the canonical policy `resolveRadiusPolicy()` exists in
  `service-area/radius-policy.ts` and reads operator settings. The multi-transport
  question C2 flags as a possible second hard stop **is already resolved by the
  data model**: `transportMode` is documented as the PRIMARY in the contract, the
  Prisma schema and the policy itself, with `transportModes[]` carrying the full
  set. So the policy _is_ defined for a multi-selection and no product decision
  is needed here.
- **C3's country-derived timezone** — already implemented.

### The decision required

One of:

1. **A market platform setting** — e.g. `platform_market_country_code` (ISO
   3166-1 alpha-2) plus `platform_market_timezone`, seeded and admin-editable,
   consistent with the other 20 operator settings. _Recommended_: it matches the
   established pattern, is audited, and needs no deploy to change.
2. **An environment variable**, validated at boot and required in production.
3. **A per-market ladder promotion** — make `ServiceAreaExpansionPolicy` (or a
   new market table) the authority and define what a _new_ provider's country is
   when several ladders are live.

Option 1 also answers C3's market-default timezone in the same row.

**I have not implemented any of them, and have not touched the country selector.**

---

## 6. What this phase has completed so far

| Deliverable                                                             | State | Evidence                                                                            |
| ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| Recovery audit, branch, stash preservation                              | done  | §1                                                                                  |
| Reference hash lock                                                     | done  | §2, all four match                                                                  |
| Six-screen migration baseline                                           | done  | §3                                                                                  |
| Typed 18-state registry with load-time exhaustiveness/uniqueness guards | done  | `apps/web/e2e/phase5-visual-states.ts`                                              |
| Registry content guard in the unit suite                                | done  | 10 tests, all passing                                                               |
| Scoped test-typecheck gate                                              | done  | `tsconfig.e2e.json`, `typecheck:e2e`, 20 pre-existing errors found and fixed, now 0 |

## 7. What remains — every item is a blocker for PHASE 5 COMPLETE

1. **C2 country source** — hard stop above; product decision required.
2. C1 implementation with test-first failing-before evidence.
3. C2 radius derivation, server-side.
4. Provider UI primitives the reference needs (upload surface, crop/reorder,
   stepper, status-axis row, map/radius card, reward strip, schedule editor,
   customer preview, submission timeline, retry placeholder).
5. Migration of all six task screens off inline styles and raw palette classes.
6. The architecture/conformance test.
7. States 2–17 implemented to parity (0–1 already have parity evidence).
8. The 36-cell canonical parity suite at 0.005, prototype-vs-application.
9. The 216-record responsive matrix and contact-sheet review.
10. Axe / keyboard / focus / RTL / zoom / reduced-motion gates.
11. Manual NVDA or VoiceOver review — cannot be produced by an agent.
12. Required Linux-stable CI job.
13. Sensitivity proof of the visual gate.
14. Real-API EN/AR journeys extended to the redesigned surfaces.
15. Controlled default-on rollout commit.
16. Explicit product-owner visual approval.
