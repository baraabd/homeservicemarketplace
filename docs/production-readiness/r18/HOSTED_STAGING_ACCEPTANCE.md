# R18 — Hosted staging acceptance

Status: **`HOSTED_ENVIRONMENT_BLOCKED`. Nothing was deployed.**

## Why

- The GitHub environment `staging` exists but has no secrets, no variables
  and no protection rules. The repository has no Actions secrets.
- The last deployment record for `staging` is from 2026-04-23 (`9660df9`),
  before R05; no target is known to be running.
- `infra/production/STAGING.md` defines the supported rollout: an operator
  launcher onto an already authorized target (PostgreSQL with separate app
  and migrator roles, TLS Redis, S3-compatible storage with restricted
  separation, verified SMTP, ClamAV, approved HTTPS edge, approved registry).
  None of those were supplied. R18 does not select a vendor or provision
  anything.

## Acceptance to run when the owner supplies the target

Before deployment: confirm the target is staging; record the deployed
version and the rollback digests; verify a backup; verify secrets, TLS/DNS,
database, Redis, storage, scanner, SMTP and workers through the launcher's
checks.

After deployment, with synthetic accounts only: `/health/live`,
`/health/ready`; sign-up with real email OTP; recovery; media upload and
malware scan; provider onboarding and admin review; request, matching, bid,
booking, messaging across two instances, notifications, completion, review,
dispute and support; restart of an API instance, Redis and a worker;
backup and restore drill (`BACKUP_RESTORE_EVIDENCE.md`); rollback rehearsal
(`ROLLBACK_RUNBOOK.md`); the responsive browser matrix against the staging
origin.

Record artifact digests and the deployed SHA. A successful deploy command is
not acceptance.
