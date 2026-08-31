# Provider Experience V2 — UX/UI design system

The design contract for the Provider redesign (Mode B). Every later phase is
answerable to this document; where implementation departs from it, this
document is wrong and gets corrected, rather than the departure going
unrecorded.

Grounded in `BASELINE.md`, which is evidence rather than recollection.

---

## 1. Principles

1. **The server owns meaning; the UI owns clarity.** Task readiness, progress,
   next action, verification, standing and work access are server facts. The
   client renders them and never re-derives them. No client-side lifecycle
   table, ever.
2. **One primary action per view.** A screen that offers three equally-weighted
   buttons has not decided what it is for.
3. **Say the specific thing.** "Something here still needs attention" is the
   failure mode to design out. Every blocker names what is missing and links to
   where it is fixed.
4. **Separate facts stay separate.** Onboarding completion, account standing,
   identity verification and work access are four answers, not one badge.
5. **Restraint is the house style.** Colour carries status, not decoration. A
   gradient is not a hierarchy.
6. **Width is information.** A desktop provider gets a desktop layout.

---

## 2. Information architecture

### 2.1 Two modes, one shell

A provider is either **applying** or **working**. The shell reflects which.

| Mode                                       | Chrome               | Navigation                                          |
| ------------------------------------------ | -------------------- | --------------------------------------------------- |
| Applying (`DRAFT`/`RETURNED`)              | full-screen, focused | no workspace nav — the application is the only task |
| Waiting (`SUBMITTED`/`DOCUMENTS_REQUIRED`) | status centre        | no workspace nav                                    |
| Working (`ACTIVE`)                         | workspace shell      | full navigation                                     |

The rule that stops the two leaking into each other already exists and stays:
marketplace screens never mount for a non-ACTIVE provider (ADR 0014).

### 2.2 Onboarding — six tasks, never nine chips

`BASICS_IDENTITY · SERVICES_EXPERIENCE · WORK_AREA · WORKING_HOURS ·
PORTFOLIO · REVIEW_SUBMISSION`, grouped `BASICS · SERVICES · COVERAGE ·
PROFILE · REVIEW`. Ids, order, grouping, status and progress come from
`GET /me/provider/onboarding/hub`. The client supplies copy, keyed by id, and
nothing else.

The nine-step vocabulary is a wizard implementation detail and must not surface.

### 2.3 Workspace — five primary destinations

`Home · Opportunities · Jobs · Messages · More`.

Secondary destinations (earnings, profile, portfolio, availability, service
area, verification, notifications, settings, support) live under Home or More.
Five is the ceiling because a sixth turns a nav bar into a menu.

Routes are already real (ADR 0014) and stay real; this is a regrouping of
destinations, not a re-introduction of tab state.

---

## 3. Responsive contract

**The 430px phone frame is removed for Provider routes.** `Root.tsx` keeps it
for Seeker; Provider opts out the way Admin already does. This is the single
highest-impact change in the redesign.

| Width     | Layout                                                               |
| --------- | -------------------------------------------------------------------- |
| 320–767   | single column, edge-to-edge, safe-area insets, sticky action bar     |
| 768–1023  | wider single column, max ~640px measure, contextual progress visible |
| 1024–1279 | two-column: content + persistent rail (task list / summary)          |
| ≥1280     | workspace sidebar + content, max content measure ~1120px             |

Rules that hold at every width:

- no horizontal overflow at 320px;
- text inputs ≥16px on touch (iOS zoom);
- interactive targets ≥44×44px;
- sticky actions never cover the field being edited — content gets bottom
  padding equal to the bar's height;
- a desktop layout is a _different arrangement_, never a stretched phone column.

---

## 4. Tokens

Defined once as CSS custom properties on `:root`, consumed through Tailwind
theme extensions. No component hard-codes a hex, radius, or font size.

### 4.1 Colour

Neutrals carry the interface; one accent carries action; status colours carry
meaning and are always paired with an icon and a word.

