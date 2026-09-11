# Sprint 09B.29 Phase 5 — Verification

**Branch:** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Branched from:** `origin/develop` @ `e11499b9afc8753661887b356d5d7113838b3b85`

Baseline and entry audit: `PHASE5_BASELINE.md`.
Status: **PHASE 5 INCOMPLETE** — see §5.

---

## 1. Multi-country market resolution (C2/C3 prerequisite)

The product-owner decision replaced the single-market premise. This section
records what was built against it.

### 1.1 The registry

One `PlatformSetting` key, `platform_supported_markets`, holding a JSON array.
No migration: the existing settings model already stores JSON and already
carries an audit trail through `PlatformSettingHistory`, which is the mechanism
the other twenty operator settings use. A new table would have been a second
place for operator configuration to live.

```ts
type SupportedMarket = {
  countryCode: string; // ISO 3166-1 alpha-2, uppercase
  enabled: boolean;
  displayNameKey: string; // i18n key, never a human-readable name
  defaultTimezone?: string; // IANA; ABSENT for multi-zone countries
};
```

**Validation uses authorities already present — no dependency was added and no
list is hand-maintained.**

| Concern       | Authority                                        | Why not otherwise                                                                               |
| ------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| country codes | `class-validator@0.15.1` `isISO31661Alpha2`      | already a dependency; a hand-written array would be wrong within a year and nobody would notice |
| timezones     | `Intl.supportedValuesOf('timeZone')` (417 zones) | the runtime's own IANA data, already used to format times; a second copy could disagree         |

`Intl.supportedValuesOf` returns only canonical **geographic** zones — `UTC` and
the whole `Etc/*` family are absent. That is the behaviour we want and it is
asserted explicitly: a market's default timezone describes a place where
providers work, and a market configured as `UTC` would silently shift every
working-hours window entered in it.

**Two refusals that are safety properties, not validation niceties:**

- An **empty or all-disabled** registry is an _error_, not an empty list. The
  decision requires it to fail safely and never fall back to an invented
  country. There is no default market anywhere in the module, and a test asserts
  the module exports no `DEFAULT_MARKET` / `FALLBACK_MARKET` / `PRIMARY_MARKET`.
- **One bad row refuses the whole registry.** Dropping it would leave the
  operator believing a market is live when it is not, and nothing would say so.

### 1.2 The precedence policy

A pure function, because it is a decision with five branches and a
security-relevant ordering — exactly the thing that should be testable without a
database, a request or a clock.

| #   | Source                                            | Kind                |
| --- | ------------------------------------------------- | ------------------- |
| 1   | country already persisted on the profile/draft    | **authoritative**   |
| 2   | a market the user explicitly confirmed            | **authoritative**   |
| 3   | coordinates or place → resolved **and confirmed** | **authoritative**   |
| 4   | a verified first-party market cookie              | **authoritative**   |
| 5   | IP, locale, `Accept-Language`, browser timezone   | **suggestion only** |

The type makes the distinction unforgeable: authoritative sources yield
`RESOLVED`, hints yield `SUGGESTED`, and `persistableCountryCode()` is the single
place that says which may be written. A caller wanting to persist a hint would
have to reach past the type.

Asserted behaviours worth naming:

- the cookie **never** overrides authenticated database state;
- an **unconfirmed** geolocation fix is a suggestion, not an answer;
- four agreeing hints do **not** add up to an authoritative answer — there is no
  quorum rule;
- the enabled registry is checked at **every** level, so a persisted country for
  a market the operator has since disabled falls through and the provider is
  asked again;
- with a registry of exactly **one** enabled market, an unresolved provider
  still gets `NONE`. "There is only one market, so use it" is the single-country
  assumption this phase exists to remove.

### 1.3 Reverse geocoding

A port with one method. **No vendor is selected** — the decision requires a stop
before choosing one, so what ships is the port, the coordinate validation, an
honest production adapter, and a deterministic fake for tests.

