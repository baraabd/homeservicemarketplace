# SPRINT 09B.29 — Provider Onboarding V2: Exact Design Parity, Durable Persistence, and Backend Integration

> Copy this entire prompt into Claude Code in VS Code while the terminal is open at the repository root. Do not shorten it. Do not attach screenshots without also placing the reference files listed below inside the repository.

## Role and operating standard

Act as the principal software engineer and product architect responsible for a production marketplace. Apply the judgment, caution, traceability, accessibility discipline, and test rigor expected from an engineer with 30 years of experience across frontend, backend, databases, security, distributed state, and CI/CD.

This is an implementation mandate, not a request for a new design. You have no visual-design discretion unless this prompt explicitly grants it. The supplied prototype, flow map, and design contract are the approved product specification.

## Mission

Complete Provider Onboarding V2 end to end so that:

1. Its rendered UI is materially identical to the approved mobile-first reference.
2. Every editable value is persisted by the backend and survives navigation, hard reload, browser restart, and sign-out/sign-in.
3. Provider-role activation and session synchronization cannot produce a stale-role `403` loop.
4. Pending specialty moderation cannot deadlock provider onboarding or final submission.
5. `401`, `403`, validation, network, conflict, and server failures have distinct and truthful recovery states.
6. The six-task hub, review, submission, post-submission status centre, returned state, and active workspace all use one server-owned policy.
7. Arabic RTL and English LTR have full functional and visual parity.
8. No commit or push occurs until every required gate is green and evidence has been captured.

## Hard-stop preconditions

Before changing code, verify that these files exist:

- `docs/provider-experience-v2/reference/provider-onboarding-prototype.html`
- `docs/provider-experience-v2/reference/provider-onboarding-user-flow.svg`
- `docs/provider-experience-v2/reference/provider-onboarding-user-flow.png`
- `docs/provider-experience-v2/reference/provider-onboarding-delivery-readme.md`
- `docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md`

If any file is missing, STOP and report exactly which file is absent. Do not approximate the design from memory, the current implementation, or generic component-library defaults.

At the beginning, calculate and record SHA-256 hashes for all reference files. Never edit those reference files during this sprint. At the end, calculate the hashes again and prove they are unchanged.

## Source-of-truth precedence

Resolve ambiguity in this exact order:

1. The interactive prototype is the visual and interaction source of truth.
2. The SVG user flow is the navigation, branching, lifecycle, and recovery source of truth.
3. `UX_UI_DESIGN_SYSTEM.md` is the token, responsive, typography, component, RTL, and accessibility source of truth.
4. Shared contracts, API policy, and database invariants are the data and authorization source of truth.
5. Existing production code is an implementation constraint, not a visual reference.

If sources genuinely conflict, do not choose silently. Record the conflict, affected files, user impact, and recommended decision, then pause for the product owner's decision. A missing component is not permission to redesign the screen.

## Absolute prohibitions

- Do not invent layouts, colors, spacing, labels, icons, navigation, states, or interactions.
- Do not use the current V1 or current incomplete V2 UI as the visual source of truth.
- Do not stretch onboarding forms across a desktop viewport.
- Do not restore the old dark decorative phone frame.
- Do not display workspace bottom navigation while onboarding is `DRAFT`, `RETURNED`, or `SUBMITTED`.
- Do not treat all `403` responses as expired sessions and do not globally retry every `403`.
- Do not display “Saved” or its Arabic equivalent before a successful server response.
- Do not keep business-critical onboarding data only in React state, local storage, or a client cache.
- Do not duplicate the lifecycle decision table in the client.
- Do not allow pending moderation to masquerade as missing provider input.
- Do not weaken authorization, validation, accessibility, lint, type, unit, integration, E2E, visual, migration, audit, or security gates.
- Do not skip, quarantine, delete, or loosen a failing test merely to make CI pass.
- Do not change unrelated Seeker or Admin behavior.
- Do not commit generated secrets, environment files, screenshots containing credentials, or test accounts.
- Do not use destructive Git/database commands, overwrite user changes, drop a populated database, force-push, or modify/delete existing stashes.
- Do not commit or push partial work.

