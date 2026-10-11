# R18 — Branch protection evidence

Read from the GitHub REST API on 2026-10-10, after `develop` reached
`fabeb0765689131025208f8dca2e7a4fae924118`. Nothing was changed.

## Current state

| Read                                            | Result                                                        |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `GET /repos/{repo}/branches/develop/protection` | `404` `"Branch not protected"`                                |
| `GET /repos/{repo}/rulesets`                    | `[]`                                                          |
| Token permission on the repository              | `admin: true` (the capability exists; the authority does not) |
| Merge methods enabled                           | merge commit, squash and rebase all enabled                   |
| GitHub secret scanning                          | disabled (`GET /secret-scanning/alerts`)                      |

Status: **`RELEASE_BLOCKER_BRANCH_PROTECTION`**. Anyone with push access can
push to `develop` directly, force-push it, or merge a red pull request.

R18 does not apply protection. The task allows it only "when repository
administration permission **and explicit governance authorization** exist";
the permission exists, the authorization was not given, and a review
requirement on a single-maintainer repository can block the owner's own
merges. The owner decides the review count.

## Check contexts (exact names, from the check runs on `fabeb07`)

Required by `.github/scripts/production-governance.mjs` (`REQUIRED_CHECKS`):
`CI gate`, `Analyze JavaScript/TypeScript`, `Production governance`.

Also produced on every push to `develop` and proposed as required:

- `Auth lifecycle acceptance` workflow: `R04 real browser, SMTP and Postgres`
- `Web development startup` workflow: `Dev browser startup (ubuntu-latest)`,
  `Dev browser startup (windows-latest)`
- `Staging release boundary` workflow: `Staging boundary gate`,
  `Staging image boundaries`, `Staging release controls (ubuntu-latest)`,
  `Staging release controls (windows-latest)`

`CI gate` already requires every CI job, including the new
`R18 functional completion acceptance` job added by this PR. It is not listed
separately, so a renamed CI job cannot silently drop out of protection.

## Payload for the owner (not applied)

```bash
curl -X PUT -H "Authorization: Bearer <owner token>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/baraabd/homeservicemarketplace/branches/develop/protection \
  --data-binary @develop-protection.json
```

`develop-protection.json`:

```json
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "CI gate" },
      { "context": "Analyze JavaScript/TypeScript" },
      { "context": "Production governance" },
      { "context": "R04 real browser, SMTP and Postgres" },
      { "context": "Dev browser startup (ubuntu-latest)" },
      { "context": "Dev browser startup (windows-latest)" },
      { "context": "Staging boundary gate" },
      { "context": "Staging image boundaries" },
      { "context": "Staging release controls (ubuntu-latest)" },
      { "context": "Staging release controls (windows-latest)" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

Owner choices in this payload: `required_approving_review_count` (1 needs a
second reviewer; 0 keeps PR-only merges without a review) and
`enforce_admins` (true also binds the owner). Apply the same body to `main`.

## Read-back after the owner applies it

```bash
curl -H "Authorization: Bearer <token>" \
  https://api.github.com/repos/baraabd/homeservicemarketplace/branches/develop/protection \
  > protection.json
node -e "import('./.github/scripts/production-governance.mjs').then(m => console.log(m.protectionProblems(JSON.parse(require('fs').readFileSync('protection.json','utf8')))))"
```

An empty problem list is the closure evidence for R18-G1.