**CORRECTION — this section previously claimed the fake was the "default
binding". It was not, and the claim was wrong in both directions.** An audit
found the fake bound _nowhere_: the token had no provider at all, so the claim
described neither the code as it was nor the code as it should be. The record is
corrected rather than quietly rewritten, because a reader who trusted it would
have believed a fake was reachable from a production module — the single thing
this design exists to prevent.

What is bound now:

| Binding                             | Where                       | `isAvailable` | `isRealResolver` |
| ----------------------------------- | --------------------------- | ------------- | ---------------- |
| `UnavailableMarketLocationResolver` | `MarketModule` (production) | `false`       | `true`           |
| `FakeMarketLocationResolver`        | `test/support/` only        | `true`        | `false`          |

The production adapter is honest rather than absent: it throws
`NOT_CONFIGURED`, and `GET /markets` reports
`locationSuggestionAvailable: false` so the client offers manual selection only.
A control that cannot work is worse than no control.

The fake now lives under `apps/api/test/`, outside `tsconfig.build.json`'s
`rootDir`, so a production import of it **fails to compile** — a stronger
guarantee than a naming convention. `market-module-safety.spec.ts` adds two
more: a metadata assertion on the module's binding, and an architectural scan
proving no `src/` file imports it.

The fake declares `isRealResolver = false`, the same guard `EvidenceScanService`
applies to a test scanner: an adapter that admits it is not real must not be
able to produce a persisted fact.

Coordinate validation uses `Number.isFinite` rather than a bare range pair,
because `NaN` and both infinities pass `>=`/`<=`; asserted directly. The fake
resolves `GB` deliberately — a real country the operator has not enabled is a
_different_ case from an unresolvable fix, and keeping them separate is what
lets the UI say "we do not operate there yet" instead of "we could not find you".

### 1.4 Timezone precedence (C3)

| #   | Source                                  | Result                     |
| --- | --------------------------------------- | -------------------------- |
| 1   | existing explicit provider timezone     | `KEEP` — never overwritten |
| 2   | resolved from the confirmed work origin | `RESOLVED (ORIGIN)`        |
| 3   | the market's declared default           | `RESOLVED (MARKET)`        |
| 4   | anything else                           | `ASK`                      |

Step 3 is conditional: a market spanning several zones declares **no** default,
because a default is indistinguishable from an answer, and the policy falls to
`ASK`.

The browser's timezone is not ranked last — it is **not an input at all**, and a
test asserts the absence.

Validity is re-checked at every level _including the stored value_: a profile
carrying a zone the runtime no longer recognises is not treated as explicit,
because storing hours against it produces times nobody can compute.

`persistableTimezone()` returns null for `KEEP`, so the never-overwrite rule
lives in one place rather than as a condition repeated at call sites.

**DST is exercised, not asserted in prose.** Sweden reads 13:00 in January
against 14:00 in July for the same instant; Syria (abolished DST in 2022) and
Saudi Arabia (never used it) are asserted not to shift.

### 1.5 Seeded markets

`SY`, `SE`, `SA` — the three the decision names, which are also the three this
repository's own demo providers already span, and three different DST
situations.

**Development only**, on the same reasoning as the development verification
policy beside it: which markets a platform serves is a commercial decision with
legal and tax consequences and belongs in the audited admin surface. Idempotent
and non-destructive — an existing setting is left exactly as it is.

**Operator action required for production** (outside repository authority):
write `platform_supported_markets` through the audited settings surface. Until
then production has **no** enabled market and onboarding will refuse the work
area with `MARKET_REGISTRY_MISSING` — which is the designed safe failure, not a
defect.

---

## 2. Evidence

### 2.1 Failing-before

`market-entry-gap.spec.ts` is retained rather than deleted. It records, as
passing assertions about the behaviour at entry, that the API accepted:

| Input     | Why it is a hole                                             |
| --------- | ------------------------------------------------------------ |
| `ZZ`      | not an assigned ISO code — the only check was `/^[A-Z]{2}$/` |
| `AQ`      | a real country the operator never enabled                    |
| any value | the client was the sole source of the country                |