## Phase 0 — Establish and preserve the baseline

Perform read-only discovery first:

1. Print the repository root, current branch, `HEAD`, upstream, `origin/develop`, worktree status, stash list, Node version, pnpm version, Docker/Compose status, database migration status, and occupied development ports.
2. Preserve all pre-existing changes and stashes. If the tree is dirty, identify ownership and avoid touching unrelated files.
3. Determine which branch contains the latest Provider Onboarding V2 work. Do not assume a historical branch name or SHA.
4. Create a dedicated branch from the correct current integration base. Do not merge, rebase, or push until the baseline is recorded.
5. Run the existing relevant tests before modification and record exact pass/fail/skip counts.
6. Serve the approved prototype locally and capture deterministic baseline screenshots for all 18 screens in Arabic and English at 390×844. Also capture the responsive reference at 320, 430, and 768 widths for representative long-content screens.
7. Create `docs/provider-experience-v2/SPRINT_09B29_BASELINE.md` containing the evidence, reference hashes, known failures, and commands used.

Do not describe a failing baseline as green. Distinguish repository defects, environment defects, and test-harness defects.

## Phase 1 — Install persistent Claude project instructions

Before implementation, copy the supplied rule file to:

`/.claude/rules/provider-onboarding-v2.md`

If the repository already uses a root `CLAUDE.md`, preserve it and add this single import only if the detailed rule is stored outside `.claude/rules`:

```text
@docs/provider-experience-v2/CLAUDE_PROVIDER_ONBOARDING_V2_RULES.md
```

Keep `CLAUDE.md` concise. Run `/context` and report that the project instructions and the Provider Onboarding V2 rule are loaded. If they are not loaded, stop before editing code.

Project instructions guide behavior; automated tests and protected CI checks are the actual merge enforcement. Add no tool hook that could damage user work. If a repository hook is added, it may only block commit/push when the documented verification script fails.

## Canonical product and state model

The implementation must keep these four axes independent:

1. **Onboarding completion** — what provider-controlled input is missing or complete.
2. **Account standing** — account-level eligibility or restriction.
3. **Verification/moderation** — pending, approved, or returned platform review.
4. **Work access** — whether the provider may view jobs, bid, and operate in the workspace.

The backend owns the meaning of those axes, task readiness, blockers, and the next action. The frontend renders them and may not reconstruct a parallel lifecycle policy.

Required task semantics:

- The onboarding hub exposes exactly six provider tasks: basic details, services and experience, work area, working hours, public profile/portfolio, and review/submission.
- A task may distinguish provider input completion from moderation status.
- A specialty application in `PENDING` moderation counts as provider input completed when all provider-controlled fields are present.
- Pending specialty moderation may block account activation or work access, but it must not block access to final review or submission.
- A provider-action blocker must deep-link to the exact task and, when possible, the exact missing field.
- Moderation, account, or platform blockers must never instruct the provider to re-enter already-saved data.
- The professional title is generated from the primary service; do not ask the provider to enter a duplicate professional title.

Use existing shared contracts and enums where available. If a contract is incomplete, update the shared contract first, then backend, then frontend. Do not use untyped string statuses scattered across layers.

## Required repair A — Provider upgrade and stale-role authorization

Trace the real call chain rather than patching the visible symptom. Inspect at minimum the current equivalents of:

- `apps/web/src/app/hooks/provider/useProviderProfile.ts`
- `apps/web/src/app/components/provider/ProviderApp.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/app/features/provider-onboarding-v2/hub-view-state.ts`
- provider upgrade/session hooks and query keys
- provider profile and onboarding API guards/controllers

Observed failure to prove or disprove from current source:

- The provider-upgrade mutation exposes or seeds a `DRAFT` provider profile before the browser has obtained a session/JWT containing the provider role.
- Routing reacts to that cache and enters provider onboarding with the old seeker token.
- Role-protected profile/hub requests return `403`.
- The UI incorrectly maps `403` to “Please sign in again.”
- Session-refresh failure may be swallowed and onboarding queries may remain stale.

