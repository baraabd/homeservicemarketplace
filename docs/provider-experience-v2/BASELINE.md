# Provider Experience V2 — Phase 1 baseline

What the two surfaces actually render today, captured against a real API, real
Postgres and a real half-finished application. Recorded before any redesign so
the design decisions that follow are answerable to evidence rather than memory.

**Captured at** `1fb080c` + the two documentation commits, 2026-08-31.
**Provider fixture:** registered through the real API, upgraded, with
`PROVIDER_TYPE`, `IDENTITY`, `LOCATION`, `SPECIALTIES` and `EXPERIENCE`
answered and `AVAILABILITY` + `PROFILE` deliberately left open — the state a
real provider is in mid-application.

---

## 1. Why a developer sees V1 while the V2 suites are green

This is the finding that matters most, and it is not a UI defect.

`VITE_PROVIDER_ONBOARDING_V2` was **set nowhere in the repository**: not in
`apps/web/.env`, not in `.env.example`, not in a compose file, not in the web
CI build. `feature-flags.ts` treats missing, empty and `"false"` alike as OFF —
correctly, because an unrecognised value is exactly when nobody chose. So
`pnpm --filter @homeservicemarketplace/web dev` has always served the Sprint 8
wizard.

**The V2 test suites could not have caught this, because none of them uses a
developer's environment:**

| Suite                                      | How it turns V2 on                                                    | What it proves                       |
| ------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------ |
| `provider-onboarding-v2*.spec.ts` (mocked) | seeds `localStorage` via `addInitScript`                              | the UI renders                       |
| `provider-onboarding-v2-real-api.spec.ts`  | **builds its own bundle** with the flag on, serves it on another port | the journey works against a real API |
| local `pnpm … web dev`                     | nothing sets it                                                       | **V1**                               |

Both suites are honest about what they test. Neither was ever evidence about
the dev server, and reporting them as "V2 is verified" without saying which
environment was verified is the reporting defect behind six sprints of
confusion.

**Fixed in this branch:** `apps/web/.env.example` now documents the flag, the
default, the precedence and the restart requirement. The local `apps/web/.env`
(gitignored) carries `VITE_PROVIDER_ONBOARDING_V2=true`, so the normal dev
command serves V2.

**Proven accidentally, which is the strongest kind.** The first attempt at this
baseline built the "flag off" bundle without setting the variable — and it
rendered the V2 hub, because Vite loads `apps/web/.env` at build time and had
picked up the line added minutes earlier. The flag-off capture had to force
`VITE_PROVIDER_ONBOARDING_V2=false` on the build command. A normal build in
this repository now produces V2.

---

## 2. Baseline matrix

Two bundles from identical source, differing only in the flag, both against API
`:4011`:

| Bundle    | Flag at build    | Served  | Renders         |
| --------- | ---------------- | ------- | --------------- |
| `dist-v1` | `false` (forced) | `:4175` | Sprint 8 wizard |
| `dist-v2` | `true`           | `:4174` | V2 six-task hub |

36 screenshots at 390 / 768 / 1440 in English and Arabic.

| Route                             | Component                  | Shell                    | Captured             |
| --------------------------------- | -------------------------- | ------------------------ | -------------------- |
| `/provider` → `/provider/status`  | `ProviderStatusState`      | phone frame              | en/ar × 390/768/1440 |
| `/provider/profile` (flag off)    | `ProviderOnboardingWizard` | phone frame + bottom nav | en/ar × 390/1440     |
| `/provider/onboarding`            | `OnboardingHubScreen`      | full-screen shell        | en/ar × 390/768/1440 |
| `/provider/onboarding/:taskId` ×6 | task screens               | full-screen shell        | en/ar × 390/1440     |

---

## 3. Defects the baseline shows

### 3.1 The phone frame — the largest single problem

`Root.tsx:153` wraps **every** non-`/select` route in
`maxWidth: '430px'`, on a dark slate/indigo gradient with an "FN" watermark.
Admin opts out by living outside that layout; Provider does not.

At 1440×900 the entire provider application — V1 and V2 alike — is a 430px
column adrift in dark background. Roughly **70% of the viewport is decoration.**
A provider comparing jobs, reading a bid, or reconciling earnings on a laptop
is doing it through a phone-shaped slot. This is not a styling nit: it is the
information architecture refusing to use the display.

### 3.2 What the legacy wizard shows (flag off)

Confirmed in `v1-wizard-en-1440.png`:

- a **nine-chip rail** — "Account type / About you / Where you work / What you
  do / Experience & tools / Your hours / Your profile / Terms / Review &
  submit" — wrapping onto three rows;
- a saturated purple-blue **gradient header**;
- **"44% complete"**, a client-side percentage;
- the **provider bottom navigation** (Live Jobs / My Bids / Chat / Wallet /
  Profile) present _during onboarding_, offering four destinations an applicant
  cannot use;
- red inline text ("This still needs completing") as the only error treatment.

### 3.3 What V2 shows today (flag on)

Confirmed in `v2-hub-en-1440.png`. The content model is right and the shell is
not:

- six tasks, grouped, server-decided status, one CTA, **no bottom nav** — all
  correct, and all a real improvement on the rail;
- but it is the same 430px column on desktop, so the grouping that reads well
  at 390 leaves a desktop user with one narrow strip;
- section labels (`BASICS`, `YOUR SERVICES`) are small all-caps grey on white —
  weak hierarchy at any width;
- status is carried by a small pill ("Done" / "To do" / "Locked") whose colour
  does most of the work;
- the `REVIEW_SUBMISSION` row reads "Locked / Finish the tasks above first"
  while showing "2 of 6 complete" — accurate, but the reason is generic rather
  than naming what is outstanding.

### 3.4 Carried over from the 9B.27 review

- the consent blocker still renders as **"Something here still needs
  attention"** — a real requirement with no copy of its own;
- `POST /me/provider/upgrade` grants the role without reissuing the access
  token, so a newly promoted provider gets **403 until the session refreshes**
  (ADR 0014 §consequences; Phase 8 of the redesign closes it).

---

## 4. What this baseline does not cover

Honest gaps, to be closed by the Phase 11 matrix rather than claimed here:

- no 320px, 430px, 1024px or 200%-zoom captures;
- no dark mode;
- no active-workspace screens (jobs, bids, messages, wallet) — slice 1 routed
  them but this capture is about onboarding;
- no submitted / action-required / verification / work-access states;
- no loading, empty or error states;
- no axe or contrast measurement.
