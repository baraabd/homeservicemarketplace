# Sprint 9B.25 — autosave consolidation, honest save states, and copy parity

Behind `VITE_PROVIDER_ONBOARDING_V2`, still **default off**. No schema change,
no migration, no API change.

This sprint is an audit plus the repairs the audit made urgent. It is
**partial** against the brief: §6 records exactly what shipped and what did
not, and why.

---

## 1. The audit

| Area                     | Finding                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Autosave coordinator     | **Already one shared hook** — `useOnboardingStepAutosave`, versioned, debounced, with `saveNow` for blur/navigation. Not duplicated. |
| Save-state **rendering** | **Duplicated three times and missing twice.** See §2.                                                                                |
| Offline promise          | The copy said _"we will save this when you are back"_; the pending edit lives in a React ref. See §3.                                |
| Copy-key parity          | **2 of 9 modules had a test.** See §4.                                                                                               |
| Automated a11y           | **None exists.** No axe, no equivalent.                                                                                              |
| Provider analytics       | **None exists.** `useAdminAnalytics` is admin dashboard _data_, not event tracking.                                                  |
| Bundle                   | **One 1842 KB chunk. No code splitting anywhere.** See §5.                                                                           |

---

## 2. The defect the audit was for

Five V2 task screens autosave. Three rendered status through their own private
near-identical `SaveStatus` component. **Two — ServiceArea and Services —
rendered nothing at all.**

On those two screens a conflict or a failed write produced **no visible change
whatsoever**. A provider edited their service area, the write 409'd against
another tab, and the screen looked exactly as it had a moment earlier. They
went on believing their work was saved. That is the "false saved state" the
brief names as a release blocker, in its worst form: not a wrong word, but
silence.

`ServicesTaskScreen` was the more exposed of the two — it drives **two**
autosaves (SPECIALTIES and EXPERIENCE) and had no way to report either.

Now: one `AutosaveStatus` component, one `AUTOSAVE_COPY` module, one
`mergeAutosaveStatus`, and all five screens wired to them. The merge helper was
lifted out of `BasicsTaskScreen`, which held the only copy — which is precisely
why the other two-autosave screen had none.

**Status is the hook's.** The component renders `status.kind` and derives
nothing, so it cannot show "Saved" optimistically: the hook sets `saved` only
after the server acknowledges the write and returns a new draft version.
Asserted directly — `saved` may appear for exactly one state, and a conflict on
either side of a two-autosave screen outranks a save on the other.

---

## 3. The offline sentence was a promise the client cannot keep

Old copy: _"You are offline. We will save this when you are back."_

The pending edit lives in a `useRef`. It survives a lost connection — the
`online` listener re-fires the flush — but **not a reload and not a crashed
tab**. Nothing is persisted to storage.

The brief is explicit: _only promise offline retry if changes are durably and
safely retained_. They are not, so the copy no longer says they are:

> Offline — this will save when you are back online. **Keep this page open.**

Choosing honesty over durability here is deliberate. Adding local persistence
would mean answering the conflict, identity and privacy questions the brief
lists — whose draft is in this browser, what happens when a different provider
signs in, how a stale local copy loses to a server version — and inventing that
under a hardening sprint would be worse than a truthful sentence.

Status is also no longer carried by colour alone: every state has an icon and a
`data-status`, so a colour-blind reader and a monochrome screenshot both still
distinguish "saved" from "could not save".

---

## 4. Copy parity, all nine modules

Two of nine had a parity test. Seven did not, and a key present in English and
absent in Arabic renders `undefined` — silently, because nothing stops a
`Record<Lang, T>` literal from being lopsided once the halves are written out.

`copy-parity.test.ts` walks **all nine** modules and asserts three things:

1. identical key **paths**, recursively — several modules nest per-state and
   per-code maps, and a top-level check passes while a nested Arabic branch is
   missing half its sentences;
2. the same keys are **functions** — a key that interpolates a count in one
   language and not the other is how a number disappears from Arabic;
3. Arabic is **not pasted English** — parity alone passes when someone copies
   the English branch to make the keys line up.

27 assertions, all nine modules green.

---

## 5. Performance baseline (measured, not fixed)

```
dist/assets: 1 file, 1842 KB total
  index-*.js  1842 KB
```

**There is no code splitting in this application.** No `React.lazy`, no dynamic
`import()`, no `manualChunks`. `leaflet`, `react-leaflet` and `recharts` are all
eagerly bundled into the single chunk every route downloads — including a
provider opening an onboarding task who will never see a map or a chart.

This is recorded rather than repaired. Route-level splitting plus lazy map and
chart boundaries is a real improvement and a real risk: it touches every route,
needs Suspense boundaries and fallbacks, and would want its own verification
pass. Doing it at the end of a hardening sprint and testing it shallowly is how
a performance change becomes a white screen.

**Recommended next:** lazy-load `react-leaflet` behind the provider map and
`recharts` behind the admin dashboards, then re-measure against the 1842 KB
baseline above.

---

## 6. What did NOT ship

Stated plainly, because the brief asks for far more than this sprint delivered:

- **Automated accessibility checks.** No axe integration exists; adding one and
  remediating what it finds across five screens is its own sprint. Manual
  keyboard and focus coverage in the existing Playwright specs is unchanged and
  still passing.
- **Analytics events.** No provider-side event tracking exists at all. Building
  it _and_ the payload allowlist _and_ the proof that no free text, contact
  data, coordinates, media keys or evidence metadata is emitted is a whole
  sprint, and a half-built version that emits anything is worse than none.
- **Code splitting / lazy crop and map.** §5.
- **Error boundaries and recovery states.** Not audited.
- **Usability-style Playwright journeys with touch emulation and flake
  detection.** The existing V2 specs were run and are green; no new journeys
  were added.

---

## 7. Evidence

| Gate                                                 | Result                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| web lint                                             | 0 errors, **32 warnings — unchanged**, no regression |
| web typecheck                                        | pass                                                 |
| web unit                                             | **1372 passed / 96 files** (+46, +2 files)           |
| new `AutosaveStatus` suite                           | 19 passed                                            |
| new `copy-parity` suite                              | 27 passed                                            |
| web production build                                 | pass                                                 |
| V2 Playwright (hub, basics, services)                | 159 passed, 0 failed                                 |
| V2 Playwright (availability, public-profile, review) | 92 passed, 52 declared-gate skips, 0 failed          |

No API, schema, migration or contract change, so the backend gates are
unaffected.
