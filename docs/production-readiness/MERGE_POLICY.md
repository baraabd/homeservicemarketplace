# Merge policy — protected develop

## Enforcement is a repository setting, not a Markdown claim

At Wave A inspection, `develop` was at `66e336cb4823802aabacc536584972aa43056d23` and the branch API reported `protected: false`. Reading `/branches/develop/protection` with the active integration returned HTTP 403 (`Resource not accessible by integration`). The integration has no administration-write action. These facts block the protection acceptance criterion; adding CODEOWNERS or this policy does not activate protection.

An authorized repository administrator must configure protection for the exact `develop` branch. Preserve any existing stricter rules; do not replace an unknown policy with a weaker example.

## Required settings

Require a pull request, an up-to-date branch, resolved conversations, administrator enforcement, no force pushes and no branch deletion. Disallow PR bypass allowances. Dismiss stale approvals when commits change.

Require these exact check names after each has run at least once:

- `CI gate` — the existing aggregate gate, not one convenient successful child job.
- `Analyze JavaScript/TypeScript` — the existing CodeQL analysis job.
- `Production governance` — the additional repository-policy check in this sprint.

Do not add a path filter to a required workflow: a missing check is not a successful check. Do not rename checks without coordinating the protection setting.

For the currently single-owner repository, requiring the author's own approval would deadlock delivery. Requiring the PR, checks and conversation resolution is mandatory; set the approval count to zero until an independent reviewer with repository access is assigned. Then require at least one independent approval and, where appropriate, CODEOWNER review. This is not permission to self-approve or bypass checks.

## Read back and verify

After applying classic branch protection, use an administrator-authorized GitHub CLI session locally:

```bash
gh api repos/baraabd/homeservicemarketplace/branches/develop/protection > /tmp/hsm-develop-protection.json
node .github/scripts/production-governance.mjs protection /tmp/hsm-develop-protection.json
```

The verifier is read-only. It rejects missing data, HTTP-error objects, missing checks and unsafe settings; it never prints tokens or mutates settings. It validates classic branch-protection responses only. An equivalent ruleset must instead be inspected through its effective-rules API and documented explicitly; do not pass a ruleset response to this verifier or infer enforcement from a rule's mere existence.

Capture a redacted settings response, timestamp, branch/head, required contexts and verification result under `docs/production-readiness/governance/`. Do not deliberately push a test commit to `develop` to test rejection. The active protection API/effective rules and a PR merge-blocked state provide non-destructive enforcement evidence.

## Merge checklist

Review the final diff and latest integration base. Match CI and CodeQL to the final head SHA, not an earlier run. The source-provenance artifact records its head, tree and archive digest; a source archive is reproducibility evidence, not application test evidence. Do not merge draft or blocked sprints.

Preferred integration order is S01, S02, S03, S04/S05, S07/S08, S06, S09, S10. S10 may integrate earlier when no competing migration exists. After every two or three approved merges, run full CI, CodeQL, browser suites, Docker production boot, Compose smoke and affected real-API journeys. Any failing gate stops the next merge wave.
