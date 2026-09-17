# UX/UI design policy

Current project design authority, adopted for the user's 2026-09-16 request.
Read with `CLAUDE.md`. This policy applies to UI work across customer, provider,
and admin surfaces; it does not turn an unrelated task into a redesign task.

## 1. Permission and boundaries

- Claude may change the design within the active UI task to improve usability,
  accessibility, responsive behavior, clarity, or consistency. The user need
  not repeat a special redesign permission for each affected component.
- Substantial design work uses Mode B. Modes A and C may include local design
  corrections needed for their scoped defect or feature. State the boundary.
- Layout, spacing, typography, token-based colors, forms, navigation, copy,
  component structure, and interactions may evolve when the UX rationale is
  documented. Reuse good components; do not preserve a known defect for reuse.
- Do not redesign unrelated routes, turn a component task into a full-page
  rewrite, add unrequested features, or silently change the product's brand.
- A current explicit no-redesign or reference-matching request controls its
  named scope. This policy replaces older blanket design freezes, not the
  user's current acceptance criteria.
- Security, privacy, authorization, ownership, server contracts, validation,
  audit, migrations, and data integrity remain non-negotiable. Do not change
  tool permissions, sandbox settings, hooks, or managed rules to enable design.

## 2. References and design decisions

- Inspect the real route, flags, current components, design tokens, server
  semantics, and user journey before changing the affected surface.
- For an improvement task, existing screenshots, prototypes, fixed widths,
  and historical sprint prompts are baseline evidence, not an immutable UI.
  For an explicit reference-matching task, the named reference is the target.
- Record the user goal, current friction, proposed change, affected routes and
  states, and measurable acceptance criteria before a substantial rewrite.
  A clear task brief is enough to proceed without repeated confirmation.
- When a reference is missing, report it. Use the written brief and existing
  design system where sufficient; do not block unrelated, well-defined work.
  Resolve genuinely missing product decisions rather than inventing them.
- Preserve historical reference assets and historical evidence. For a changed
  design target, add a separately versioned target or written specification,
  record intentional differences, and update the affected living design docs.
- Design permission is not automatic visual acceptance. Keep before/after
  evidence and request design review for the new target before accepting it.
  Never rewrite the old prototype or blindly regenerate snapshots to hide a
  regression. Unchanged surfaces retain their existing visual contract.

## 3. UX/UI acceptance requirements

- Start mobile-first at 390x844. Keep focused flows focused, with one dominant
  primary action per screen, clear hierarchy, readable copy, and recovery paths.
- Use shared semantic tokens and reusable primitives. Extend the design system
  coherently instead of scattering one-off colors, sizes, or spacing values.
- A centred single-column form is valid on desktop. Neither a universal 480px
  ceiling nor a mandatory full-width/two-column shell is a design goal. Choose
  readable measures and supporting context only where the journey benefits.
- Verify widths 320, 390, 430, 768, 1024, and 1440 CSS px in English/LTR and
  Arabic/RTL, plus 200% zoom and keyboard use. Review long Arabic strings,
  logical alignment, focus order, and intentional icon direction.
- No page-level horizontal overflow at 320px, clipped content, or inaccessible
  actions. Sticky controls respect safe areas, scrolling, and the keyboard.
- Target WCAG 2.2 AA: semantic structure, labels, contrast, visible/unobscured
  focus, keyboard operation, meaningful error feedback, and reduced motion.
  Automated accessibility checks do not establish conformance by themselves.
- Use at least 44x44 CSS px interactive targets and 16 CSS px editable mobile
  text as project usability requirements, not as a claim that every WCAG AA
  criterion uses those numerical thresholds.
- Include loading, empty, incomplete, saving, saved, error, offline, conflict,
  submitted, locked, and success states where applicable. Do not rely on color
  alone, hide blockers, or promise interactions that do not exist.
- Preserve language parity and entered data when switching language or route.
  Location permission is opt-in with a usable manual fallback. Image input
  uses upload/camera/gallery and supported editing, not a raw image-URL field.

## 4. Real behavior stays authoritative

- Backend policy owns readiness, progress semantics, blockers, moderation,
  capabilities, submission, and work access. Do not recreate it in the client.
- Keep onboarding completion, account standing, moderation, and work access
  separate. A better-looking screen must not grant an unapproved capability.
- Never show `Saved` until the backend confirms the current or newer revision.
  Preserve hydration, versioning, pending-write handling, retries, and recovery.
- Exercise relevant data through the real API and verify navigation, reload,
  and sign-out/sign-in persistence. Mocked presentation evidence is not proof
  of real persistence, route guards, or authorization.
- Preserve feature-flag defaults and legacy rollback paths unless the active
  task explicitly authorizes a rollout change. Report what users can reach.

## 5. Tests, publishing, and completion

- Run applicable formatting, lint, typecheck, unit, integration, build,
  real-browser, accessibility, and visual checks for the changed surface.
- Intentional visual or layout changes may require scoped updated assertions
  and versioned baselines. Explain each change, retain behavioral/security
  assertions, and obtain review of the new target. Do not increase global
  pixel budgets, disable checks, or add skips merely to obtain green output.
- Inspect screenshots, not just their existence. Report intentional differences
  separately from regressions and retain evidence for unchanged surfaces.
- Run applicable local checks before publishing. If execution is unavailable,
  document the limitation and keep the PR draft; never fabricate a pass or
  bypass hooks. A scoped branch may be pushed to trigger required remote CI.
- Required remote CI runs after the triggering push. Verify it on the final
  SHA before claiming completion or merge readiness. Never merge or deploy
  without explicit authorization; blocked CI is not a reason to weaken gates.
- For instruction-only changes, validate Markdown/frontmatter, referenced
  paths, consistency, and preservation of security rules. Report application
  tests not run as not run. Keep configured required CI checks intact.
- Report changed files, rationale, exact commands and counts, inspected visual
  evidence, unverified checks, remaining risks, branch, SHA, PR, and CI status.
  Distinguish committed/published from tested/accepted/merged/deployed.