### 2.2 Mutation sensitivity

Ten mutations applied, run and reverted against the market modules. **All ten
KILLED, zero residue** (every file byte-identical after restore; no Git command
used).

| Mutation                                      | Result |
| --------------------------------------------- | ------ |
| a hint becomes persistable                    | KILLED |
| cookie outranks persisted state               | KILLED |
| unconfirmed geolocation becomes authoritative | KILLED |
| a lone enabled market becomes the default     | KILLED |
| disabled markets become selectable            | KILLED |
| ISO check reverts to the old regex            | KILLED |
| empty registry accepted                       | KILLED |
| all-disabled registry accepted                | KILLED |
| timezone validation accepts anything          | KILLED |
| duplicate markets allowed                     | KILLED |

### 2.3 Gate results

Verified by capturing the command's own exit code — see §4.

| Gate                           | Result                               |
| ------------------------------ | ------------------------------------ |
| `api typecheck`                | rc=0                                 |
| `api lint`                     | rc=0                                 |
| `database typecheck` / `build` | rc=0                                 |
| market module suite            | **5 suites, 75 tests, 0 failed**     |
| `web typecheck`                | rc=0                                 |
| `web typecheck:e2e`            | rc=0                                 |
| `web lint`                     | 35 warnings, 0 errors (baseline)     |
| web unit                       | **113 files, 1592 tests, 0 failed**  |
| Playwright default matrix      | **636 passed, 96 skipped, 0 failed** |

---

## 2A. C1/C2/C3 at the production boundary

The mutation table in §2.2 covers the market **modules**. It says nothing about
whether the shipped request path calls them, and that gap turned out to hide
two defects. This section records the work that closed it.

### 2A.1 Two defects the module-level suites could not see

**D-1 — every server-owned provenance stamp was erased on commit.**
`ProviderOnboardingDraftRepository.advanceIfVersion` replaced `draft.data`
wholesale with the scratch bag the wizard had copied _before_ the request did
its work. The defaults service wrote the radius provenance into that same
column, in that same transaction, moments earlier — and the step write
overwrote it.

Consequences, both live:

- a DERIVED radius carried no provenance at all, so the server could never tell
  its own suggestion from a number the provider chose deliberately;
- the generated-headline stamp vanished too, so a headline the provider had
  CLEARED would be re-seeded on their next keystroke.

Fixed by merging rather than replacing — Postgres `||`, behind the existing
version CAS, so a concurrent PATCH still loses the way it always did.

**D-2 — the merge then resurrected stamps a request had just deleted.**
`ctx.scratch` _was_ the whole `draft.data`, server keys included. Once the write
merged instead of replacing, a stamp cleared by `recordExplicitRadius` came
straight back from the pre-request copy. Fixed by giving the column two owners:
`SERVER_OWNED_DRAFT_KEYS` is excluded when the wizard builds its scratch, so a
step handler cannot see a stamp, re-assert one, or branch on one.

Neither defect is reachable from `phase5-c1-onboarding-defaults.integration.spec.ts`,
which calls the defaults service directly. That is precisely why the C2 suite
exists.

### 2A.2 The production-path suite

`test/integration/phase5-c2-market-and-radius.integration.spec.ts` — supertest
→ real controller → real `ValidationPipe` → real DTO → real service → real
Postgres. Only the authentication guards are doubles.

