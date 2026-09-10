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
before choosing one, so what ships is the port, the coordinate validation, and a
deterministic fake which is also the **default binding**. A test that forgot to
inject a double therefore gets determinism, not a network call.

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

6. **C1** — `providerType` default and `suggestedTitle → headline`. The seam is
   identified (`ProviderOnboardingDraftRepository.ensure`, whose `create` branch
   is the "new V2 draft" moment); `suggestedTitle` is currently computed in the
   read model and never persisted. Not started.
7. **Wiring** the market and timezone policies into
   `ProviderOnboardingWizardService`, and replacing the DTO's `/^[A-Z]{2}$/`
   with registry validation. The policies are complete and tested; nothing calls
   them yet.
8. **The market cookie** — issuing, signing, verification, rejection handling.
9. **The location-suggestion endpoint** — auth, CSRF, rate limit, bounded
   timeout, deterministic error mapping.
10. **Radius derivation** from the canonical policy, plus the provenance
    mechanism C2 requires to distinguish derived from legacy values.
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