Required behavior:

1. After a successful role-changing upgrade, await authoritative session refresh before publishing provider state or navigating to any provider-only route.
2. Never swallow refresh errors. Keep the user on the activation surface and show a recoverable synchronization error with retry.
3. After refresh, verify that the authoritative session includes the provider role/capability.
4. Invalidate/refetch the canonical auth/session query, provider profile query, onboarding hub query, and relevant onboarding task queries in a deterministic order.
5. Permit at most one stale-role recovery attempt for the known post-upgrade transition. Prevent refresh loops and request storms.
6. Preserve normal authorization: a genuine `403` remains forbidden.
7. Map `401` to missing/expired authentication and sign-in recovery.
8. Map `403` to authenticated-but-forbidden, stale-role synchronization, or capability restriction according to context; never label it automatically as an expired session.
9. Prove cookie and token handling against the real browser and real API, not only mocked handlers.

Do not solve this by refreshing on every `403`, relaxing API guards, or granting a provider role client-side.

## Required repair B — Services/moderation onboarding deadlock

Inspect the canonical onboarding policy, hub resolver, specialty-application workflow, submit command, activation policy, and shared contracts. At minimum inspect the current equivalents of:

- `apps/api/src/modules/provider/onboarding/provider-onboarding.policy.ts`
- `apps/api/src/modules/provider/onboarding/hub/onboarding-hub-resolver.ts`
- provider onboarding controller/service and submission path
- Provider Onboarding V2 hub/review view-state code

Reproduce with a real database:

1. Create or use a provider draft.
2. Complete every provider-controlled field.
3. Select services that create pending specialty applications.
4. Reload the hub and attempt review/submission.

Expected result:

- The services task truthfully shows that provider input is complete and moderation is pending.
- The next provider action skips completed input.
- Review/submission becomes available when no provider-action blockers remain.
- Submission succeeds.
- Activation/work access stays blocked until required moderation is approved.

The API policy and hub resolver must agree. Add regression tests that fail under the current deadlock and pass only after the policy is corrected.

## Required repair C — Durable save and truthful autosave

Audit every Provider Onboarding V2 task mutation and hydration path. Build one reusable persistence model rather than six unrelated save implementations.

Required save state machine:

```text
PRISTINE -> DIRTY -> SAVING -> SAVED
                         \-> ERROR -> DIRTY/RETRYING
                 SAVING + newer edit -> DIRTY_AFTER_SAVE -> SAVING
```

Rules:

1. Display `Saved` only after a successful backend mutation response for the current or newer client revision.
2. Display `Saving…` while a request is in flight and `Not saved`/retry UI after failure.
3. Debounce safe autosaves, serialize or version writes, and prevent an older response from overwriting a newer edit.
4. Cancel or guard stale hydration requests so a late GET cannot overwrite newer local state.
5. On task mount, hydrate from the authoritative backend draft. Local storage may be used only for explicitly documented crash recovery, never as business truth.
6. On close, route change, hub return, and final review navigation, flush pending writes. If persistence fails, remain on the task or present an explicit discard/retry decision; never silently navigate while saying saved.
7. Preserve server validation errors at field level without erasing valid unsaved input.
8. Use idempotency or revision/concurrency protection where duplicate requests or out-of-order responses can corrupt state.
9. Refetch or reconcile the server result after mutation and update all related query caches.
10. Every mutation response and API error must be observable in development without logging credentials or personal data.

For every task, prove this sequence with the real API and database:

`edit -> successful save -> hub -> revisit -> hard reload -> sign out -> sign in -> revisit`

The same saved values must remain after every transition. A visual toast is not proof of persistence; verify the backend read model and database row.

## Exact visual contract — no redesign

### Responsive shell

