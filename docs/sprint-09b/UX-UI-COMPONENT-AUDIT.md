# Sprint 9B — UX/UI component audit

Written **before implementing UI**. Every 9B surface gets one recorded decision:
**REUSE**, **EXTEND** (backward-compatibly, with regression tests), or **CREATE**
(with a written reason). Default order is reuse → compatible extension → creation.

Baseline: the Sprint 8 provider onboarding experience. 9B integrates evidence as
the **next server-driven stage of the same journey**, not a second wizard.

## Inventory — what actually exists

### Shells and routes

| Artifact                  | Path                                                              | Notes                                                    |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Provider shell + nav      | `app/components/provider/ProviderApp.tsx`                         | Orchestration surface. Must not become a monolith        |
| Onboarding wizard         | `app/components/provider/onboarding/ProviderOnboardingWizard.tsx` | Exports only `ProviderOnboardingWizard`                  |
| `WizardShell`             | same file, **line 162, NOT exported**                             | Gradient header + progressbar + scroll container         |
| `StepRail`                | same file, **line 328, NOT exported**                             | Step navigation                                          |
| `Card`                    | same file, **not exported**                                       | `rounded-3xl` surface                                    |
| Admin verification        | `app/components/admin/VerificationSection.tsx`                    | Orchestration surface; holds the placeholder 9B replaces |
| Provider lifecycle states | `app/components/provider/ProviderStatusState.tsx` (234 L)         | Lifecycle presentation                                   |

### Field and control primitives

`app/components/provider/onboarding/WizardFields.tsx` exports `FieldShell`,
`TextField`, `TextAreaField`, `ChoiceGroup<T>`, `ChipToggles`.

`app/components/ds/Button.tsx` — `variant` × `size` × **`tone: 'seeker' | 'provider' | 'admin'`**.
Provider accent `#4F46E5`, admin `#475569`. Also exports `IconButton`.

### Visual tokens (the baseline to preserve)

| Token           | Value                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Shell bg        | `bg-slate-50 dark:bg-slate-900`                                                                           |
| Header          | `bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-700`                                            |
| Card            | `bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm p-5 mb-4` |
| Controls        | `rounded-2xl`                                                                                             |
| Provider accent | `blue-600` / indigo `#4F46E5`                                                                             |
| Icons           | `lucide-react`                                                                                            |
| Motion          | `transition-[width] duration-300`                                                                         |

Logical properties are already in use (`-end-6`, `text-start`), so RTL is
structural. **No new styling convention is introduced by 9B.**

### State, i18n, direction, dark mode

| Concern                 | Existing mechanism                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Server state            | TanStack Query hooks under `app/hooks/provider/`, `app/hooks/admin/`                             |
| Query keys              | `providerQueryKeys` from `lib/provider/query-keys.ts`                                            |
| Typed EN/AR copy        | `onboarding/wizard-copy.ts` — `Record<Lang, Record<Code, string>>`, with a key-parity test       |
| Language / `dir` / dark | `i18n/LanguageContext.tsx` — sets `document.documentElement.dir` and `lang`; exposes `useLang()` |

### Explicitly forbidden for identity evidence

`ds/RequestMediaGallery.tsx`, `lib/media-url.ts` (`resolveMediaUrl`),
`lib/media-api.ts`, `lib/request-media/constants.ts`, `GET /v1/media/files/*`.
These are public-media specific by design; their cache path is
`public, max-age=31536000, immutable`.

## Decision matrix