| Token                 | Light     | Role                                                   |
| --------------------- | --------- | ------------------------------------------------------ |
| `--pv-bg`             | `#F8FAFC` | app background                                         |
| `--pv-surface`        | `#FFFFFF` | cards, sheets                                          |
| `--pv-surface-sunken` | `#F1F5F9` | inset areas, disabled                                  |
| `--pv-border`         | `#E2E8F0` | hairlines                                              |
| `--pv-border-strong`  | `#CBD5E1` | inputs, dividers that must read                        |
| `--pv-text`           | `#0F172A` | primary                                                |
| `--pv-text-muted`     | `#475569` | secondary — **not** `#94A3B8`, which fails AA on white |
| `--pv-accent`         | `#2563EB` | primary action                                         |
| `--pv-accent-hover`   | `#1D4ED8` |                                                        |
| `--pv-accent-subtle`  | `#EFF6FF` | selected rows, active nav                              |

Status — each has a text/border/background triple:

| Token            | Meaning                      | Hue              |
| ---------------- | ---------------------------- | ---------------- |
| `--pv-done`      | complete                     | green `#15803D`  |
| `--pv-todo`      | outstanding, provider's move | slate `#475569`  |
| `--pv-blocked`   | cannot start yet             | amber `#B45309`  |
| `--pv-waiting`   | with us                      | indigo `#4338CA` |
| `--pv-attention` | action required              | amber `#B45309`  |
| `--pv-danger`    | rejected, revoked, error     | red `#B91C1C`    |

`--pv-text-muted` is `#475569` deliberately: the baseline's `#94A3B8` on white
is ~2.8:1 and fails WCAG AA for body text.

Dark mode maps the same token names; components never branch on theme.

### 4.2 Typography

Inter (Latin) / Cairo (Arabic), already loaded. One scale:

| Token          | Size / weight | Use                    |
| -------------- | ------------- | ---------------------- |
| `--pv-display` | 28 / 700      | status centre headline |
| `--pv-h1`      | 22 / 700      | screen title           |
| `--pv-h2`      | 18 / 650      | section                |
| `--pv-h3`      | 15 / 650      | card title             |
| `--pv-body`    | 15 / 400      | prose, inputs          |
| `--pv-sm`      | 13 / 400      | help text              |
| `--pv-label`   | 13 / 600      | field labels           |
| `--pv-micro`   | 11 / 600      | badges only            |

Group headings (`BASICS`) become `--pv-h2` sentence case, not 11px all-caps
grey. Arabic runs ~1.15× longer: buttons size to content, never fixed width.

### 4.3 Spacing, radius, elevation

4px base: `4 8 12 16 20 24 32 40 56`. Section rhythm 24 (mobile) / 32 (desktop).

Radius: `--pv-r-sm 8` (inputs, chips), `--pv-r-md 12` (cards),
`--pv-r-lg 16` (sheets), `--pv-r-full` (avatars only). The baseline's 2xl
everywhere reads as toy-like at desktop width.

Elevation: flat by default; `--pv-shadow-1` for raised cards,
`--pv-shadow-2` for sticky bars and sheets. Borders separate; shadows lift.
Not both.

---

## 5. Components

Provider-scoped primitives. Existing shared primitives are reused where they
fit; these exist because the same semantics recur across ≥3 screens.

`ProviderShell` · `ProviderMobileNav` · `ProviderSidebar` · `ProviderPageHeader`
· `ProviderSection` · `ProviderCard` · `ProviderTaskRow` · `ProviderProgress`
· `ProviderStatusBanner` · `ProviderStatusTimeline` · `ProviderFormField`
· `ProviderChoiceCard` · `ProviderErrorSummary` · `ProviderAutosaveIndicator`
· `ProviderEmptyState` · `ProviderErrorState` · `ProviderSkeleton`
· `ProviderStickyActions` · `ProviderMetric`

Geometry and colour live in the component; callers pass meaning
(`status="waiting"`), never appearance (`className="bg-indigo-50"`).

---

## 6. Forms, validation, autosave