- Primary design viewport: 390×844.
- 320–639 px: full-width, single-column onboarding surface using the viewport; no decorative outer phone frame.
- 640 px and wider: centre one focused column with `max-width: 480px` on a neutral page background. Do not expand form controls across the entire page.
- Respect safe-area insets and dynamic mobile browser chrome.
- No horizontal overflow at 320, 390, 430, or 768 px.
- Onboarding has its own focused shell and no workspace bottom navigation until work access is active.

### Typography and direction

- Arabic: Cairo with correct RTL ordering and icon direction.
- English: Inter with LTR direction.
- Editable text controls use at least 16 px text on mobile.
- Labels, errors, counters, placeholders, numbers, phone fields, time fields, and mixed-script content must preserve correct bidi behavior.

### Tokens

Use shared semantic tokens. Do not hardcode one-off values inside screen components.

| Purpose        | Value     |
| -------------- | --------- |
| Background     | `#F8FAFC` |
| Surface        | `#FFFFFF` |
| Sunken surface | `#F1F5F9` |
| Border         | `#E2E8F0` |
| Strong border  | `#CBD5E1` |
| Primary text   | `#0F172A` |
| Muted text     | `#475569` |
| Accent         | `#2563EB` |
| Accent hover   | `#1D4ED8` |
| Accent subtle  | `#EFF6FF` |
| Success        | `#15803D` |
| Warning        | `#B45309` |
| Review/info    | `#4338CA` |
| Danger         | `#B91C1C` |

Spacing scale: `4, 8, 12, 16, 20, 24, 32, 40, 56`.

Radius scale: `8, 12, 16, full`.

Use restrained shadows only where the reference uses elevation. All text and interactive states must meet WCAG 2.2 AA contrast. Visible keyboard focus is mandatory.

### Interaction rules

- Minimum interactive target: 44×44 CSS pixels.
- One dominant primary action per view.
- Use a sticky safe-area-aware action region where shown in the prototype.
- Disabled controls must explain the blocker.
- Validation should appear at the field after intent to submit/continue, not as a wall of generic red errors.
- Incomplete review items use orange warning cards with a precise `Complete now` deep link.
- Image collection uses camera/gallery upload, crop, preview, reorder, delete, retry, and honest moderation states. Never use a raw image-URL text field.
- Broken images show a controlled placeholder and retry action; never expose browser broken-image UI.

## Screen manifest — implement and verify all 18 states

Implement the screens and transitions exactly as represented by the prototype and flow map:

1. Provider account activation.
2. Role/session synchronization.
3. Six-task onboarding hub with partial progress.
4. Basic details: name, phone, direct profile-photo upload only.
5. Service search, categories, selection, primary service, and moderation disclosure.
6. Experience stepper and 44 px transport choice cards.
7. Work origin plus simplified map, automatic transport-based service radius, and locked expansion reward.
8. Working hours with multi-day selection, start/end time, apply-to-selected, and unavailable toggle.
9. Public profile content and generated professional title.
10. Portfolio upload, crop/reorder/delete/retry, preview, and moderation.
11. Completed hub with input completion separated from moderation.
12. Final review with precise completion links.
13. Terms consent integrated with a sticky submission action.
14. Submission confirmation and expectation management.
15. Status centre showing all four status axes.
16. Returned/action-required state with correction deep links.
17. Session-expired state for genuine `401` only.
18. Active provider state with workspace access unlocked.

Specific product rules:

- Do not request a duplicate home/workshop address if city/neighbourhood/work origin already satisfies the policy.
- Do not expose the timezone name in the hours UI.
- Set the initial service radius from the selected transport (for example walking 3 km and car 15 km) according to the server policy.
- Explain expansion as a reward (for example unlock 25 km after three excellent ratings) without promising an outcome the backend cannot support.
- Replace percentage-only progress with task-count and motivational copy such as `3 of 6 tasks complete`.

## Component and architecture requirements

