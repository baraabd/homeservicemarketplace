# R18 — Deployment runbook

Not executed: no authorized target exists (`HOSTED_STAGING_ACCEPTANCE.md`).
This is the procedure for the owner's operator once one does. It reuses
`infra/production/` and adds no vendor.

## Preconditions

The gates are defined in `RELEASE_GATES.md`. Staging needs gate A, not GO:
GO depends on evidence that only a staging deployment can produce.

For a **staging** rollout:

1. Gate A is met for this source SHA: a merge commit on `develop` (or the
   release branch the owner names) with every required check green
   (`BRANCH_PROTECTION_EVIDENCE.md`), and the owner's written authorization
   naming the registry and the staging target.
2. The staging database's latest backup identifier is recorded (on a first
   launch against an empty database, record that it is empty instead).
3. On a later release, the previous release's three image digests are
   recorded as the rollback target.

For a **production** rollout:

1. Gate C is met for exactly the digests that passed gate B.
2. `PRODUCTION_RELEASE_APPROVED=true` is recorded by the owner for that
   rollout package.
3. A backup taken in the last hour, with its identifier recorded.
4. The previous release's three image digests are recorded as the rollback
   target (none on a first launch; then the stop conditions below roll
   forward or take the service down, they do not roll back).

## Build once

From `apps/api/Dockerfile` build the API runner and migrator targets, and from
`apps/web/Dockerfile` the web image, all with `SOURCE_SHA=<full sha>`. Supply
`VITE_API_URL` (HTTPS API origin, no `/v1`) and an explicit
`VITE_PROVIDER_ONBOARDING_V2`. Push to the approved registry and record the
three digests and the SBOM. Fill `RELEASE_MANIFEST.json`. Production uses the
same digests as staging; never rebuild for production.

## Roll out (staging first, then production through its approval gate)

1. Prepare the release JSON for the launcher (`infra/production/STAGING.md`,
   "Images and manifest"); digests only, no mutable tags.
2. Run the launcher's checks; stop on any refusal.
3. Run the migrator image once (forward-only migrations).
4. Replace the API (and its workers), then the web image.
5. Wait for `/health/ready` on every instance before routing traffic, and
   confirm `/health/live` reports the manifest's `sourceSha` (the launcher
   refuses a mismatch).
6. Smoke with synthetic accounts: login with OTP, a request, a bid, a
   message, a notification. No demo users, no seeds, no destructive tests.
7. Watch error rate, latency, readiness, outbox backlog and scanner health.

## Stop conditions → `ROLLBACK_RUNBOOK.md`

Readiness not green within the agreed window; 5xx above the owner's
threshold; a failed smoke step; a failed migration.