| Group                   | What it pins                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| enabled-market boundary | enabled accepted; never-configured and switched-off both refused; lowercase normalised; ISO refusal distinguishable from market refusal; clearing allowed; **a partial edit carrying no country still refused once the stored market is disabled**; withdrawal effective immediately with no cached window; a refused payload writes nothing                                                                   |
| radius provenance       | derived and stamped with market + transport + policy fingerprint; **not** re-stamped when nothing changed; re-derived when the country moves; **cleared when the provider picks exactly the suggested number**; an explicit value never moved again; radius and provenance commit together or neither; other bookkeeping in `draft.data` survives a step write                                                 |
| C3 timezone             | the market's declared zone accepted; a valid IANA zone from another market refused with the allowed zones attached; UNKNOWN distinguished from INCOMPATIBLE; a multi-zone market may choose any zone it declares; ASK rather than guess when it declares several and none is supplied; **a stored zone the new market does not declare is invalidated on a country change**; the stored zone survives a reload |
| `GET /markets`          | enabled served, disabled absent, uppercase, i18n keys; response keys exactly `markets`/`selectedCountryCode`/`locationSuggestionAvailable`; registry field names absent from the body; a WITHDRAWN selection still reported; suggestion unavailable with no geocoder; static route not captured by the step parameter; refused without an authenticated user                                                   |

### 2A.3 Mutation sensitivity against the SHIPPED files

Six mutations, each editing the production file rather than a reconstruction of
it, run against both Phase 5 suites on a real database.

Round 1 found **two survivors**, and both were real holes in the tests:

- **M1** survived because the enabled-market check downstream refuses everything
  the DTO would, so a status-code assertion passed with the old
  `/^[A-Z]{2}$/` restored. WHICH layer refused is the observable difference, and
  nothing had asserted it.
- **M3** survived because recomputing provenance UNCONDITIONALLY also satisfies
  every "follows the market" assertion — the stamp is simply rewritten on every
  save. Nothing asserted it stays still when nothing changed.

Both gaps were closed with targeted tests. Round 2:

| Mutation                              | Guarantee removed                                         | Result              |
| ------------------------------------- | --------------------------------------------------------- | ------------------- |
| `M1-iso-to-shape-regex`               | a real ISO check in the DTO, not `/^[A-Z]{2}$/`           | KILLED by the suite |
| `M2-no-enabled-market-check`          | the wizard refuses a country the operator has not enabled | KILLED by the suite |
| `M3-provenance-update-unconditional`  | a derived radius recomputes only when its identity moved  | KILLED by the suite |
| `M4-no-explicit-radius-clearing`      | an explicit radius drops the server provenance stamp      | KILLED by the suite |
| `M5-no-market-in-provenance`          | provenance records the MARKET it was derived for          | KILLED by the suite |
| `M6-no-timezone-market-compatibility` | a chosen timezone must belong to the confirmed market     | KILLED by typecheck |

**SURVIVORS=0.** Every file restored from a byte copy; no Git command used at
any point. Residue verified absent by grep for the mutation markers, and the
backup directory removed.

### 2A.4 Contract changes made deliberately, not to obtain green

Three existing tests asserted behaviour this phase replaces. Each was rewritten
to assert the NEW contract with the reasoning inline; none was weakened, and
each still asserts at least as much as before.

| Test                                                         | Old assertion                                          | Why it changed                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| availability — "writes nothing when the timezone is missing" | any absent timezone refuses                            | C3 answers from the confirmed market; only a provider with NO market is asked. Now drives that state, and additionally asserts the reason code plus the new resolve-don't-refuse behaviour.                                              |
| availability — the two zone-change tests                     | change SY's zone to `Europe/Stockholm`                 | a zone change cannot exist in a single-zone market once compatibility is enforced. Moved to the seeded multi-zone `CA`.                                                                                                                  |
| `timezone-precedence.policy.spec` — "NEVER overwrites"       | a provider in Sweden may keep Damascus hours, for ever | directly contradicts the C3 criterion that a chosen zone be compatible with the confirmed market. Split into three: KEEP when permitted, KEEP when the market declares nothing to judge against, INVALIDATE when the market excludes it. |

### 2A.5 Gate results, this session

Every result captured by `scripts/ci/run-gate.sh`, which records the tested
command's own exit status. No pipeline whose final process could mask it.

