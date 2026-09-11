# Sprint 09B.29 Phase 5 — migration matrix

**Branch:** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Merged prerequisite:** PR #75 (C1–C3 backend) → `develop` @ `ba8613b`
**Successor PR:** #76 (draft, UI INCOMPLETE)

Counters are **computed** by `apps/web/e2e/phase5-evidence-ledger.ts` from
artifacts on disk. Nothing in this document grants credit; it records what the
ledger reports and what remains.

```
presentation migrated:       0/6
production-route integrated: 0/6
real-API persisted:          0/6
```

Two screens are **code-migrated candidates**: their source rules pass and no
other evidence exists yet.

---

## 1. The six task controllers

Baseline measured before editing, and re-measured after each slice. "Arbitrary"
counts Tailwind values such as `text-[13px]` that read like utilities and answer
to nothing.

| Screen                          | Lines   | `style={{` | `fontSize` | Palette | Arbitrary | Provider UI | State       |
| ------------------------------- | ------- | ---------- | ---------- | ------- | --------- | ----------- | ----------- |
| **Basics** (was)                | 471     | 15         | 14         | 36      | —         | 0           | —           |
| **Basics** (now)                | **220** | **0**      | **0**      | **0**   | **0**     | yes         | candidate   |
| **Services + Experience** (was) | 591     | 30         | 28         | 70      | —         | 0           | —           |
| **Services + Experience** (now) | **421** | **0**      | **0**      | **0**   | **0**     | yes         | candidate   |
| Work area                       | 470     | 28         | 26         | 60      | 0         | 0           | not started |
| Working hours                   | 771     | 27         | 24         | 61      | 0         | 0           | not started |
| Public profile + portfolio      | 542     | 31         | 30         | 66      | 0         | 0           | not started |
| Review + terms                  | 526     | 22         | 20         | 69      | 0         | 0           | not started |

Starting totals across the six: **3,371 lines, 153 inline style blocks, 142
`fontSize`, 366 raw palette utilities, 0 Provider UI imports** — which confirms
the figures the mandate quoted.

---

## 2. Which approved states each controller owns

One route can carry more than one approved screen. The prototype treats them
separately, and the gate compares against the prototype, so collapsing them
would silently drop a reference screen.

| Controller                | Owns states | Prototype screens              |
| ------------------------- | ----------- | ------------------------------ |
| `BasicsTaskScreen`        | 3           | `basics`                       |
| `ServicesTaskScreen`      | 4, 5        | `services`, `experience`       |
| `ServiceAreaTaskScreen`   | 6           | `area`                         |
| `AvailabilityTaskScreen`  | 7           | `hours`                        |
| `PublicProfileTaskScreen` | 8, 9        | `profile`, `portfolio`         |
| `ReviewTaskScreen`        | 11, 12, 13  | `review`, `terms`, `submitted` |

Non-task states — 0 activation, 1 synchronisation, 2 partial Hub, 10 complete
Hub, 14 status centre, 15 returned, 16 expired, 17 active handoff — are owned by
the shell and lifecycle surfaces and tracked in the 18-state registry.

The conformance gate asserts this mapping cannot drift: every id exists, no
state is claimed twice, and slugs are unique because they are artifact paths.

---

## 3. Evidence required before a counter moves

| Counter                     | Requires                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| presentation migrated       | source conformance **and** canonical 390×844 expected/actual/diff within 0.005 **and** axe clean in EN and AR                             |
| production-route integrated | all of the above **and** a real-HTTP flag-ON route marker the test itself stamps `interceptionFree`                                       |
| real-API persisted          | route evidence **and** a persistence marker recording hydration, Hub navigation, hard reload, fresh sign-in and a real database assertion |

The existing Playwright suites intercept the API. They are **PROVISIONAL_UI**
presentation tests and are not production-route credit.

---

## 4. Behaviour changes, and on whose authority

| Change                                                                         | Authority                                                   | What it does not do                                                                                                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-type chooser, its dialog, and legal-business-name removed from Basics | Ruling C1                                                   | Nothing is deleted server-side. A provider stored as BUSINESS keeps their type, legal name and documents.                                                        |
| Generated title is display-only on Services                                    | Ruling C1                                                   | The value is still server-owned and still shown; editing moves to the surface that owns it.                                                                      |
| Years of experience is a −/+ stepper                                           | Approved `experience` screen                                | `professionSince` is still stored as a DATE, so experience does not stop ageing.                                                                                 |
| Equipment section removed                                                      | Approved `experience` screen shows none                     | **OPEN — needs product-owner confirmation.** No ruling names equipment. It is optional data the completeness policy never asks for; stored values are untouched. |
| Transport keeps checkbox multi-select                                          | Approved screen shows Car **and** Public transport selected | `ProviderChoiceCard` is radio-based; using it would change the control's meaning to satisfy an import.                                                           |

---

## 5. Next

Workstreams 5.2 and 5.3 — the deterministic capture harness and the
activation/Hub surfaces — then the remaining four task screens. No counter can
move until the harness exists, because until then no screen can produce the
artifacts the ledger reads.
