# Sprint 09B.29 Phase 5 — migration matrix

**Branch:** `feat/provider-onboarding-v2-phase5-exact-visual-parity`
**Merged prerequisite:** PR #75 (C1–C3 backend) → `develop` @ `ba8613b`
**Successor PR:** #76 — Phase 5A UI migration COMPLETE at `e2dfe18`

Counters are **computed** by `apps/web/e2e/phase5-evidence-ledger.ts` from
artifacts on disk. Nothing in this document grants credit; it records what the
ledger reports and what remains.

```
presentation migrated:       6/6
production-route integrated: 0/6
real-API persisted:          0/6
```

All six task controllers now hold presentation credit: source rules pass, the
canonical 390x844 comparison is inside 0.005 in both languages, and axe is clean
on both. Route and persistence credit belong to Phase 5B and cannot be earned by
a suite that stubs the API — see `PHASE5A_INTEGRATION_GAPS.md`.

---

## 1. The six task controllers

Baseline measured before editing, and re-measured after each slice. "Arbitrary"
counts Tailwind values such as `text-[13px]` that read like utilities and answer
to nothing.

| Screen                          | Lines   | `style={{` | `fontSize` | Palette | Arbitrary | Provider UI | State    |
| ------------------------------- | ------- | ---------- | ---------- | ------- | --------- | ----------- | -------- |
| **Basics** (was)                | 471     | 15         | 14         | 36      | —         | 0           | —        |
| **Basics** (now)                | **215** | **0**      | **0**      | **0**   | **0**     | yes         | CREDITED |
| **Services + Experience** (was) | 591     | 30         | 28         | 70      | —         | 0           | —        |
| **Services + Experience** (now) | **475** | **4**      | **0**      | **0**   | **0**     | yes         | CREDITED |
| **Work area** (was)             | 470     | 28         | 26         | 60      | 0         | 0           | —        |
| **Work area** (now)             | **208** | **0**      | **0**      | **0**   | **0**     | yes         | CREDITED |
| **Working hours** (was)         | 771     | 27         | 24         | 61      | 0         | 0           | —        |
| **Working hours** (now)         | **378** | **0**      | **0**      | **0**   | **0**     | yes         | CREDITED |
| **Profile + portfolio** (was)   | 542     | 31         | 30         | 66      | 0         | 0           | —        |
| **Profile + portfolio** (now)   | **373** | **3**      | **0**      | **0**   | **0**     | yes         | CREDITED |
| **Review + terms** (was)        | 526     | 22         | 20         | 69      | 0         | 0           | —        |
| **Review + terms** (now)        | **744** | **8**      | **0**      | **0**   | **0**     | yes         | CREDITED |

The remaining `style={{` blocks are geometry no token can express — a 72px icon
tile, a centring box whose padding is derived from the sticky bar's own height, a
data-driven progress width. Every one is a length the approved design fixes
rather than a colour, a size or a radius; the conformance gate refuses those
four categories and passes these.

Review grew rather than shrank, and deliberately: one screen became three, and
what replaced the nine repeated summary cards is four rows that read the
provider's own answers back plus a confirmation timeline that did not exist.

## 1A. The eighteen states, measured

Run `phase5-5f50446f`, one id across all 36 canonical cells, 36 responsive
cells and the reference spec. Budget is 0.005.

| #   | State          | EN      | AR      | #   | State           | EN      | AR      |
| --- | -------------- | ------- | ------- | --- | --------------- | ------- | ------- |
| 0   | activation     | 0.00009 | 0.00010 | 9   | portfolio       | 0.00124 | 0.00108 |
| 1   | sync           | 0.00002 | 0.00006 | 10  | hub-complete    | 0.00017 | 0.00069 |
| 2   | hub-partial    | 0.00017 | 0.00017 | 11  | review          | 0.00120 | 0.00104 |
| 3   | basics         | 0.00120 | 0.00104 | 12  | terms           | 0.00207 | 0.00190 |
| 4   | services       | 0.00196 | 0.00220 | 13  | submitted       | 0.00156 | 0.00155 |
| 5   | experience     | 0.00153 | 0.00120 | 14  | status-centre   | 0.00332 | 0.00207 |
| 6   | work-area      | 0.00202 | 0.00260 | 15  | returned        | 0.00222 | 0.00143 |
| 7   | working-hours  | 0.00203 | 0.00175 | 16  | session-expired | 0.00004 | 0.00004 |
| 8   | public-profile | 0.00117 | 0.00293 | 17  | active-handoff  | 0.00000 | 0.00001 |

Worst cell 0.00332, 66% of budget. Axe violations across all 36 cells: **0**.
Required-copy phrases missing: **0**. Responsive contract failures across 216
width checks: **0**.

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

Phase 5A is complete: all eighteen approved states render through the real V2
components, at or under budget in both languages, with zero axe violations and
zero responsive-contract failures.

Phase 5B has two jobs, in this order.

1. **Earn the other two counters.** A real-HTTP, flag-ON run that stamps its own
   `interceptionFree` marker, and a persistence marker recording hydration, hub
   navigation, hard reload, fresh sign-in and a database assertion. The ledger
   already refuses anything less; what is missing is the run, not the gate.

2. **Close the integration gaps**, all thirteen recorded in
   `PHASE5A_INTEGRATION_GAPS.md` — starting with the work-area country (G-01),
   which is the only one that can stop a provider submitting at all.