| Gate                                         | Result                               |
| -------------------------------------------- | ------------------------------------ |
| `api typecheck`                              | rc=0                                 |
| `api lint`                                   | rc=0                                 |
| `migrate:deploy` / `database build` / `seed` | rc=0                                 |
| `verify:migrations`                          | rc=0                                 |
| Phase 5 C1 + C2 suites, `--runInBand`        | **2 suites, 58 tests, 0 failed**     |
| full API suite, DB + Redis armed             | **217 suites, 4132 tests, 0 failed** |
| mutation sensitivity, real production files  | **6 applied, 6 killed, 0 survivors** |

---

## 2B. Test isolation, and the two defects the stability series found

Two failures were found only by running the gates repeatedly under the parallel
configuration CI uses. Neither was reproducible in a single run, and both are
recorded with their first failing artifact rather than the green re-run.

### 2B.1 Writer starvation — a coarse lock on the wrong resource

**First failure:** 3 of 4 consecutive full parallel API runs, each ending
`Timed out after 120000ms taking the exclusive advisory lock on
"providerLifecycle"`. Nothing had leaked and every holder was behaving
correctly, so the message was true and useless.

**Diagnosis.** `pg_try_advisory_lock` does not queue: an EXCLUSIVE acquirer
succeeds only if it samples an instant with zero shared holders. ~20 suites hold
`providerLifecycle` SHARED for their whole runs. `provider-journey` held it
EXCLUSIVE for its whole ~100s run — blocking all of them, so they resumed as one
dense block and the next exclusive acquirer never found a gap. One run needed
102s of its 120s budget before a 20th shared holder was added; then it failed
outright.

**A rejected fix, recorded because it was worse.** Replacing the poll with
blocking `pg_advisory_lock` + `lock_timeout` made acquisition fair and
introduced a deadlock: a queued exclusive request on an EARLIER resource turns a
later shared acquisition into a blocking wait, closing a cycle the canonical
order was never designed to cover. **Measured: 32 suites and 851 tests failed**,
1368 of them on shared acquisitions that had never had to wait. Reverted
byte-for-byte; the reasoning now lives in `db-isolation.ts` so the "obvious"
fix is not attempted a third time.

**A second rejected fix, also measured, also reverted.** `provider-journey`'s
exclusivity protected two GLOBAL sweeps — `scanPending()` over `MediaAsset` and
`runOnce()` over grants. Neither is `ProviderProfile`, a table the suite only
ever touches through its own namespaced rows, so the lock genuinely named the
wrong resource. The attempted repair introduced a `mediaAssets` resource and
moved the exclusivity onto what is actually swept:

| Resource            | provider-journey  | Rationale                                  |
| ------------------- | ----------------- | ------------------------------------------ |
| `providerLifecycle` | SHARED (was X)    | it only writes its own namespaced profiles |
| `workAccessGrants`  | EXCLUSIVE (was S) | it RUNS the global grant expiry sweep      |
| `mediaAssets` (new) | EXCLUSIVE         | it RUNS the global `scanPending()` sweep   |

The diagnosis held; the remedy did not. **Measured: 0 of 3 full parallel runs
passed**, with 32 timeouts on `workAccessGrants` and 28 on `outbox`. Upgrading
the grants lock to EXCLUSIVE created a SECOND exclusive contender beside
`work-access-enforcement`, so the starvation did not disappear — it moved, and
the victim changed. Reverted in full; no `mediaAssets` residue remains.

**Why no third attempt was made.** The constraint is structural rather than a
matter of which resource is named. `pg_try_advisory_lock` does not queue, and
suites hold their locks for entire 30–150s runs, so on any resource with both
long shared holds and an exclusive contender someone can starve. Making
acquisition FAIR is what produced the deadlock in the first rejected fix,
because suites acquire resources in sequence and hold earlier ones while taking
later ones. A correct repair means acquiring each suite's whole lock set
atomically, or shortening the whole-run holds across ~20 suites — an isolation
redesign well outside a presentation-parity phase.

**Status: UNRESOLVED, and recorded as such.** Writer starvation is a
pre-existing, intermittent test-isolation defect. It was observed in 3 of 4
parallel runs during one reproduction session and did not recur in the three
consecutive canonical runs below. It is not closed, it is not hidden behind a
retry or a raised timeout, and both attempted fixes are documented above with
their measured blast radius so neither is tried a third time.

