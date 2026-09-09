---
paths:
  - "apps/web/src/app/features/provider-onboarding-v2/**"
  - "apps/web/src/app/components/provider/**"
  - "apps/web/src/app/hooks/provider/**"
  - "apps/web/src/lib/api.ts"
  - "apps/api/src/modules/provider/onboarding/**"
  - "packages/contracts/**"
  - "tests/**/provider*onboarding*"
  - "docs/provider-experience-v2/**"
---

# Provider Onboarding V2 — Mandatory Implementation Rule

These instructions apply to every Provider Onboarding V2 frontend, backend, contract, test, and document change.

## Approved sources

Read these files before editing affected code:

1. `docs/provider-experience-v2/reference/provider-onboarding-prototype.html`
2. `docs/provider-experience-v2/reference/provider-onboarding-user-flow.svg`
3. `docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md`
4. Current shared contracts and backend onboarding policy

If a reference is missing or sources conflict, stop and report the issue. Never invent a substitute design.

## Non-negotiable UI contract

- Match the approved prototype; do not redesign it.
- Design at 390×844 first.
- At 320–639 px use a full-width single column.
- At 640 px and above centre the flow at max-width 480 px on a neutral background.
- Never stretch onboarding forms to full desktop width.
- Never use the old dark decorative phone frame.
- Hide workspace bottom navigation for DRAFT, RETURNED, and SUBMITTED onboarding.
- Arabic uses Cairo/RTL; English uses Inter/LTR.
- Touch targets are at least 44×44 px; editable mobile text is at least 16 px.
- Use semantic design tokens; no one-off hex, spacing, radius, or shadow values in screen components.
- One dominant primary action per screen; sticky actions respect safe-area insets.
- Use direct image upload/camera/gallery with preview/crop/reorder. Never expose a raw image URL input.
- WCAG 2.2 AA contrast, focus, labeling, keyboard, screen-reader, and reduced-motion behavior are required.

## Non-negotiable state contract

- Backend policy owns task readiness, blockers, next action, moderation, submission, and work access.
- The client renders server semantics and does not recreate the lifecycle decision table.
- Keep onboarding completion, account standing, moderation, and work access as separate axes.
- Pending specialty moderation counts as provider input complete when provider-controlled fields are complete.
- Pending moderation may block activation/work access, never final review or submission.
- `401` means missing/expired authentication.
- `403` means authenticated but forbidden, stale-role synchronization, or missing capability according to context. Never relabel every `403` as session expiry.
- After provider upgrade, await authoritative session/role refresh before exposing provider state or navigating.
- Never globally refresh or retry all `403` responses.

## Non-negotiable persistence contract

- Never show `Saved` before the backend confirms the current or newer revision.
- All fields hydrate from and persist to the authoritative API/database.
- Guard out-of-order GET/mutation responses and serialize or version writes.
- Flush pending saves before leaving a task; on failure, expose retry/discard and prevent silent data loss.
- A task is not accepted until its data survives hub navigation, hard reload, and sign-out/sign-in in a real-API E2E test.

## Change discipline

- Preserve unrelated user changes and stashes.
- Do not weaken API guards, validation, tests, CI, audit, or security controls.
- Do not skip or loosen failing tests to obtain green output.
- Do not change reference design files.
- Do not commit or push until unit, API, real-browser E2E, accessibility, visual regression, production build, and required CI gates pass.
- Never force-push.

When reporting completion, include exact commands, pass/fail/skip counts, screenshot diff evidence, branch, commit SHA, PR, and remote CI results. If a required check was not run, report the work as unverified rather than complete.