**Fields.** Label above, input, help below, error replacing help.
`aria-describedby` links help and error; `aria-invalid` on error. Never rely on
placeholder as label.

**Validation timing.** Validate on blur, re-validate on change once errored,
never on first keystroke.

**Error summary.** On a failed save or submit, an `ProviderErrorSummary` at the
top of the form lists each error as a link to its field, receives focus, and is
announced. This is the accessible answer to the baseline's scattered red text.

**Autosave.** One indicator, one vocabulary, honest about durability:

| State    | Copy                                                   |
| -------- | ------------------------------------------------------ |
| idle     | _Saved_                                                |
| saving   | _Saving…_                                              |
| saved    | _Saved_ + timestamp                                    |
| offline  | _Not saved yet — keep this page open_                  |
| conflict | _Someone else updated this. Reload to see the latest._ |

The offline copy stays pessimistic: pending edits are in memory, and promising
otherwise is a lie the provider pays for.

**States.** Every data surface defines loading (skeleton matching final
layout — never a spinner in place of content), empty (what it is, why, one
action), error (what failed, what to do, retry), success (inline, not a
celebration).

---

## 7. Status presentation

Four independent axes, four separate statements. Never one badge.

| Axis         | Question                      | Presentation          |
| ------------ | ----------------------------- | --------------------- |
| Onboarding   | did they finish the form?     | progress + task list  |
| Standing     | is the account in good order? | banner only when not  |
| Verification | were documents accepted?      | status row + timeline |
| Work access  | may they work **right now**?  | the loudest element   |

`VERIFIED_NO_ACCESS` says the documents stand and more will not help.
`REVERIFICATION_REQUIRED` says send fresh ones. Collapsing these — as before
9B.24 — tells the first group to do something that cannot work.

**Timeline** for submitted/returned: what happened, when, what is needed next.
Reason _codes_ mapped to provider-safe copy; reviewer prose never appears.

---

## 8. Bilingual and RTL

One i18n system. Logical properties throughout (`ms-`/`me-`, `text-start`), no
`left`/`right`. Directional icons (chevrons, back arrows) mirror; brand marks
and media controls do not. Numerals stay Western-Arabic. `dir` is set on the
document, never per component. Every screen is captured in both languages at
every acceptance viewport — the Arabic column is not optional evidence.

---

## 9. Accessibility — WCAG 2.2 AA

Landmarks (`banner`/`nav`/`main`); one `h1` per screen, no skipped levels;
visible focus (2px accent ring, 2px offset) never removed; dialogs trap and
restore focus; status changes announced via a polite live region; contrast ≥4.5:1
body and ≥3:1 large/UI; targets ≥44×44px; `prefers-reduced-motion` honoured;
no meaning by colour alone; usable at 200% zoom and 320px.

---

## 10. Visual acceptance matrix

A screen is accepted only when its rendered evidence has been **looked at**, at:

320 · 390 · 430 · 768 · 1024 · 1440, in English and Arabic.

Screens: onboarding entry · hub (empty / partial / complete) · six task screens
· validation error · autosaving · offline · review with blockers · ready to
submit · submitted · action required · verified-no-access · active access ·
workspace home · opportunities · job detail · messages · earnings · profile ·
verification · loading · empty · server error.

Each is `PASS` / `PARTIAL` / `FAIL` with the defect named. Playwright passing is
not acceptance.

---

## 11. Rollout and rollback

- `VITE_PROVIDER_ONBOARDING_V2` remains the switch. Default flips to **on** only
  in the final commit, after every gate is green.
- `localStorage['hsm.ff.providerOnboardingV2']` keeps overriding in both
  directions — the per-browser escape hatch needs no deploy.
- V1 stays in the tree for one release as the rollback path.
- **V1 removal criteria:** V2 default-on in production for one full release with
  no rollback; no open Sev-1/2 against the provider surface; onboarding
  submission rate at or above the V1 baseline; the legacy wizard's remaining
  unique coverage ported.
- Rollback is a flag flip. No migration, no data movement — both surfaces write
  the same versioned draft through the same endpoints.