### 2B.2 A 500 on the LOCATION save, under load only

**First failure:** full parallel run 2 of 3, `phase5-c2 › re-derives after the
provider clears the radius entirely`, expected 200 received **500**:

```
Invalid `prisma.$executeRaw()` invocation:
Transaction API error: Transaction not found. Transaction ID is invalid,
refers to an old closed transaction …
```

**Diagnosis — this one was self-inflicted.** C1 added a second full
`buildContext()` inside the step-write transaction, immediately before the
pre-existing one. `buildContext` loads the profile with categories, the draft
relations, the user, operator settings and the expansion resolution, so every
step write paid for all of it **twice** inside one interactive transaction.
Prisma's interactive transactions default to a 5s timeout; under the parallel
suite that budget ran out mid-transaction and the raw JSONB merge that runs last
hit an already-closed transaction. An ordinary provider saving their work area
would have seen a 500.

**The fix is a reduction, not a longer timeout.** The defaults service now
returns exactly what it wrote (`AppliedDefaults`), so the post-defaults state is
the context already in hand plus that patch. One build instead of two; the
atomicity the mandate requires — radius and provenance committing together or
not at all — is untouched, because nothing moved out of the transaction.

### 2B.3 Stability series

Run on the restored (known-good) lock topology, with the §2B.2 transaction fix
in place.

| Phase                                             | Result                                |
| ------------------------------------------------- | ------------------------------------- |
| public-media concurrency barrier, x10 consecutive | **10/10 rc=0**                        |
| `provider-journey` + `phase5-c2` together, x3     | **3/3 rc=0**                          |
| full parallel API suite, x3 consecutive           | **3/3 rc=0**, 217 suites / 4136 tests |

Each full run took 77s. The same suite took 6,864s during a host memory
exhaustion episode, which is the difference between a starved process and a
product signal.

**Two runs were discarded rather than counted, with reasons:**

| Discarded run          | Why it is neither a pass nor a product failure                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `journey-and-c2` run 1 | 6,864s wall clock; 14 x `Exceeded timeout of 300000 ms`; **zero** advisory-lock timeouts, deadlocks or database errors. The host had ~232 MB of 16 GB free. |
| parallel series x3     | killed by the OS for low memory mid-run                                                                                                                     |