1. Reuse the existing application architecture, shared contracts, query library, localization framework, and design-system primitives where they satisfy the reference.
2. Create or repair reusable Provider Onboarding V2 primitives for the shell, header, task card, status badge, fields, upload, choice card, stepper, alert, save indicator, sticky action bar, status axis, map/radius card, schedule editor, and preview card.
3. Keep screen components declarative. Move persistence orchestration, API mapping, and state transitions into typed hooks/services.
4. Use server-returned task IDs, issue codes, field paths, statuses, and next actions. Do not infer completion from whether a client field happens to be non-empty.
5. Ensure invalidation keys are centralized and stable.
6. Never introduce a second provider profile/onboarding source of truth.
7. Make all async states explicit: initial loading, background refresh, saving, saved, dirty, validation error, network error, forbidden, expired session, empty, moderation pending, returned, submitted, and active.
8. Preserve deep links and browser history. Back/close behavior may not discard a pending edit silently.

## Test mandate

Write failing regression tests before or with each repair. Mock-only tests are necessary but not sufficient.

### Unit and component tests

- `401` and `403` map to different view states and copy.
- The upgrade flow awaits refreshed authoritative session state before provider navigation/cache publication.
- Refresh failure is visible and retryable.
- Only one stale-role recovery attempt can occur.
- Query invalidation/refetch order is deterministic.
- Hub status and next-action mapping come from server semantics.
- Pending specialty input is provider-complete while moderation remains pending.
- Save state machine never shows saved before server success.
- Out-of-order mutation and hydration responses cannot regress visible or persisted values.
- RTL/LTR, error associations, focus order, dialog focus trap, keyboard use, and reduced motion.

### API integration tests with real PostgreSQL/Redis

- Seeker-to-provider upgrade followed by refreshed session allows provider profile and hub endpoints to return `200`.
- An old token remains forbidden without weakening authorization.
- Completed input plus pending specialty moderation permits review and submission.
- Pending required moderation blocks activation/work access, not submission.
- All six task writes can be read back from the authoritative endpoints.
- Duplicate/idempotent saves do not create corrupt or duplicate records.
- Validation, concurrency conflict, returned correction, resubmission, and audit events are correct.

### Browser E2E against the real API

At minimum cover:

1. Activate provider -> refresh session -> enter V2 without a `403` loop.
2. Complete all six tasks -> review -> accept terms -> submit.
3. Pending specialty moderation does not deadlock the journey.
4. Each task persists across hub return, revisit, hard reload, and sign-out/sign-in.
5. Simulated save failure never displays saved and prevents silent data loss.
6. Session expiration (`401`) provides sign-in recovery.
7. Genuine forbidden access (`403`) shows access/synchronization recovery, not session-expired copy.
8. Returned application deep-links to corrections and resubmits.
9. Active provider alone receives workspace navigation and work access.
10. Arabic and English flows complete successfully.

Use deterministic test accounts and isolated databases. Never test destructive flows against the user's development database.

### Visual regression and responsive acceptance

1. Use the prototype's `#hsm-screen-picker` to select screens 0–17 and `#hsm-lang` to switch language.
2. Capture all 18 screens in Arabic and English at 390×844 using one pinned Chromium/font environment.
3. Capture representative screens at 320, 430, and 768 widths in both languages.
4. Capture the implementation with the same fixtures, viewport, fonts, locale, and browser.
5. Compare with Playwright image snapshots. Target `maxDiffPixelRatio <= 0.005`; any intentional difference must be enumerated and approved by the product owner. Do not self-approve visual deviations.
6. Add assertions for no horizontal overflow, 44 px targets, 16 px editable text, focused max-width 480 behavior, absent onboarding bottom navigation, sticky action visibility, RTL/LTR direction, and WCAG 2.2 AA automated checks.

A screenshot existing is not a pass. Inspect the diff and publish the diff artifact.

## Verification gates

Discover the repository's canonical scripts and run their strict equivalents. The minimum gate includes:

