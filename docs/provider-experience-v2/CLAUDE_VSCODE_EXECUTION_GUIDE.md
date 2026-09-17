# Working on Provider Onboarding V2 with Claude Code

Current workflow for the UX/UI permission update of 2026-09-16. Scoped design
improvements are allowed; preserving security, real behavior, and verifiable
quality is mandatory. Editing these instructions does not itself redesign or
activate any application screen.

## 1. Use the version-controlled instructions

Read the current task together with these canonical files:

```text
CLAUDE.md
.claude/rules/ux-ui-design-policy.md
.claude/rules/provider-onboarding-v2.md
```

The shared UX/UI policy governs design permission, reference handling, and
acceptance. The provider rule adds its domain-specific state and persistence
requirements. Do not maintain a hand-copied duplicate of either rule.

The repository's narrow `.gitignore` exception tracks `.claude/rules/*.md`;
personal settings, credentials, and machine-local memory do not belong here.
A GitHub change does not update an existing local checkout automatically. Fetch
and use the policy branch, or update the relevant branch after the PR is merged,
without discarding unrelated local changes.

## 2. Confirm the context and the real baseline

Open VS Code at the repository root and start a fresh Claude Code session after
updating the checkout. Run:

```text
/context
```

Confirm `CLAUDE.md` and the shared policy are loaded. The provider rule is
path-scoped: open an affected provider file before checking that it loaded too.
Inspect applicable nested/local instructions for conflicts. Do not weaken
personal or managed security settings to obtain design permission, and do not
claim to have inspected machine-local files through GitHub.

Before implementation, record branch, HEAD, worktree changes, affected routes,
feature flags, and the real API/runtime. State Mode A, B, C, or the scoped mix.
Do not redesign a legacy fallback while claiming the V2 route changed.

## 3. Define the current UX/UI task

For each affected screen, record the user goal, current friction, proposed
improvement, server dependency, and acceptance evidence. The current task
bounds the work; a small component improvement is not a whole-page redesign.

A request to improve UX/UI permits the necessary scoped visual changes without
asking for repeated permission. A current explicit reference-matching or
no-redesign request still controls its named surface.

Use the design system and historical references as the starting point:

```text
docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md
docs/provider-experience-v2/reference/provider-onboarding-prototype.html
docs/provider-experience-v2/reference/provider-onboarding-user-flow.svg
docs/provider-experience-v2/reference/provider-onboarding-user-flow.png
docs/provider-experience-v2/reference/provider-onboarding-delivery-readme.md
```

Preserve historical assets. For intentional changes, record a versioned target
or written specification, retain before/after evidence, and update the affected
living design documentation. Do not silently change a visual target to hide a
regression. A missing optional reference does not block well-defined repairs.

## 4. Implement and verify the affected journey

Follow the shared policy: mobile-first, focused tasks, consistent tokens and
components, English/LTR and Arabic/RTL, and WCAG 2.2 AA as the accessibility
target. Use 44x44 CSS px targets and 16 CSS px editable mobile text as project
requirements. Verify widths 320, 390, 430, 768, 1024, and 1440, plus zoom and
keyboard behavior. A narrow centred form is valid when it serves the task;
neither 480px forever nor a full desktop dashboard is mandatory.

Keep the relevant checks required:

- Real-API persistence through navigation, reload, and sign-out/sign-in.
- Session/role refresh and server-authoritative route/capability checks.
- API policy, moderation, readiness, and submission regressions.
- Accessibility, responsive behavior, and inspected visual comparisons.
- Applicable package/build checks and configured repository/security gates.

For a changed visual contract, update only the affected assertions and target
with rationale and review. Keep unchanged surfaces on their existing contract.
Do not loosen global pixel budgets, add skips, or remove behavioral assertions
merely to make an intentional design difference disappear from CI.

## 5. Separate publishing from acceptance

Run applicable local checks before publishing. Record unavailable checks and
keep the PR draft when verification is incomplete. A scoped push is allowed to
trigger remote CI; requiring remote results before that push is circular.
Do not bypass hooks. Required checks must pass on the final SHA before a
completion or merge-readiness claim. Merge/deployment needs explicit authority.

For instruction-only work, validate documents, paths, frontmatter, consistency,
and retained safety rules. Report application checks not run as not run; do not
claim the UI, persistence, or accessibility was exercised by a policy edit.
Configured required CI remains required.

The report must separate changed/published, verified, visually accepted,
merged, and deployed. Include exact commands and counts, limitations, intended
visual differences, branch, SHA, PR, and final-commit CI status. Cover every
affected state; do not treat the historical 18-screen count as a ceiling for
new states or as a reason to redesign unrelated screens.

## 6. Historical material is not a new blanket freeze

`SPRINT_09B29_PROVIDER_ONBOARDING_V2_IMPLEMENTATION_PROMPT.md` and
`SPRINT_09B29_BASELINE.md` preserve their original sprint requirements and
historical evidence. Do not automatically restart that sprint or use its old
no-redesign/pre-push-CI wording to override the current task and shared policy.

Phase 1 moved the four reference assets without changing their contents.
Phase 3 resolved conflict C5 by version-controlling the canonical provider
rule and deleting the duplicate `provider-onboarding-v2-claude-rule.md`.
Hashes recorded for those phases identify historical snapshots, not the
current policy version; retain their historical meaning.

When further work is needed, use a scoped continuation such as:

```text
Continue from the first unmet acceptance criterion for the current task.
Apply CLAUDE.md, the shared UX/UI policy, and the provider rule. Improve the
scoped design where justified; preserve security, contracts, and persistence.
Document intentional visual changes and inspect the resulting evidence.
Do not weaken tests, expand scope, or claim unverified results. Publish a
draft for remote CI when needed; do not merge or deploy without authority.
```
