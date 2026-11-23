# K03 — Hosted staging, immutable release images and domain architecture

**Status: `HOSTED_ENVIRONMENT_BLOCKED`.** The provider-neutral code, validation and
local rehearsals are implemented and tested. Nothing was deployed, purchased,
published to a registry or changed in DNS. No hosted acceptance is claimed.

| Item           | Value                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Mode           | A — Integration and Bug-Fix (no UI surface changed)                                                               |
| Branch         | `release/ksa-k03-hosted-staging` (worktree `../HSM-k03`)                                                          |
| Base           | `origin/develop` `92770ea65ee1154f94f4251d5febfa39822f9b9a`, tree `854a9146c05bf21ef62af060358f581ec4c19306`      |
| Base note      | The base is also the audit reference. `origin/develop` had not moved on 2026-11-03.                               |
| Migration head | `20261024120000_g3_financial_integration` (74 migrations; K03 adds none)                                          |
| Dependencies   | K01 and K02 are **not accepted**. Both exist only as uncommitted work in other worktrees. See `BLOCKED_INPUTS.md` |
| Related lanes  | PR #204 (Vercel CD, draft) and PR #205 (K10 dossier, draft). Neither is modified by K03                           |

## Separate statuses

| Status                     | State                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| Implemented                | Yes, for the provider-neutral scope listed below                     |
| Tested locally             | Yes; exact commands and counts are in `evidence/COMMANDS.md`         |
| Remote CI on the final SHA | Recorded in the PR after the push; not certified here                |
| Hosted staging deployed    | **No.** There is no approved account, region, host, domain or budget |
| Hosted acceptance          | **No**                                                               |
| Merged                     | No (draft PR)                                                        |
| Production / DNS / spend   | Not authorized and not attempted. K10 owns the production cutover    |

## What K03 changed

1. **Web image flag propagation (reported defect).** The audited `apps/web/Dockerfile`
   never declared `VITE_STRIPE_SANDBOX_ENABLED`. A sandbox release image therefore
   compiled `script-src 'self'` and `frame-src 'none'`, which blocks Stripe.js and the
   Payment Element. This was reproduced in a real image built from the base SHA
   (`evidence/IMAGE_IDENTITY.md`).
   - All eight public bundle and CSP inputs are now explicit, validated build inputs,
     defined once in `scripts/production/security-app/web-build-identity.cjs`.
   - The API origin, onboarding V2 and the Stripe sandbox flag have no image default.
   - The build fails unless the emitted `index.html` CSP equals the policy the
     declared configuration requires.
   - The build also fails unless the reviewed `WEB_CONFIG_FINGERPRINT` matches.
2. **Image identity.** `build-info.json` and the OCI labels now carry the Stripe flag,
   the normalized public configuration, its SHA-256 fingerprint and the digest of the
   document CSP.
3. **Release manifest v2 (`infra/production/staging.cjs`).**
   - The manifest declares `stripeSandbox` and `webConfigFingerprint`.
   - The launcher requires matching image labels.
   - After rollout it re-derives the deployed identity and compares the CSP in the
     document actually served at `/`.
   - Version 1 manifests are rejected. They cannot bind the web configuration.
4. **Mail dispatch readiness.** A new `releaseReadinessProblems` requires the effective
   `MAIL_DISPATCHER_ENABLED` independently of `OUTBOX_WORKER_ENABLED`. It runs in the
   launcher's networkless preflight through `check-runtime.cjs --release`.
   - Before this, a release with the dispatcher off passed the preflight, leaving OTP
     and reset mail with no retry path.
   - Ordinary boot (`start-api.cjs`) deliberately does **not** require the
     dispatcher. That keeps R21's documented incident switch usable
     (`r21/ROLLBACK.md`: stop background retries without a redeploy).
   - An API image without the release policy fails a release preflight closed.
5. **Database identities.** `infra/production/database/` adds the DBA bootstrap and the
   post-migration privilege scripts, plus a disposable rehearsal driver. The rehearsal
   ran against the real migrator image and synthetic data. See
   `evidence/MIGRATION_REHEARSAL.md`.
6. **CI.** `staging-boundary.yml` builds and smokes both Stripe states. It also proves
   that an omitted flag or a mismatched fingerprint cannot build.

## Documents

| File                                                                 | Content                                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`DEPLOYMENT_DESIGN.md`](DEPLOYMENT_DESIGN.md)                       | Concrete topology, resource separation, network, registry, secrets, domain/TLS/mail, cost model |
| [`STAGING_RUNBOOK.md`](STAGING_RUNBOOK.md)                           | Build → provenance → DB bootstrap → migrate → launch → accept → rotate → roll back              |
| [`ISSUE_TEST_MATRIX.md`](ISSUE_TEST_MATRIX.md)                       | Each requirement mapped to its test or blocked evidence                                         |
| [`BLOCKED_INPUTS.md`](BLOCKED_INPUTS.md)                             | Exact external inputs and the unexecuted deployment steps                                       |
| [`evidence/COMMANDS.md`](evidence/COMMANDS.md)                       | Exact commands, exit codes and counts                                                           |
| [`evidence/IMAGE_IDENTITY.md`](evidence/IMAGE_IDENTITY.md)           | Baseline defect, both flag states, negative builds, browser CSP                                 |
| [`evidence/MIGRATION_REHEARSAL.md`](evidence/MIGRATION_REHEARSAL.md) | Role separation, upgrade on representative data, failure behavior                               |