| #   | 9B surface                                                              | Decision                   | Reason                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Evidence stage shell (gradient header, progress)                        | **EXTEND**                 | `WizardShell` is exactly right but module-private. Export it unchanged and reuse. Copying its Tailwind into a local shell is what forks the Provider identity                                                                                                                                                                                                                                                     |
| 2   | Step navigation                                                         | **EXTEND**                 | Same: export `StepRail`, no behaviour change                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Card surface                                                            | **EXTEND**                 | Export `Card`; the alternative is re-typing `rounded-3xl border-slate-100…` in a second place                                                                                                                                                                                                                                                                                                                     |
| 4   | Requirement checklist                                                   | **REUSE**                  | `FieldShell` + lucide status icons. Status is server-driven (`missingRequirements`)                                                                                                                                                                                                                                                                                                                               |
| 5   | Document type guidance                                                  | **REUSE**                  | `FieldShell` description slot                                                                                                                                                                                                                                                                                                                                                                                     |
| 6   | Title / description / date inputs (portfolio)                           | **REUSE**                  | `TextField`, `TextAreaField` unchanged                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | Category linkage                                                        | **REUSE**                  | `ChipToggles` / `ChoiceGroup`                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | All buttons                                                             | **REUSE**                  | `ds/Button` `tone="provider"` (provider) / `tone="admin"` (admin). No new button                                                                                                                                                                                                                                                                                                                                  |
| 9   | Lifecycle states (pending, ACTION_REQUIRED, rejected, expired, revoked) | **REUSE + EXTEND**         | `ProviderStatusState.tsx` owns lifecycle presentation. Extend its state union rather than building a parallel status surface                                                                                                                                                                                                                                                                                      |
| 10  | **Restricted evidence uploader**                                        | **CREATE** (feature-local) | **Justified:** security semantics are genuinely new — prepare/finalize idempotency, signature validation feedback, scan state, abortable upload, `URL.revokeObjectURL` on replace/unmount, and _no signed URL may enter the query cache_. `RequestMediaGallery` is public-media specific and is explicitly forbidden. It will reuse `FieldShell`, `Card`, `Button` and the token vocabulary for everything visual |
| 11  | **Restricted evidence viewer** (admin)                                  | **CREATE** (feature-local) | Same reason: short-lived authorized reads only, object URLs revoked, no storage key or credential reaches the UI                                                                                                                                                                                                                                                                                                  |
| 12  | Redacted preview list                                                   | **REUSE**                  | Existing list/card patterns. **Must not** reuse the active-feed request card, which renders exact location                                                                                                                                                                                                                                                                                                        |
| 13  | Admin queue table, filters, tabs                                        | **REUSE + EXTEND**         | `VerificationSection` stays orchestration; tabs move into a feature folder                                                                                                                                                                                                                                                                                                                                        |
| 14  | Admin action buttons                                                    | **REUSE**                  | Driven by `availableActions` (already server-owned since 9A)                                                                                                                                                                                                                                                                                                                                                      |
| 15  | EN/AR copy                                                              | **REUSE pattern**          | New `verification-copy.ts` following `wizard-copy.ts` exactly, with the same key-parity test. **No** provider-only language store, no third i18n mechanism                                                                                                                                                                                                                                                        |
| 16  | Query keys                                                              | **EXTEND**                 | Add a `verification` namespace to `providerQueryKeys`; no second factory                                                                                                                                                                                                                                                                                                                                          |
| 17  | Icons                                                                   | **REUSE**                  | `lucide-react` only. No new icon dependency                                                                                                                                                                                                                                                                                                                                                                       |

**Dependencies added: none.** No new state store, no new UI framework, no second
design system, no styling convention.

## Extensions and their regression risk

| Extension                                | Backward compatible?                                      | Regression cover                                                       |
| ---------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| Export `WizardShell`, `StepRail`, `Card` | Yes — additive `export` keyword only, no signature change | Existing `ProviderOnboardingWizard.test.tsx` must stay green unchanged |
| `providerQueryKeys.verification.*`       | Yes — new namespace                                       | Key-shape test                                                         |
| `ProviderStatusState` state union        | Yes — new members only, existing render paths untouched   | Existing tests plus new per-state cases                                |

## Accessibility commitments (WCAG 2.2 AA)

Semantic headings/landmarks; programmatic labels via `FieldShell`; visible focus;
keyboard-only operation; **error-summary focus** after validation failure;
**`aria-live`** for upload/save/scan announcements; non-colour status cues (icon +
text, not colour alone); **44×44 px** minimum touch targets; contrast in both
themes; `prefers-reduced-motion` respected.

Geometry to verify: 390×844 mobile, tablet, desktop; 200 % zoom; long Arabic
strings; no clipping, no horizontal overflow, no unreachable drawer action.

## Architecture

Feature folders, so neither orchestration surface grows into a monolith:

```
apps/web/src/app/features/provider-verification/   api/ hooks/ copy/ components/
apps/web/src/app/features/admin-verification/      api/ hooks/ copy/ components/
```

A shared abstraction is created only when **two real call sites** need the same
semantics; otherwise it stays feature-local. No CQRS, no state-machine framework,
no new global state library.

## Guardrail

A lint rule (not a comment-matching test) will fail the build if
`RequestMediaGallery`, `media-url`, `media-api` or `request-media/*` is imported
from either verification feature folder. That is robust — it matches module
specifiers, not prose.