**Cause of the memory exhaustion, since it was self-inflicted and recurred three
times.** Each killed harness orphaned its jest worker pool: 11 `jest-worker`
processes plus 2 parents stayed resident holding ~3.4 GB, so every subsequent
run inherited an already-exhausted host and was killed in turn. Terminating only
those processes — matched by PID _and_ verified command line, never by name —
restored 232 MB to 3,760 MB. The developer's own five node processes (`web
dev`, Vite, three Prisma Studio) were verified alive before and after every
cleanup, and only project-scoped `docker compose -p ... down -v` was used for
containers.

Full gates are now run one at a time on this host, which is the documented
accommodation for local resource pressure — worker counts, assertions, retries
and timeouts are unchanged.

---

## 3. Foundation carried from the first Phase 5 session

| Deliverable                                                             | Evidence                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Typed 18-state registry with load-time exhaustiveness/uniqueness guards | `e2e/phase5-visual-states.ts`, 10 unit tests                                                   |
| Scoped test-typecheck gate                                              | `tsconfig.e2e.json` + `typecheck:e2e`; found **20 pre-existing errors in 5 files**, all fixed  |
| Reference hash lock                                                     | all four unchanged, re-verified after every commit                                             |
| Six-screen migration baseline                                           | 3,377 lines / 153 inline styles / 142 `fontSize` / 359 raw palette / **0 Provider UI imports** |

---

## 4. A process defect in this session, recorded

I verified a gate with `pnpm … typecheck 2>&1 | tail -1 && echo OK`. `tail`
succeeds whatever `tsc` did, so the `&&` fired on the pipe's status and I
reported a passing typecheck over two real compile errors (`PrismaTx` imported
from the wrong module, `INTERNAL` not being an `AppErrorCode`).

This is the **identical wrapper-exit-0 trap this sprint already hit in Phase 4
and wrote up**. Both errors were caught and fixed one commit later, and every
gate result in §2.3 is now taken from the command's own `$?`.

---

## 5. PHASE 5 INCOMPLETE — remaining blockers

Nothing about the redesign, rollout, privacy approval or production enablement
is complete. What is proven is exactly §2.3.

### Requires someone other than me

1. **Reverse-geocoding vendor.** The decision requires a stop before selecting
   one. The port, validation and deterministic fake exist; a production adapter
   needs a vendor choice with costs, privacy implications and operational
   trade-offs put to the product owner.
2. **Privacy-owner review** of the cookie's legal classification. The decision
   forbids classifying it "strictly necessary" without that determination.
3. **Production market enablement** — an operator action outside repository
   authority (§1.5).
4. **Manual NVDA / VoiceOver review.** Cannot be produced by an agent.
5. **Product-owner visual approval.**

### Implementable, not yet done

6. ~~**C1** — `providerType` default and `suggestedTitle → headline`.~~ **DONE.**
   `ProviderOnboardingDefaultsService`, applied on every draft read and step
   write; conditional writes with the predicate in the WHERE clause; provenance
   in the server-owned `draft.data`. See §2A.
7. ~~**Wiring** the market and timezone policies into
   `ProviderOnboardingWizardService`, and replacing the DTO's `/^[A-Z]{2}$/`
   with registry validation.~~ **DONE.** `@IsISO31661Alpha2` at the DTO,
   `MarketRegistryService.findEnabled` at the service, on the EFFECTIVE country
   so a partial edit cannot bypass it. `GET /markets` serves the sanitized
   projection. See §2A.2.
8. **The market cookie** — issuing, signing, verification, rejection handling.
   Not started. Must reuse the existing signed-cookie infrastructure rather than
   introduce an unsigned one.
9. **The location-suggestion endpoint** — auth, CSRF, rate limit, bounded
   timeout, deterministic error mapping. Blocked on blocker 1 (vendor choice);
   the port, the honest `NOT_CONFIGURED` production adapter and the
   `locationSuggestionAvailable` flag exist.
10. ~~**Radius derivation** from the canonical policy, plus the provenance
    mechanism C2 requires.~~ **DONE**, and the provenance carries enough
    identity to EXPLAIN the value — market, transport basis, policy fingerprint,
    value and timestamp — never a comparison against a moving suggestion. See
    §2A.1 for the two defects found while proving it.
    10a. **Manual market confirmation UI.** The server side is complete and the read
    model is served; the provider-facing confirmation flow is not built. Nothing
    persists a suggested or inferred country today, which is the invariant that
    matters, but the provider cannot yet confirm one from the UI.
    10b. **Enabled-market revalidation at SUBMISSION.** The write path refuses a
    withdrawn market on every step patch; the submit path has not been audited
    for the same check.
11. **Provider UI primitives** — market picker, location suggestion, focus-safe
    sheet, upload surface, crop/reorder, stepper, status-axis row, map/radius
    card, reward strip, schedule editor, customer preview, submission timeline.
12. **Migration of all six task screens** off inline styles and raw palette
    classes (0 of 6 done).
13. **The architecture/conformance test.**
14. **States 2–17** implemented to parity (0–1 already have evidence).
15. **The six state-6 market substates.**
16. **The 36-cell canonical parity suite** at 0.005, prototype-vs-application.
17. **The 216-record responsive matrix** and contact-sheet review.
18. **Axe / keyboard / focus / RTL / zoom / reduced-motion gates.**
19. **Required Linux-stable CI job.**
20. **Sensitivity proof of the visual gate.**
21. **Real-API EN/AR journeys** across two enabled countries.
22. **Controlled default-on rollout commit.**