1. lockfile/frozen install reproducibility;
2. formatting check;
3. shared-contract generation/check;
4. Prisma schema validation and client generation;
5. migration deploy/status/drift against an isolated database;
6. TypeScript typecheck for every affected package;
7. lint with no new warnings;
8. all relevant unit/component tests;
9. the full API test suite;
10. real Postgres/Redis integration tests;
11. web production build with Provider Onboarding V2 enabled;
12. browser E2E against the real API;
13. full Playwright regression matrix for Provider, Seeker, and Admin;
14. visual regression matrix and accessibility scan;
15. Docker cold build, migration job, application boot, readiness, media, and OTP smoke tests;
16. dependency, secret, and container scans required by CI.

If a gate cannot run because of an environment or network problem, report it as unverified. Do not substitute a mock result or claim 100% completion.

## CI and merge enforcement

Update CI only when needed to run the tests above. Required checks must fail on:

- a visual snapshot regression;
- a persistence regression;
- a role/session `403` regression;
- onboarding-policy disagreement;
- accessibility regression;
- missing reference files or changed reference hashes;
- disabled Provider Onboarding V2 in its intended environment;
- skipped mandatory tests.

Do not bypass branch protection. If repository settings are outside your access, provide the exact required-check names the owner must select in GitHub branch protection.

## Commit and push protocol

Only after every applicable gate is green:

1. Review `git diff` for unrelated files, secrets, generated noise, and changes to reference files.
2. Re-run the final gate from a clean worktree state where possible.
3. Create focused conventional commits; do not compress unrelated backend, UI, and test concerns into an opaque commit.
4. Push the feature branch normally; never force-push.
5. Open or update a PR with the baseline, root causes, architectural decisions, migration impact, test counts, visual artifacts, accessibility evidence, risk, and rollback instructions.
6. Wait for GitHub CI. A local green result is not a remote green result.
7. If CI fails, diagnose the exact failing job/log, fix the root cause, rerun locally, commit, push, and wait again.

Do not state `100% complete`, `production ready`, or `all green` unless the work, local gates, remote required checks, and evidence all support that statement.

Suggested commit sequence, adjusted to actual scope:

```text
fix(auth): synchronize provider role before onboarding navigation
fix(onboarding): separate provider completion from moderation
fix(onboarding): make task autosave durable and truthful
feat(web): match provider onboarding v2 approved mobile design
test(onboarding): add real-api persistence and visual regressions
docs(onboarding): record sprint 09b29 verification evidence
```

## Required deliverables

- Working frontend and backend implementation.
- Shared typed contract changes, if required.
- Database migration only if the proven data model requires it.
- Unit, component, API integration, real-browser E2E, accessibility, and visual-regression tests.
- `docs/provider-experience-v2/SPRINT_09B29_BASELINE.md`.
- `docs/provider-experience-v2/SPRINT_09B29_VERIFICATION.md`.
- Deterministic baseline, actual, and diff screenshot artifacts.
- Updated operational/environment documentation for enabling V2.
- Focused commits, pushed branch, PR link, and final CI URLs.

## Progress reporting protocol

Work phase by phase. After each phase, report:

- evidence collected;
- files changed;
- commands executed;
- exact test counts;
- unresolved risk/blocker;
- whether the phase exit criteria are met.

Do not ask for confirmation between routine phases. Pause only for a real product conflict, missing authority, missing reference, destructive action, or choice that materially changes the approved design.

## Final response format

Return this exact structure:

1. **Verdict:** complete / incomplete / blocked.
2. **Root causes proven:** evidence and affected call chains.
3. **Implementation:** frontend, backend, contracts, data, and CI changes.
4. **Design parity:** screen matrix, viewports, languages, diff threshold, deviations.
5. **Persistence proof:** task-by-task save/revisit/reload/re-login results.
6. **Authorization proof:** upgrade/session/401/403 results.
7. **Test evidence:** command, suites, passed, failed, skipped, duration.
8. **Git evidence:** base, branch, commits, pushed SHA, PR, remote CI URLs.
9. **Remaining risks:** explicit and honest; `none` only if proven.

Begin now with Phase 0. Do not edit implementation code until the reference files, branch state, baseline behavior, and current failing call chains have been proven.
