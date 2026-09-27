# R03 — Staging release boundary

Status: IMPLEMENTED CANDIDATE / HOSTED ACCEPTANCE BLOCKED.

Source baseline: `0eb6623cf6b3c036c916310e29187be3c4c9beb2` (merged R01 and R02).
Integration and operations owner: @baraabd. No new database schema, domain contract,
service account, infrastructure resource, DNS record or live environment has been created.

## Source-backed changes

- `infra/production/staging.cjs`: explicit release manifest, digest-only API/migrator/web
  images from one source revision, external API/migration secret files, exact deployment
  authorization, existing local Docker context/network, ordered preflight/migration/start,
  input-change checks, cooperative per-project lock and HTTPS/build/CORS diagnostics.
  Check-only mode performs no Docker calls. Failures stop forward progress; the tool
  never executes down, volume deletion, database reset or automatic rollback/retry.
- `infra/production/docker-compose.staging.yml`: a separate deployment topology, not an
  overlay on the developer stack. Loopback-only ports behind an operator-managed TLS
  edge, read-only non-root application containers, separate secret mounts and one-shot
  migrator. Postgres, Redis, S3, SMTP and ClamAV are explicitly external dependencies.
- `infra/production/check-runtime.cjs`, `start-api.cjs`, `apps/api/Dockerfile`: package
  the preflight with the built API; the staging command refuses unsafe configuration
  before loading the API. Existing ordinary CI bootstrap remains a separate contract.
- `apps/api/src/config/runtime-policy.ts`: strict preflight requires encrypted,
  authenticated Redis, PostgreSQL TLS with strict certificate checking, and secure S3
  endpoint URLs. Partial SMTP credential pairs and hardened process-wide TLS bypasses
  are refused. Existing secure cookies, throttles, scanner/bucket and worker policies
  remain in force. This is configuration validation, not proof of effective IAM/grants.
- `apps/api/src/infrastructure/mail/nodemailer-mail.adapter.ts`: hardened SMTP requires
  implicit TLS or STARTTLS with certificate verification; local disposable SMTP remains
  supported. The real loopback test refuses a relay that cannot negotiate STARTTLS.
- `apps/web/Dockerfile`, `apps/web/nginx.conf`: non-root read-only SPA image, deep-link
  fallback, real missing-asset/API errors, no-store entry/build identity, explicit
  build-time V2 flag. Public build metadata contains no credentials or user data.
- `.github/workflows/staging-boundary.yml` and final-SHA acceptance policy: Node release-control tests on Windows/Linux, packaged API preflight in a networkless
  container, actual non-root Nginx boot/HTTP checks and all existing regression gates.

## Evidence and limits

Locally executed: 71/71 dependency-free release-control/preflight tests on Linux with
Node 22.16.0, zero failures/skips. These include actual check-only CLI execution without
Docker in PATH, secret/identity rejection, stale source/flag refusal, ordering failures,
concurrent deployment exclusion and retained real-environment acceptance blockers.
The combined baseline/runtime/governance plus R03 suite also passed 197/197 tests locally.
Orchestration and HTTPS services in those unit tests are synthetic test doubles.

The shell environment has no usable pnpm, Docker or Chromium and cannot resolve
package hosts. The Nest/Jest transport tests, exact Node 24 execution, Docker builds,
Windows execution and application browser regression suites must be read from the
final-head GitHub runs. Do not relabel a queued or missing run as successful. The PR
body/comment must carry the final uploaded SHA and subsequent CI results.

No real staged deployment, external inbox delivery, real storage policy/scanner journey,
authenticated browser journey, database role/grant test or DNS/TLS provisioning was
performed. Even a successful launcher run reports `DEPLOYED_NOT_ACCEPTED` until these
independent target-specific gates are reviewed. Image labels identify claimed source;
registry provenance/signature verification is an additional operator responsibility.

## Blocking inputs and actions

| Blocker | Owner | Next action and required evidence |
| --- | --- | --- |
| Effective branch protection remains unverified/unapplied | @baraabd | Authorized administrator applies and reads back the R01 policy; a merged PR is not policy enforcement. |
| No approved target/provider/region/launch market or budget | @baraabd | Select the actual target and authorize any paid resources separately; identify existing host/context/network. |
| No approved TLS origins, certificate management or edge routing | @baraabd | Supply actual origins and verify DNS, certificate chain and forwarding to the loopback ports. No DNS mutation is implied by this PR. |
| No deployed image digests/provenance | @baraabd | Build all three images from the accepted source, record immutable registry digests and review provenance/security evidence. |
| No secret-store integration and effective least-privilege identities | @baraabd | Supply external files through the chosen secret mechanism; verify DB grants, workload/storage access, file ownership and rotation process on the target. |
| No real mail/storage/scanner evidence | @baraabd | Use an approved test account/inbox and synthetic uploads; prove delivery, denied anonymous/other-owner access, immutable scan results, worker delivery and safe cleanup. |
| No browser/restore/operations evidence on the target | @baraabd | Verify cookie/CORS/auth behavior from the deployed bundle, recover an approved backup, and capture sanitized release evidence. |

R03 is not CLOSED. R04–R10 may have isolated implementation work prepared, but their
R03-dependent acceptance remains blocked; this PR does not complete those sprints.

## Rollback

Before applying: discard or revert this change normally. No data was touched.
After an authorized deployment: use a separately reviewed compatible earlier image
manifest; assess any applied migration before rollback. A failed post-deploy HTTPS
check does not undo an already-applied migration or pretend the previous application
still runs. Never delete volumes to make a release check green.
