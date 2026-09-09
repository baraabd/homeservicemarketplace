# Running the Provider Onboarding V2 mandate in Claude Code

> **Status (Sprint 09B.29, Phase 1): steps 1 and 2 are done.** The four reference
> files were moved into `docs/provider-experience-v2/reference/` with `git mv` and
> SHA-256 proof that their contents are unchanged, and the rule now lives at
> `.claude/rules/provider-onboarding-v2.md`. Evidence:
> `SPRINT_09B29_BASELINE.md` §2.
>
> **Conflict C5 is resolved (Phase 3 closure).** `.claude/` was gitignored, so
> the rule survived in version control only as a hand-copied duplicate in this
> directory — and the two had already begun to drift (YAML quote style).
>
> `.gitignore` now carries a narrow exception that un-ignores
> `.claude/rules/*.md` and nothing else, so the rule the agent actually loads is
> the one under version control. The duplicate
> (`provider-onboarding-v2-claude-rule.md`) has been deleted.
>
> **Canonical, single source of truth:** `.claude/rules/provider-onboarding-v2.md`
> (SHA-256 `a1185140d002ced0e63473ee9eeafe22d5c253b02a8cc85c59fb5856d2b30baa`).

## 1. Add the approved references to the repository

Create this directory:

```text
docs/provider-experience-v2/reference/
```

Copy these delivered files into it without editing them:

```text
provider-onboarding-prototype.html
provider-onboarding-user-flow.svg
provider-onboarding-user-flow.png
provider-onboarding-delivery-readme.md
```

Keep the existing design contract here:

```text
docs/provider-experience-v2/UX_UI_DESIGN_SYSTEM.md
```

## 2. The persistent Claude rule

The rule is already in the repository, at its canonical path:

```text
.claude/rules/provider-onboarding-v2.md
```

Nothing to copy. It is version-controlled through the narrow `.gitignore`
exception described above, so every future Claude Code session working on these
paths receives the same constraints — and there is exactly one copy to keep
current.

## 3. Confirm Claude loaded the project context

Open VS Code at the repository root, start Claude Code there, and run:

```text
/context
```

Confirm that the repository instructions and `.claude/rules/provider-onboarding-v2.md` appear. If they do not, do not start implementation; correct the working directory or rule placement first.

## 4. Start the implementation

Paste the complete contents of:

```text
SPRINT_09B29_PROVIDER_ONBOARDING_V2_IMPLEMENTATION_PROMPT.md
```

Do not replace it with a summary. Let Claude begin with Phase 0 and require evidence after every phase.

## 5. Make deviations mechanically fail

A prompt cannot guarantee design fidelity by itself. Keep these checks required in the pull request:

- Playwright reference-versus-implementation screenshot diffs.
- Real-API persistence E2E covering navigate, reload, and sign-out/sign-in.
- Upgrade/session regression covering stale-role `403`.
- API policy regression covering pending specialty moderation and submission.
- Accessibility and responsive assertions.
- Full repository and security gates.

Protect the integration branch in GitHub and require these jobs before merge. This is what turns the design contract from guidance into an enforceable acceptance gate.

## 6. Review Claude's completion claim

Accept completion only when the final report contains:

- all 18 screens in Arabic and English;
- tested widths 320, 390, 430, and 768;
- exact local and remote test counts;
- task-by-task persistence proof;
- visual diff artifacts;
- pushed commit SHA and PR link;
- green required GitHub checks;
- no unexplained visual deviation.

If any item is missing, reply:

```text
The mandate is incomplete. Continue from the first unmet exit criterion. Do not redesign, reduce scope, commit, push, or claim completion until the missing evidence is produced and all required local and remote checks are green.
```
